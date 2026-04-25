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
  createPasswordResetTokenPostgres,
  getUserByResetTokenPostgres,
  setPasswordFromResetTokenPostgres,
  updateLoginAttemptsPostgres,
  resetLoginAttemptsPostgres,
  logEmailPostgres,
  createUserSessionPostgres,
  invalidateUserSessionsPostgres,
  validateSessionPostgres,
  updateSessionActivityPostgres,
  logoutUserPostgres,
  getActiveSessionCountPostgres,
  saveChatPostgres,
  getChatsByUserPostgres,
  getChatByIdPostgres,
  deleteChatPostgres,
  insertPromptPostgres,
  getPromptsByChatIdPostgres,
  logUserActivityPostgres,
  getUserActivityPostgres,
  getChatMembersPostgres,
  inviteToChatPostgres,
  getPendingInvitationsForUserPostgres,
  getChatInvitationsPostgres,
  addChatMemberPostgres,
  acceptInvitationByTokenPostgres,
  updateChatMemberRolePostgres,
  removeChatMemberPostgres,
  getSubscriptionByUserIdPostgres,
  insertTokenUsagePostgres,
  insertTokenUsageAndConsumePostgres,
  consumeTokenBalancePostgres,
  getTokenBalanceRemainingPostgres,
  getProjectOverviewPostgres,
  insertContactSubmissionPostgres,
  type ContactSubmissionInput,
} from './database-postgresql';

export type { ProjectOverview, ProjectOverviewRecentRun } from './database-postgresql';

// Database configuration
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_TYPE = process.env.DATABASE_TYPE || 'postgresql'; // 'sqlite' or 'postgresql'

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
      is_verified INTEGER DEFAULT 0,
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_submissions (
      id TEXT PRIMARY KEY,
      enquiry_type TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      country TEXT NOT NULL,
      country_code TEXT,
      message TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_contact_submissions_created_at ON contact_submissions(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_contact_submissions_enquiry_type ON contact_submissions(enquiry_type)');
}

export async function insertContactSubmission(
  row: Omit<ContactSubmissionInput, 'id'> & { id?: string }
): Promise<string | null> {
  const id = row.id ?? crypto.randomUUID();
  const full: ContactSubmissionInput = {
    id,
    enquiryType: row.enquiryType,
    name: row.name,
    email: row.email,
    phone: row.phone,
    country: row.country,
    countryCode: row.countryCode,
    message: row.message,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };

  try {
    if (DATABASE_TYPE === 'postgresql') {
      const ok = await insertContactSubmissionPostgres(full);
      return ok ? id : null;
    }
    const db = getDatabase();
    const result = db
      .prepare(
        `INSERT INTO contact_submissions (
          id, enquiry_type, name, email, phone, country, country_code, message, ip_address, user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        full.id,
        full.enquiryType,
        full.name,
        full.email,
        full.phone,
        full.country,
        full.countryCode,
        full.message,
        full.ipAddress ?? null,
        full.userAgent ?? null
      );
    return result.changes > 0 ? id : null;
  } catch (error) {
    console.error('Error inserting contact submission:', error);
    return null;
  }
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
        INSERT INTO users (id, email, password_hash, is_verified, verification_token, verification_expires, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        user.id,
        user.email,
        user.passwordHash,
        user.isVerified ? 1 : 0,
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
        SET is_verified = 1, verification_token = NULL, verification_expires = NULL 
        WHERE id = ?
      `).run(userId);
      return result.changes > 0;
    }
  } catch (error) {
    console.error('Error verifying user:', error);
    return false;
  }
}

export async function createPasswordResetToken(email: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return createPasswordResetTokenPostgres(email);
  }
  return null;
}

export async function getUserByResetToken(token: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getUserByResetTokenPostgres(token);
  }
  return null;
}

export async function setPasswordFromResetToken(token: string, passwordHash: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return setPasswordFromResetTokenPostgres(token, passwordHash);
  }
  return false;
}

/** Get user's subscription with tier info. PostgreSQL only; returns null for SQLite. */
export async function getSubscriptionByUserId(userId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getSubscriptionByUserIdPostgres(userId);
  }
  return null;
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
        SELECT us.*, u.email, u.is_verified 
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

// Chat management functions
export async function saveChat(userId: string, chatData: {
  id: string;
  urlId?: string;
  description?: string;
  messages: any[];
  metadata?: any;
}) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return saveChatPostgres(userId, chatData);
    } else {
      // SQLite implementation would go here if needed
      console.warn('Chat saving not implemented for SQLite');
      return null;
    }
  } catch (error) {
    console.error('Error saving chat:', error);
    return null;
  }
}

export async function getChatsByUser(userId: string, isModerator?: boolean) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return getChatsByUserPostgres(userId, isModerator);
    } else {
      // SQLite implementation would go here if needed
      console.warn('Chat retrieval not implemented for SQLite');
      return [];
    }
  } catch (error) {
    console.error('Error getting chats by user:', error);
    return [];
  }
}

export async function getChatById(chatId: string, userId: string, isModerator?: boolean) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return getChatByIdPostgres(chatId, userId, isModerator);
    } else {
      // SQLite implementation would go here if needed
      console.warn('Chat retrieval not implemented for SQLite');
      return null;
    }
  } catch (error) {
    console.error('Error getting chat by ID:', error);
    return null;
  }
}

export async function deleteChat(chatId: string, userId: string) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return deleteChatPostgres(chatId, userId);
    } else {
      // SQLite implementation would go here if needed
      console.warn('Chat deletion not implemented for SQLite');
      return false;
    }
  } catch (error) {
    console.error('Error deleting chat:', error);
    return false;
  }
}

export async function insertPrompt(params: { chatId: string; userId: string; messageId: string }) {
  if (DATABASE_TYPE === 'postgresql') {
    return insertPromptPostgres(params);
  }
  return null;
}

export async function getPromptsByChatId(chatId: string, userId: string, isModerator?: boolean) {
  if (DATABASE_TYPE === 'postgresql') {
    return getPromptsByChatIdPostgres(chatId, userId, isModerator);
  }
  return [];
}

export async function getChatMembers(chatId: string, userId: string, isModerator?: boolean) {
  if (DATABASE_TYPE === 'postgresql') {
    return getChatMembersPostgres(chatId, userId, isModerator);
  }
  return { members: [], currentUserRole: '' };
}

export async function updateChatMemberRole(chatId: string, userId: string, targetUserId: string, newRole: string, isModerator?: boolean) {
  if (DATABASE_TYPE === 'postgresql') {
    return updateChatMemberRolePostgres(chatId, userId, targetUserId, newRole, isModerator);
  }
  return { success: false, error: 'Not supported' };
}

export async function removeChatMember(chatId: string, userId: string, targetUserId: string, isModerator?: boolean) {
  if (DATABASE_TYPE === 'postgresql') {
    return removeChatMemberPostgres(chatId, userId, targetUserId, isModerator);
  }
  return { success: false, error: 'Not supported' };
}

export async function insertTokenUsage(params: {
  chatId: string;
  messageId: string;
  userId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
  provider?: string;
}) {
  if (DATABASE_TYPE === 'postgresql') {
    return insertTokenUsagePostgres(params);
  }
  return false;
}

/** Level B: record usage + consumption allocations + balance updates atomically (PostgreSQL). */
export async function insertTokenUsageAndConsume(params: {
  chatId: string;
  messageId: string;
  userId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
  provider?: string;
}) {
  if (DATABASE_TYPE === 'postgresql') {
    return insertTokenUsageAndConsumePostgres(params);
  }
  return false;
}

export async function consumeTokenBalance(userId: string, tokensToConsume: number) {
  if (DATABASE_TYPE === 'postgresql') {
    return consumeTokenBalancePostgres(userId, tokensToConsume);
  }
  return false;
}

export async function getTokenBalanceRemaining(userId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getTokenBalanceRemainingPostgres(userId);
  }
  return 0;
}

const emptyProjectOverview: import('./database-postgresql').ProjectOverview = {
  projectCount: 0,
  activeProjectsLast7Days: 0,
  tokensLast7Days: 0,
  runsLast7Days: 0,
  tokenBalanceRemaining: 0,
  errorRatePercent: null,
  failuresLast7Days: 0,
  recentRuns: [],
  healthStatus: 'healthy',
  healthReasons: [],
};

export async function getProjectOverview(userId: string, isModerator?: boolean) {
  if (DATABASE_TYPE !== 'postgresql') {
    return emptyProjectOverview;
  }
  try {
    return await getProjectOverviewPostgres(userId, isModerator);
  } catch (error) {
    console.error('Error loading project overview:', error);
    return emptyProjectOverview;
  }
}

export async function inviteToChat(chatId: string, userId: string, email: string, role?: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return inviteToChatPostgres(chatId, userId, email, role);
  }
  return { success: false, error: 'Not supported' };
}

export async function getPendingInvitationsForUser(userEmail: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getPendingInvitationsForUserPostgres(userEmail);
  }
  return [];
}

export async function getChatInvitations(chatId: string, userId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getChatInvitationsPostgres(chatId, userId);
  }
  return [];
}

export async function addChatMember(chatId: string, userId: string, role?: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return addChatMemberPostgres(chatId, userId, role);
  }
  return false;
}

export async function acceptInvitationByToken(token: string, userId: string, userEmail: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return acceptInvitationByTokenPostgres(token, userId, userEmail);
  }
  return { success: false, error: 'Not supported' };
}

// User activity tracking functions
export async function logUserActivity(userId: string, actionType: string, actionDetails: any = {}, ipAddress?: string, userAgent?: string) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return logUserActivityPostgres(userId, actionType, actionDetails, ipAddress, userAgent);
    } else {
      // SQLite implementation would go here if needed
      console.warn('User activity logging not implemented for SQLite');
      return false;
    }
  } catch (error) {
    console.error('Error logging user activity:', error);
    return false;
  }
}

export async function getUserActivity(userId: string, limit: number = 100) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return getUserActivityPostgres(userId, limit);
    } else {
      // SQLite implementation would go here if needed
      console.warn('User activity retrieval not implemented for SQLite');
      return [];
    }
  } catch (error) {
    console.error('Error getting user activity:', error);
    return [];
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