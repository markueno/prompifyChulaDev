/*
 * better-sqlite3 and drizzle-orm/better-sqlite3 are native addons — only loaded
 * when DATABASE_TYPE=sqlite. Dynamic require() instead of top-level import prevents
 * the binding from being resolved in environments without native .node support
 * (WebContainer, Cloudflare Workers, etc.).
 */
import crypto from 'crypto';
import {
  getPostgresPool,
  getUserByEmailPostgres,
  createUserPostgres,
  getUserByVerificationTokenPostgres,
  verifyUserPostgres,
  createPasswordResetTokenPostgres,
  getUserByResetTokenPostgres,
  setPasswordFromResetTokenPostgres,
  updateUserPasswordPostgres,
  getUserStatusPostgres,
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
  getTokenBalanceRemainingPostgres,
  getTokenBalanceRemainingForCompanyPostgres,
  getSubscriptionByCompanyIdPostgres,
  getCompanyIdForChatPostgres,
  getCompanyMemberCountPostgres,
  getCompanySeatsPostgres,
  ensureUserTrialPostgres,
  getProjectOverviewPostgres,
  insertContactSubmissionPostgres,
  type ContactSubmissionInput,
  createCompanyPostgres,
  getCompanyBySlugPostgres,
  getUserCompaniesPostgres,
  getCompanyMemberPostgres,
  getCompanyMembersPostgres,
  addCompanyMemberPostgres,
  removeCompanyMemberPostgres,
  updateCompanyPostgres,
  getCompanyAppsPostgres,
  updateAppStatusPostgres,
  getInactiveAppsPostgres,
  addAuditLogPostgres,
  getAuditLogsPostgres,
  checkRateLimitPostgres,
} from './database-postgresql';

export type {
  ProjectOverview,
  ProjectOverviewRecentRun,
  Company,
  CompanyApp,
  CompanyRole,
  AppStatus,
  RuntimeType,
  AuditAction,
} from './database-postgresql';

// Database configuration
const DATABASE_TYPE = process.env.DATABASE_TYPE || 'postgresql'; // 'sqlite' or 'postgresql'

// For SQLite (development)
let sqliteDb: any;

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require('drizzle-orm/node-postgres');
    return drizzle(getPostgresDatabase());
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require('drizzle-orm/better-sqlite3');
    return drizzle(getSQLiteDatabase());
  }
}

function getSQLiteDatabase() {
  if (!sqliteDb) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/naming-convention
    const BetterSqlite3 = require('better-sqlite3');
    sqliteDb = new BetterSqlite3('./data/prompify.db');

    // Enable foreign keys
    sqliteDb.pragma('foreign_keys = ON');

    // Create tables if they don't exist
    createSQLiteTables(sqliteDb);
  }

  return sqliteDb;
}

function getPostgresDatabase() {
  if (!postgresDb) {
    postgresDb = getPostgresPool();
  }

  return postgresDb;
}

function createSQLiteTables(db: any) {
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
      const result = db
        .prepare(
          `
        INSERT INTO users (id, email, password_hash, is_verified, verification_token, verification_expires, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
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
      const result = db
        .prepare(
          `
        UPDATE users 
        SET is_verified = 1, verification_token = NULL, verification_expires = NULL 
        WHERE id = ?
      `
        )
        .run(userId);

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

/** Current account status ('active' | 'inactive' | 'suspended'), or null if the account is gone. */
export async function getUserStatus(userId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getUserStatusPostgres(userId);
  }

  return 'active';
}

/** Set a signed-in user's password (authorised by session + current password, not by a token). */
export async function updateUserPassword(userId: string, passwordHash: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return updateUserPasswordPostgres(userId, passwordHash);
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
      db.prepare(
        `
        UPDATE users 
        SET login_attempts = ?, last_login = CURRENT_TIMESTAMP 
        WHERE email = ?
      `
      ).run(attempts, email);

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
      db.prepare(
        `
        UPDATE users 
        SET login_attempts = 0, last_login = CURRENT_TIMESTAMP 
        WHERE id = ?
      `
      ).run(userId);

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
      db.prepare(
        `
        INSERT INTO email_logs (id, user_id, email_type, delivered, error_message)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(crypto.randomUUID(), userId, emailType, delivered ? 1 : 0, errorMessage);

      return true;
    }
  } catch (error) {
    console.error('Error logging email:', error);
    return false;
  }
}

export async function createUserSession(
  userId: string,
  tokenHash: string,
  expiresAt: string,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return createUserSessionPostgres(userId, tokenHash, expiresAt, ipAddress, userAgent);
    } else {
      const db = getDatabase();

      /*
       * Concurrent sessions are allowed here too, matching the Postgres path — otherwise auth
       * would behave differently in dev (SQLite) than in production. Just drop expired rows.
       */
      db.prepare(`DELETE FROM user_sessions WHERE user_id = ? AND expires_at < CURRENT_TIMESTAMP`).run(userId);

      // Create new session
      const result = db
        .prepare(
          `
        INSERT INTO user_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
      `
        )
        .run(crypto.randomUUID(), userId, tokenHash, expiresAt, ipAddress || null, userAgent || null);

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
      db.prepare(
        `
        DELETE FROM user_sessions 
        WHERE user_id = ?
      `
      ).run(userId);

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
      const session = db
        .prepare(
          `
        SELECT us.*, u.email, u.is_verified 
        FROM user_sessions us
        JOIN users u ON us.user_id = u.id
        WHERE us.token_hash = ? AND us.expires_at > datetime('now')
      `
        )
        .get(tokenHash);

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
      db.prepare(
        `
        UPDATE user_sessions 
        SET last_used = datetime('now')
        WHERE token_hash = ?
      `
      ).run(tokenHash);

      return true;
    }
  } catch (error) {
    console.error('Error updating session activity:', error);
    return false;
  }
}

// Chat management functions
export async function saveChat(
  userId: string,
  chatData: {
    id: string;
    urlId?: string;
    projectId?: string;
    description?: string;
    messages: any[];
    metadata?: any;
  }
) {
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

export async function getChatById(chatId: string, userId: string, isModerator?: boolean, projectId?: string) {
  try {
    if (DATABASE_TYPE === 'postgresql') {
      return getChatByIdPostgres(chatId, userId, isModerator, projectId);
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

export async function updateChatMemberRole(
  chatId: string,
  userId: string,
  targetUserId: string,
  newRole: string,
  isModerator?: boolean
) {
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
  companyId?: string | null;
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

export async function getTokenBalanceRemaining(userId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getTokenBalanceRemainingPostgres(userId);
  }

  return 0;
}

/** Idempotently ensure a user's personal workspace + Trial token pool exist (self-healing). */
export async function ensureUserTrial(userId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return ensureUserTrialPostgres(userId);
  }

  return undefined;
}

/** Remaining tokens in a workspace's shared pool (B2B). */
export async function getTokenBalanceRemainingForCompany(companyId: string, userId?: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getTokenBalanceRemainingForCompanyPostgres(companyId, userId);
  }

  return 0;
}

/** A workspace's subscription + tier info. */
export async function getSubscriptionByCompanyId(companyId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getSubscriptionByCompanyIdPostgres(companyId);
  }

  return null;
}

/** Resolve the workspace that owns a chat (via its project). */
export async function getCompanyIdForChat(chatId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getCompanyIdForChatPostgres(chatId);
  }

  return null;
}

/** Member count of a workspace (seat enforcement). */
export async function getCompanyMemberCount(companyId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getCompanyMemberCountPostgres(companyId);
  }

  return 0;
}

/** Seat cap of a workspace (from its plan). */
export async function getCompanySeats(companyId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getCompanySeatsPostgres(companyId);
  }

  return 1;
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

export async function getProjectOverview(userId: string, isModerator?: boolean, companyId?: string) {
  if (DATABASE_TYPE !== 'postgresql') {
    return emptyProjectOverview;
  }

  try {
    return await getProjectOverviewPostgres(userId, isModerator, companyId);
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
export async function logUserActivity(
  userId: string,
  actionType: string,
  actionDetails: any = {},
  ipAddress?: string,
  userAgent?: string
) {
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
      db.prepare(
        `
        DELETE FROM user_sessions 
        WHERE token_hash = ?
      `
      ).run(tokenHash);

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
      const result = db
        .prepare(
          `
        SELECT COUNT(*) as count
        FROM user_sessions
        WHERE user_id = ? AND expires_at > datetime('now')
      `
        )
        .get(userId);

      return result.count;
    }
  } catch (error) {
    console.error('Error getting active session count:', error);
    return 0;
  }
}

/*
 * ============================================================
 * Phase 2: Company (Tenant) Functions
 * ============================================================
 */

export async function createCompany(name: string, slug: string, ownerUserId: string, githubOrg?: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return createCompanyPostgres(name, slug, ownerUserId, githubOrg);
  }

  return null;
}

export async function getCompanyBySlug(slug: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getCompanyBySlugPostgres(slug);
  }

  return null;
}

export async function getUserCompanies(userId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getUserCompaniesPostgres(userId);
  }

  return [];
}

export async function getCompanyMember(companyId: string, userId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getCompanyMemberPostgres(companyId, userId);
  }

  return null;
}

export async function getCompanyMembers(companyId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getCompanyMembersPostgres(companyId);
  }

  return [];
}

export async function addCompanyMember(
  companyId: string,
  userId: string,
  role: import('./database-postgresql').CompanyRole
) {
  if (DATABASE_TYPE === 'postgresql') {
    return addCompanyMemberPostgres(companyId, userId, role);
  }

  return false;
}

export async function removeCompanyMember(companyId: string, userId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return removeCompanyMemberPostgres(companyId, userId);
  }

  return false;
}

export async function updateCompany(companyId: string, fields: { name?: string; github_org?: string; plan?: string }) {
  if (DATABASE_TYPE === 'postgresql') {
    return updateCompanyPostgres(companyId, fields);
  }

  return false;
}

export async function getCompanyApps(companyId: string) {
  if (DATABASE_TYPE === 'postgresql') {
    return getCompanyAppsPostgres(companyId);
  }

  return [];
}

export async function updateAppStatus(
  projectId: string,
  status: import('./database-postgresql').AppStatus,
  extra?: { deploy_url?: string; github_repo?: string; build_logs?: string }
) {
  if (DATABASE_TYPE === 'postgresql') {
    return updateAppStatusPostgres(projectId, status, extra);
  }

  return false;
}

export async function getInactiveApps(thresholdMinutes = 15) {
  if (DATABASE_TYPE === 'postgresql') {
    return getInactiveAppsPostgres(thresholdMinutes);
  }

  return [];
}

export async function addAuditLog(params: {
  companyId: string;
  actorId: string;
  projectId?: string | null;
  action: import('./database-postgresql').AuditAction;
  payload?: Record<string, unknown>;
  ipAddress?: string | null;
}) {
  if (DATABASE_TYPE === 'postgresql') {
    return addAuditLogPostgres(params);
  }

  return false;
}

export async function getAuditLogs(companyId: string, limit = 50) {
  if (DATABASE_TYPE === 'postgresql') {
    return getAuditLogsPostgres(companyId, limit);
  }

  return [];
}

// Rate limiting — ported from feat/persistence-architecture-v2 (routes by DATABASE_TYPE).
export async function checkRateLimit(
  key: string,
  endpoint: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  if (DATABASE_TYPE === 'postgresql') {
    return checkRateLimitPostgres(key, endpoint, maxAttempts, windowSeconds);
  }

  return checkRateLimitSQLite(key, endpoint, maxAttempts, windowSeconds);
}

export async function checkRateLimitSQLite(
  key: string,
  endpoint: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const db = getDatabase();
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  const existing = db
    .prepare('SELECT attempts, first_attempt FROM rate_limits WHERE ip_address = ? AND endpoint = ?')
    .get(key, endpoint) as { attempts: number; first_attempt: string } | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO rate_limits (id, ip_address, endpoint, attempts, first_attempt, last_attempt)
       VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))`
    ).run(crypto.randomUUID(), key, endpoint);
    return { allowed: true };
  }

  const firstAttempt = new Date(existing.first_attempt).getTime();
  const elapsed = now - firstAttempt;

  if (elapsed > windowMs) {
    db.prepare(
      `UPDATE rate_limits SET attempts = 1, first_attempt = datetime('now'), last_attempt = datetime('now') WHERE ip_address = ? AND endpoint = ?`
    ).run(key, endpoint);
    return { allowed: true };
  }

  if (existing.attempts >= maxAttempts) {
    const retryAfterSeconds = Math.ceil((windowMs - elapsed) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  db.prepare(
    `UPDATE rate_limits SET attempts = attempts + 1, last_attempt = datetime('now') WHERE ip_address = ? AND endpoint = ?`
  ).run(key, endpoint);

  return { allowed: true };
}
