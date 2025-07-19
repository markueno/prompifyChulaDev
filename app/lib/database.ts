import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import crypto from 'crypto';

// For SQLite (development)
let db: Database.Database;

export function getDatabase() {
  if (!db) {
    db = new Database('./data/prompify.db');
    
    // Enable foreign keys
    db.pragma('foreign_keys = ON');
    
    // Create tables if they don't exist
    createTables(db);
  }
  return db;
}

export function getDrizzleDB() {
  return drizzle(getDatabase());
}

function createTables(db: Database.Database) {
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
  const db = getDatabase();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

export async function createUser(user: any) {
  const db = getDatabase();
  try {
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
  } catch (error) {
    console.error('Error creating user:', error);
    return false;
  }
}

export async function getUserByVerificationToken(token: string) {
  const db = getDatabase();
  return db.prepare('SELECT * FROM users WHERE verification_token = ?').get(token);
}

export async function verifyUser(userId: string) {
  const db = getDatabase();
  try {
    const result = db.prepare(`
      UPDATE users 
      SET verified = 1, verification_token = NULL, verification_expires = NULL 
      WHERE id = ?
    `).run(userId);
    return result.changes > 0;
  } catch (error) {
    console.error('Error verifying user:', error);
    return false;
  }
}

export async function updateLoginAttempts(email: string, attempts: number) {
  const db = getDatabase();
  try {
    db.prepare(`
      UPDATE users 
      SET login_attempts = ?, last_login = CURRENT_TIMESTAMP 
      WHERE email = ?
    `).run(attempts, email);
    return true;
  } catch (error) {
    console.error('Error updating login attempts:', error);
    return false;
  }
}

export async function resetLoginAttempts(userId: string) {
  const db = getDatabase();
  try {
    db.prepare(`
      UPDATE users 
      SET login_attempts = 0, last_login = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(userId);
    return true;
  } catch (error) {
    console.error('Error resetting login attempts:', error);
    return false;
  }
}

export async function logEmail(userId: string, emailType: string, delivered: boolean, errorMessage?: string) {
  const db = getDatabase();
  try {
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
  } catch (error) {
    console.error('Error logging email:', error);
    return false;
  }
} 