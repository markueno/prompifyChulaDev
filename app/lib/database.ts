import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import crypto from 'crypto';
import {
  getPostgresPool,
  createPostgresTables,
  getUserByEmailPostgres,
  createUserPostgres,
  getUserByVerificationTokenPostgres,
  verifyUserPostgres,
  updateLoginAttemptsPostgres,
  resetLoginAttemptsPostgres,
  logEmailPostgres,
  createUserSessionPostgres,
  invalidateUserSessionsPostgres,
  validateSessionPostgres,
  updateSessionActivityPostgres,
  logoutUserPostgres,
  getActiveSessionCountPostgres
} from './database-postgresql';

// Database configuration
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite'; // 'sqlite' or 'postgresql'

// For SQLite (development)
let sqliteDb: Database.Database;

// For PostgreSQL (production)
let postgresDb: any;

export function getDatabase() {
  if (DATABASE_TYPE === 'postgresql') {
    return getPostgresDatabase();
  } else {
    return getSQLiteDatabase();
  }
}

export function getDrizzleDB() {
  if (DATABASE_TYPE === 'postgresql') {
    return drizzle(getPostgresDatabase());
  } else {
    return drizzle(getSQLiteDatabase());
  }
}

function getSQLiteDatabase() {
  if (!sqliteDb) {
    sqliteDb = new Database('./data/prompify.db');
    
    // Enable foreign keys
    sqliteDb.pragma('foreign_keys = ON');
    
    // Create tables if they don't exist
    createSQLiteTables(sqliteDb);
  }
  return sqliteDb;
}

function getPostgresDatabase() {
  if (!postgresDb) {
    // Initialize PostgreSQL tables if they don't exist
    createPostgresTables().catch(console.error);
    postgresDb = getPostgresPool();
  }
  return postgresDb;
}

function createSQLiteTables(db: Database.Database) {
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      verified INTEGER DEFAULT 0,
      verification_token TEXT,
      verification_expires TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login TEXT,
      login_attempts INTEGER DEFAULT 0,
      locked_until TEXT,
      reset_token TEXT,
      reset_expires TEXT
    )
  `);

  // User sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_used TEXT DEFAULT CURRENT_TIMESTAMP,
      ip_address TEXT,
      user_agent TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Rate limiting table
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      id TEXT PRIMARY KEY,
      ip_address TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      attempts INTEGER DEFAULT 1,
      first_attempt TEXT DEFAULT CURRENT_TIMESTAMP,
      last_attempt TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(ip_address, endpoint)
    )
  `);

  // Email logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email_type TEXT NOT NULL,
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
      delivered INTEGER DEFAULT 0,
      error_message TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON user_sessions(token_hash)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_endpoint ON rate_limits(ip_address, endpoint)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id)');
}

// Database helper functions
export async function getUserByEmail(email: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getUserByEmailPostgres(email);
  } else {
    const db = getDatabase();
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  }
}

export async function createUser(user: any) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return createUserPostgres(user);
    } else {
      const db = getDatabase();
      const result = db.prepare(`
        INSERT INTO users (id, email, password_hash, verified, verification_token, verification_expires, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.id,
        user.email,
        user.passwordHash,
        user.verified ? 1 : 0,
        user.verificationToken,
        user.verificationExpires,
        user.createdAt
      );
      return result.changes > 0;
    }
  } catch (error) {
    console.error('Error creating user:', error);
    return false;
  }
}

export async function getUserByVerificationToken(token: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getUserByVerificationTokenPostgres(token);
  } else {
    const db = getDatabase();
    return db.prepare('SELECT * FROM users WHERE verification_token = ?').get(token);
  }
}

export async function verifyUser(userId: string) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return verifyUserPostgres(userId);
    } else {
      const db = getDatabase();
      const result = db.prepare(`
        UPDATE users 
        SET verified = 1, verification_token = NULL, verification_expires = NULL 
        WHERE id = ?
      `).run(userId);
      return result.changes > 0;
    }
  } catch (error) {
    console.error('Error verifying user:', error);
    return false;
  }
}

export async function updateLoginAttempts(email: string, attempts: number) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return updateLoginAttemptsPostgres(email, attempts);
    } else {
      const db = getDatabase();
      db.prepare(`
        UPDATE users 
        SET login_attempts = ?, last_login = CURRENT_TIMESTAMP 
        WHERE email = ?
      `).run(attempts, email);
      return true;
    }
  } catch (error) {
    console.error('Error updating login attempts:', error);
    return false;
  }
}

export async function resetLoginAttempts(userId: string) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return resetLoginAttemptsPostgres(userId);
    } else {
      const db = getDatabase();
      db.prepare(`
        UPDATE users 
        SET login_attempts = 0, last_login = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(userId);
      return true;
    }
  } catch (error) {
    console.error('Error resetting login attempts:', error);
    return false;
  }
}

export async function logEmail(userId: string, emailType: string, delivered: boolean, errorMessage?: string) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return logEmailPostgres(userId, emailType, delivered, errorMessage);
    } else {
      const db = getDatabase();
      db.prepare(`
        INSERT INTO email_logs (id, user_id, email_type, delivered, error_message)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        userId,
        emailType,
        delivered ? 1 : 0,
        errorMessage
      );
      return true;
    }
  } catch (error) {
    console.error('Error logging email:', error);
    return false;
  }
} 

export async function createUserSession(userId: string, tokenHash: string, expiresAt: string, ipAddress?: string, userAgent?: string) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return createUserSessionPostgres(userId, tokenHash, expiresAt, ipAddress, userAgent);
    } else {
      const db = getDatabase();
      // First, invalidate any existing sessions for this user (single session enforcement)
      await invalidateUserSessions(userId);
      
      // Create new session
      const result = db.prepare(`
        INSERT INTO user_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        userId,
        tokenHash,
        expiresAt,
        ipAddress || null,
        userAgent || null
      );
      return result.changes > 0;
    }
  } catch (error) {
    console.error('Error creating user session:', error);
    return false;
  }
}

export async function invalidateUserSessions(userId: string) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return invalidateUserSessionsPostgres(userId);
    } else {
      const db = getDatabase();
      db.prepare(`
        DELETE FROM user_sessions 
        WHERE user_id = ?
      `).run(userId);
      return true;
    }
  } catch (error) {
    console.error('Error invalidating user sessions:', error);
    return false;
  }
}

export async function validateSession(tokenHash: string) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return validateSessionPostgres(tokenHash);
    } else {
      const db = getDatabase();
      const session = db.prepare(`
        SELECT us.*, u.email, u.verified 
        FROM user_sessions us
        JOIN users u ON us.user_id = u.id
        WHERE us.token_hash = ? AND us.expires_at > datetime('now')
      `).get(tokenHash);
      
      return session;
    }
  } catch (error) {
    console.error('Error validating session:', error);
    return null;
  }
}

export async function updateSessionActivity(tokenHash: string) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return updateSessionActivityPostgres(tokenHash);
    } else {
      const db = getDatabase();
      db.prepare(`
        UPDATE user_sessions 
        SET last_used = datetime('now')
        WHERE token_hash = ?
      `).run(tokenHash);
      return true;
    }
  } catch (error) {
    console.error('Error updating session activity:', error);
    return false;
  }
}

export async function logoutUser(tokenHash: string) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return logoutUserPostgres(tokenHash);
    } else {
      const db = getDatabase();
      db.prepare(`
        DELETE FROM user_sessions 
        WHERE token_hash = ?
      `).run(tokenHash);
      return true;
    }
  } catch (error) {
    console.error('Error logging out user:', error);
    return false;
  }
}

export async function getActiveSessionCount(userId: string) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return getActiveSessionCountPostgres(userId);
    } else {
      const db = getDatabase();
      const result = db.prepare(`
        SELECT COUNT(*) as count 
        FROM user_sessions 
        WHERE user_id = ? AND expires_at > datetime('now')
      `).get(userId);
      return result.count;
    }
  } catch (error) {
    console.error('Error getting active session count:', error);
    return 0;
  }
} 