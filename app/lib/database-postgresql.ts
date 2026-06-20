import pg from 'pg';
import crypto from 'crypto';
import { buildProjectChatPath, DEFAULT_PROJECT_ID } from '~/utils/chatRoutes';
// Database schema, inlined at build time. schema.sql is the single source of truth.
import schemaSql from '../../schema.sql?raw';

const { Pool } = pg;
type PoolClient = pg.PoolClient;

// PostgreSQL connection pool
let pool: InstanceType<typeof Pool>;
let migrateReady: Promise<void> | null = null;
let migrationRunning = false;

/** Run createPostgresTables() once; safe to call from every DB entry point. */
export function ensurePostgresReady(): Promise<void> {
  if (!migrateReady) {
    migrateReady = createPostgresTables().catch((err: unknown) => {
      migrateReady = null;
      throw err;
    });
  }

  return migrateReady;
}

export function getPostgresPool(): InstanceType<typeof Pool> {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required for PostgreSQL');
    }

    pool = new Pool({
      connectionString: databaseUrl,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
    });

    pool.on('error', (err: Error) => {
      console.error('Unexpected error on idle client', err);
    });

    const nativeConnect = pool.connect.bind(pool);
    pool.connect = ((...args: Parameters<typeof nativeConnect>) => {
      if (migrationRunning) {
        return nativeConnect(...args);
      }

      if (args.length > 0) {
        return ensurePostgresReady().then(() => nativeConnect(...args));
      }

      return ensurePostgresReady().then(() => nativeConnect());
    }) as typeof pool.connect;
  }

  return pool;
}

export async function createPostgresTables() {
  migrationRunning = true;
  const pool = getPostgresPool();
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
    /*
     * schema.sql is the single source of truth for the database schema,
     * inlined at build time via Vite ?raw import. Re-running on every startup
     * is safe because every statement is idempotent (CREATE TABLE/INDEX IF
     * NOT EXISTS, INSERT ... ON CONFLICT). Schema changes go in schema.sql only.
     */
    await client.query(schemaSql);
    console.log('PostgreSQL schema applied successfully');
  } catch (error) {
    console.error('Error applying PostgreSQL schema:', error);
    throw error;
  } finally {
    client?.release();
    migrationRunning = false;
  }
}

// Database helper functions for PostgreSQL
export type ContactSubmissionInput = {
  id: string;
  enquiryType: string;
  name: string;
  email: string;
  phone: string;
  country: string;
  countryCode: string | null;
  message: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function insertContactSubmissionPostgres(row: ContactSubmissionInput): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `INSERT INTO contact_submissions (
        id, enquiry_type, name, email, phone, country, country_code, message, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.id,
        row.enquiryType,
        row.name,
        row.email,
        row.phone,
        row.country,
        row.countryCode,
        row.message,
        row.ipAddress ?? null,
        row.userAgent ?? null,
      ]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error inserting contact submission:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function getUserByEmailPostgres(email: string) {
  const pool = getPostgresPool();
  let client;

  try {
    client = await pool.connect();

    const result = await client.query('SELECT * FROM users WHERE email = $1', [email]);

    return result.rows[0] || null;
  } catch (error: any) {
    console.error('❌ Error getting user by email:', error);

    // Re-throw connection errors so they can be handled upstream
    if (
      error.message?.includes('timeout') ||
      error.message?.includes('Connection terminated') ||
      error.message?.includes('ECONNREFUSED') ||
      error.message?.includes('ENOTFOUND')
    ) {
      throw error; // Let the caller handle connection errors
    }

    return null;
  } finally {
    if (client) {
      client.release();
    }
  }
}

/** The deterministic id of a user's personal workspace (a 1-seat company). */
export function personalCompanyId(userId: string): string {
  return `cmp_personal_${userId}`;
}

/** Ensure the user's personal workspace (companies row + owner membership) exists. Idempotent. */
async function ensurePersonalCompanyWithClient(client: PoolClient, userId: string): Promise<string> {
  const companyId = personalCompanyId(userId);
  await client.query(
    `INSERT INTO companies (id, name, slug, plan, is_personal, seats, owner_user_id)
     VALUES ($1, 'Personal', $2, 'free', TRUE, 1, $3)
     ON CONFLICT (id) DO NOTHING`,
    [companyId, `personal-${userId}`, userId]
  );
  await client.query(
    `INSERT INTO company_members (id, company_id, user_id, role)
     VALUES ($1, $2, $3, 'owner')
     ON CONFLICT (company_id, user_id) DO NOTHING`,
    [`cmpm_personal_${userId}`, companyId, userId]
  );

  return companyId;
}

/** Create the personal workspace + Trial subscription + token pool for a user. Idempotent. */
async function createSubscriptionForUserWithClient(client: PoolClient, userId: string): Promise<void> {
  const companyId = await ensurePersonalCompanyWithClient(client, userId);

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  /*
   * Ensure a Trial subscription exists for the workspace. Check-then-insert (no
   * ON CONFLICT) so this can't throw if the uq_subscriptions_company_id index is
   * missing — a silent failure here is exactly what leaves new accounts tokenless.
   */
  const existingSub = await client.query(`SELECT id FROM subscriptions WHERE company_id = $1 LIMIT 1`, [companyId]);
  let subId = existingSub.rows[0]?.id as string | undefined;

  if (!subId) {
    subId = crypto.randomUUID();
    await client.query(
      `INSERT INTO subscriptions (id, user_id, company_id, tier_id, status, current_period_start, current_period_end)
       VALUES ($1, $2, $3, 'tier_trial', 'active', $4, $5)`,
      [subId, userId, companyId, now.toISOString(), periodEnd.toISOString()]
    );
  }

  /*
   * Grant the free token pool only if the workspace doesn't already have one. This is
   * gated on the *balance* existing — not on the subscription INSERT succeeding — so a
   * pre-existing subscription row (partial earlier run, Stripe customer setup, re-verify)
   * can never leave the account tokenless. Idempotent: safe to call at signup and verify.
   */
  const existingBalance = await client.query(
    `SELECT 1 FROM token_balances WHERE company_id = $1 AND source = 'tier' LIMIT 1`,
    [companyId]
  );

  if (existingBalance.rows.length > 0) {
    return;
  }

  const tierResult = await client.query(`SELECT limits FROM subscription_tiers WHERE id = 'tier_trial'`);
  const limits = tierResult.rows[0]?.limits;
  const tokens = limits?.tokens ?? 150000;

  const balanceId = crypto.randomUUID();
  await client.query(
    `INSERT INTO token_balances (id, user_id, company_id, source, source_reference_id, tokens_allocated, tokens_used, effective_start, effective_end)
     VALUES ($1, $2, $3, 'tier', $4, $5, 0, $6, $7)`,
    [balanceId, userId, companyId, subId, tokens, now.toISOString(), periodEnd.toISOString()]
  );
}

/**
 * Idempotently ensure a user has their personal workspace + Trial token pool, in its
 * own transaction. Safe to call on every login as a self-healing net — it only grants
 * if the workspace has never had a tier balance, so it never refills a used-up trial.
 */
export async function ensureUserTrialPostgres(userId: string): Promise<void> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await createSubscriptionForUserWithClient(client, userId);
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('ensureUserTrial failed:', e);
  } finally {
    client.release();
  }
}

/** Get subscription by user ID. For future subscription/upgrade logic. */
export async function getSubscriptionByUserIdPostgres(userId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT s.*, st.name as tier_name, st.display_name as tier_display_name, st.price_cents, st.limits
      FROM subscriptions s
      JOIN subscription_tiers st ON s.tier_id = st.id
      WHERE s.user_id = $1
    `,
      [userId]
    );
    return result.rows[0] || null;
  } catch (error: any) {
    console.error('Error getting subscription by user:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function createUserPostgres(user: any) {
  const pool = getPostgresPool();
  let client;

  try {
    client = await pool.connect();

    const result = await client.query(
      `
      INSERT INTO users (id, email, password_hash, is_verified, verification_token, verification_expires, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
      [
        user.id,
        user.email,
        user.passwordHash,
        user.isVerified,
        user.verificationToken,
        user.verificationExpires,
        user.createdAt,
      ]
    );

    const created = result.rowCount !== null && result.rowCount > 0;

    /*
     * Grant the free token pool as soon as the account is usable. When email verification
     * is OFF the account is already verified at registration, so grant now; when it's ON
     * the account isn't usable yet and verifyUser grants on the same (idempotent) path.
     * A grant hiccup must not fail registration, so we only warn here.
     */
    if (created && user.isVerified) {
      try {
        await createSubscriptionForUserWithClient(client, user.id);
      } catch (subErr: any) {
        console.warn('Could not grant signup tokens (will retry on verify):', subErr?.message ?? subErr);
      }
    }

    return created;
  } catch (error: any) {
    console.error('❌ Error creating user:', error);

    // Re-throw connection errors so they can be handled upstream
    if (
      error.message?.includes('timeout') ||
      error.message?.includes('Connection terminated') ||
      error.message?.includes('ECONNREFUSED') ||
      error.message?.includes('ENOTFOUND')
    ) {
      throw error;
    }

    // Re-throw duplicate key errors
    if (
      error.code === '23505' ||
      error.message?.includes('duplicate key') ||
      error.message?.includes('unique constraint')
    ) {
      throw error;
    }

    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
}

export async function getUserByVerificationTokenPostgres(token: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query('SELECT * FROM users WHERE verification_token = $1', [token]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting user by verification token:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function verifyUserPostgres(userId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
      UPDATE users 
      SET is_verified = TRUE, verification_token = NULL, verification_expires = NULL 
      WHERE id = $1
    `,
      [userId]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    try {
      await createSubscriptionForUserWithClient(client, userId);
    } catch (subErr: any) {
      console.warn('Could not create subscription (table may not exist):', subErr?.message ?? subErr);
    }
    await client.query('COMMIT');

    return true;
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    console.error('Error verifying user:', error);

    return false;
  } finally {
    client.release();
  }
}

const RESET_TOKEN_EXPIRY_HOURS = 1;

/** Create a password reset token for the user with the given email. Returns the token and user, or null. */
export async function createPasswordResetTokenPostgres(
  email: string
): Promise<{ token: string; user: { id: string; email: string } } | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const userResult = await client.query('SELECT id, email FROM users WHERE email = $1', [email]);
    const user = userResult.rows[0];

    if (!user) {
      return null;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    await client.query('UPDATE users SET reset_token = $1, reset_expires = $2 WHERE id = $3', [
      token,
      expires,
      user.id,
    ]);

    return { token, user: { id: user.id, email: user.email } };
  } catch (error) {
    console.error('Error creating password reset token:', error);
    return null;
  } finally {
    client.release();
  }
}

/** Get user by reset token (for validating link). */
export async function getUserByResetTokenPostgres(token: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query('SELECT * FROM users WHERE reset_token = $1', [token]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting user by reset token:', error);
    return null;
  } finally {
    client.release();
  }
}

/** Set new password from valid reset token and clear token. Returns true if updated. */
export async function setPasswordFromResetTokenPostgres(token: string, passwordHash: string): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      UPDATE users
      SET password_hash = $1, reset_token = NULL, reset_expires = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE reset_token = $2 AND reset_expires > CURRENT_TIMESTAMP
    `,
      [passwordHash, token]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error setting password from reset token:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function updateLoginAttemptsPostgres(email: string, attempts: number) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(
      `
      UPDATE users 
      SET login_attempts = $1, last_login = CURRENT_TIMESTAMP 
      WHERE email = $2
    `,
      [attempts, email]
    );
    return true;
  } catch (error) {
    console.error('Error updating login attempts:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function resetLoginAttemptsPostgres(userId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(
      `
      UPDATE users 
      SET login_attempts = 0, last_login = CURRENT_TIMESTAMP 
      WHERE id = $1
    `,
      [userId]
    );
    return true;
  } catch (error) {
    console.error('Error resetting login attempts:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function logEmailPostgres(userId: string, emailType: string, delivered: boolean, errorMessage?: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(
      `
      INSERT INTO email_logs (id, user_id, email_type, delivered, error_message)
      VALUES ($1, $2, $3, $4, $5)
    `,
      [crypto.randomUUID(), userId, emailType, delivered, errorMessage]
    );
    return true;
  } catch (error) {
    console.error('Error logging email:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function createUserSessionPostgres(
  userId: string,
  tokenHash: string,
  expiresAt: string,
  ipAddress?: string,
  userAgent?: string
) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    // First, invalidate any existing sessions for this user (single session enforcement)
    await invalidateUserSessionsPostgres(userId);

    // Create new session
    const result = await client.query(
      `
      INSERT INTO user_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
      [crypto.randomUUID(), userId, tokenHash, expiresAt, ipAddress || null, userAgent || null]
    );

    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error creating user session:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function invalidateUserSessionsPostgres(userId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
    return true;
  } catch (error) {
    console.error('Error invalidating user sessions:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function validateSessionPostgres(tokenHash: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT us.*, u.email, u.is_verified 
      FROM user_sessions us
      JOIN users u ON us.user_id = u.id
      WHERE us.token_hash = $1 AND us.expires_at > NOW()
    `,
      [tokenHash]
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error('Error validating session:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function updateSessionActivityPostgres(tokenHash: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(
      `
      UPDATE user_sessions 
      SET last_used = NOW()
      WHERE token_hash = $1
    `,
      [tokenHash]
    );
    return true;
  } catch (error) {
    console.error('Error updating session activity:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function logoutUserPostgres(tokenHash: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
    return true;
  } catch (error) {
    console.error('Error logging out user:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function getActiveSessionCountPostgres(userId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT COUNT(*) as count 
      FROM user_sessions 
      WHERE user_id = $1 AND expires_at > NOW()
    `,
      [userId]
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Error getting active session count:', error);
    return 0;
  } finally {
    client.release();
  }
}

// Token usage and balance functions

/**
 * Apply FIFO consumption from a workspace's pooled balance (+ optional overage on sink row).
 * Scopes to company_id, falling back to user_id rows not yet backfilled. If tokenUsageId is
 * set, writes Level B allocation rows.
 */
async function applyTokenConsumptionInTransaction(
  client: PoolClient,
  companyId: string | null,
  userId: string,
  n: number,
  tokenUsageId: string | null
): Promise<void> {
  const now = new Date().toISOString();
  const balances = await client.query(
    `SELECT id, tokens_allocated, tokens_used
     FROM token_balances
     WHERE (company_id = $1 OR (company_id IS NULL AND user_id = $2))
       AND effective_start <= $3::timestamptz
       AND (effective_end IS NULL OR effective_end >= $3::timestamptz)
     ORDER BY effective_end ASC NULLS LAST`,
    [companyId, userId, now]
  );

  const insertAllocation = async (tokenBalanceId: string, tokens: number) => {
    if (!tokenUsageId || tokens <= 0) {
      return;
    }

    await client.query(
      `INSERT INTO token_consumption_allocations (id, token_usage_id, token_balance_id, tokens)
       VALUES ($1, $2, $3, $4)`,
      [crypto.randomUUID(), tokenUsageId, tokenBalanceId, tokens]
    );
  };

  let remaining = n;

  for (const row of balances.rows) {
    if (remaining <= 0) {
      break;
    }

    const allocated = Number(row.tokens_allocated);
    const used = Number(row.tokens_used);
    const available = allocated - used;

    if (available <= 0) {
      continue;
    }

    const deduct = Math.min(remaining, available);
    await client.query(
      `UPDATE token_balances SET tokens_used = tokens_used + $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [row.id, deduct]
    );
    await insertAllocation(row.id as string, deduct);
    remaining -= deduct;
  }

  if (remaining > 0) {
    const rows = balances.rows as { id: string }[];

    if (rows.length > 0) {
      const sinkId = rows[rows.length - 1].id as string;
      await client.query(
        `UPDATE token_balances SET tokens_used = tokens_used + $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [sinkId, remaining]
      );
      await insertAllocation(sinkId, remaining);
    } else {
      const newBalanceId = crypto.randomUUID();
      await client.query(
        `INSERT INTO token_balances (id, user_id, company_id, source, source_reference_id, tokens_allocated, tokens_used, effective_start, effective_end)
         VALUES ($1, $2, $3, 'grant', 'balance-overage', 0, $4, $5::timestamptz, NULL)`,
        [newBalanceId, userId, companyId, remaining, now]
      );
      await insertAllocation(newBalanceId, remaining);
    }
  }
}

/** Level B: insert token_usage + allocation rows + update token_balances in one transaction. */
export async function insertTokenUsageAndConsumePostgres(params: {
  chatId: string;
  messageId: string;
  userId: string;
  companyId?: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
  provider?: string;
}): Promise<boolean> {
  const n = Math.floor(Number(params.totalTokens));

  if (!Number.isFinite(n) || n <= 0) {
    return false;
  }

  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Resolve the billing workspace from the chat's project when not supplied.
    let companyId = params.companyId ?? null;

    if (!companyId) {
      const r = await client.query(
        `SELECT p.company_id FROM chats c JOIN projects p ON p.id = c.project_id WHERE c.id = $1`,
        [params.chatId]
      );
      companyId = (r.rows[0]?.company_id as string) ?? null;
    }

    const tokenUsageId = crypto.randomUUID();
    await client.query(
      `INSERT INTO token_usage (id, chat_id, message_id, user_id, company_id, prompt_tokens, completion_tokens, total_tokens, model, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        tokenUsageId,
        params.chatId,
        params.messageId,
        params.userId,
        companyId,
        params.promptTokens,
        params.completionTokens,
        params.totalTokens,
        params.model ?? null,
        params.provider ?? null,
      ]
    );
    await applyTokenConsumptionInTransaction(client, companyId, params.userId, n, tokenUsageId);
    await client.query('COMMIT');

    return true;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback errors */
    }
    console.error('Error in insertTokenUsageAndConsumePostgres:', error);

    return false;
  } finally {
    client.release();
  }
}

export async function insertTokenUsagePostgres(params: {
  chatId: string;
  messageId: string;
  userId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model?: string;
  provider?: string;
}): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO token_usage (id, chat_id, message_id, user_id, prompt_tokens, completion_tokens, total_tokens, model, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        params.chatId,
        params.messageId,
        params.userId,
        params.promptTokens,
        params.completionTokens,
        params.totalTokens,
        params.model ?? null,
        params.provider ?? null,
      ]
    );

    return true;
  } catch (error) {
    console.error('Error inserting token usage:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function getTokenBalanceRemainingPostgres(userId: string): Promise<number> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const now = new Date().toISOString();
    const result = await client.query(
      `SELECT COALESCE(SUM(tokens_allocated - tokens_used), 0)::bigint as remaining
       FROM token_balances
       WHERE user_id = $1
         AND effective_start <= $2
         AND (effective_end IS NULL OR effective_end >= $2)`,
      [userId, now]
    );

    return parseInt(String(result.rows[0]?.remaining ?? 0), 10);
  } catch (error) {
    console.error('Error getting token balance:', error);
    return 0;
  } finally {
    client.release();
  }
}

/** Remaining tokens in a workspace's pool. Falls back to not-yet-backfilled user rows. */
export async function getTokenBalanceRemainingForCompanyPostgres(companyId: string, userId?: string): Promise<number> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const now = new Date().toISOString();
    const result = await client.query(
      `SELECT COALESCE(SUM(tokens_allocated - tokens_used), 0)::bigint as remaining
       FROM token_balances
       WHERE (company_id = $1 OR (company_id IS NULL AND user_id = $2))
         AND effective_start <= $3
         AND (effective_end IS NULL OR effective_end >= $3)`,
      [companyId, userId ?? null, now]
    );

    return parseInt(String(result.rows[0]?.remaining ?? 0), 10);
  } catch (error) {
    console.error('Error getting company token balance:', error);
    return 0;
  } finally {
    client.release();
  }
}

/** A workspace's subscription + tier info (the workspace-scoped equivalent of getSubscriptionByUserId). */
export async function getSubscriptionByCompanyIdPostgres(companyId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT s.*, st.name as tier_name, st.display_name as tier_display_name, st.price_cents, st.limits
       FROM subscriptions s
       JOIN subscription_tiers st ON s.tier_id = st.id
       WHERE s.company_id = $1`,
      [companyId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting subscription by company:', error);
    return null;
  } finally {
    client.release();
  }
}

/** Resolve the workspace that owns a chat (via its project). Null if not found. */
export async function getCompanyIdForChatPostgres(chatId: string): Promise<string | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT p.company_id FROM chats c JOIN projects p ON p.id = c.project_id WHERE c.id = $1 LIMIT 1`,
      [chatId]
    );
    return (result.rows[0]?.company_id as string) ?? null;
  } catch (error) {
    console.error('Error resolving company for chat:', error);
    return null;
  } finally {
    client.release();
  }
}

/** A workspace's seat cap (from its plan). Defaults to 1. */
export async function getCompanySeatsPostgres(companyId: string): Promise<number> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(`SELECT seats FROM companies WHERE id = $1`, [companyId]);
    return result.rows[0]?.seats ?? 1;
  } catch (error) {
    console.error('Error getting company seats:', error);
    return 1;
  } finally {
    client.release();
  }
}

/** Number of members in a workspace (for seat-limit enforcement). */
export async function getCompanyMemberCountPostgres(companyId: string): Promise<number> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(`SELECT COUNT(*)::int AS n FROM company_members WHERE company_id = $1`, [
      companyId,
    ]);
    return result.rows[0]?.n ?? 0;
  } catch (error) {
    console.error('Error counting company members:', error);
    return 0;
  } finally {
    client.release();
  }
}

async function ensureDefaultProjectForUser(client: PoolClient, userId: string): Promise<string> {
  const defaultProjectId = `proj_personal_${userId}`;
  const companyId = await ensurePersonalCompanyWithClient(client, userId);
  await client.query(
    `
      INSERT INTO projects (id, owner_user_id, company_id, slug, name, description)
      VALUES ($1, $2, $3, $4, 'Personal', 'Default personal project')
      ON CONFLICT (id) DO NOTHING
    `,
    [defaultProjectId, userId, companyId, DEFAULT_PROJECT_ID]
  );
  await client.query(
    `
      INSERT INTO project_members (id, project_id, user_id, role)
      VALUES ($1, $2, $3, 'owner')
      ON CONFLICT (project_id, user_id) DO NOTHING
    `,
    [crypto.randomUUID(), defaultProjectId, userId]
  );

  return defaultProjectId;
}

async function resolveWritableProjectId(client: PoolClient, userId: string, projectId?: string): Promise<string> {
  if (!projectId) {
    return ensureDefaultProjectForUser(client, userId);
  }

  const access = await client.query(
    `
      SELECT 1
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $2
      WHERE p.id = $1 AND (p.owner_user_id = $2 OR pm.user_id = $2)
      LIMIT 1
    `,
    [projectId, userId]
  );

  if (access.rows.length > 0) {
    return projectId;
  }

  return ensureDefaultProjectForUser(client, userId);
}

// Chat Management Functions
export async function saveChatPostgres(userId: string, chatData: any): Promise<string | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const {
      id,
      urlId,
      url_id: legacyUrlId,
      description,
      messages,
      metadata,
      projectId,
      project_id: legacyProjectId,
    } = chatData;
    const resolvedUrlId = urlId ?? legacyUrlId;
    const resolvedProjectId = await resolveWritableProjectId(client, userId, projectId ?? legacyProjectId);
    const query = `
      INSERT INTO chats (id, user_id, project_id, url_id, description, messages, metadata, updated_at, last_activity)
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        project_id = EXCLUDED.project_id,
        description = EXCLUDED.description,
        messages = EXCLUDED.messages,
        metadata = EXCLUDED.metadata,
        updated_at = CURRENT_TIMESTAMP,
        last_activity = CURRENT_TIMESTAMP
      RETURNING id
    `;
    const result = await client.query(query, [
      id,
      userId,
      resolvedProjectId,
      resolvedUrlId,
      description,
      JSON.stringify(messages),
      JSON.stringify(metadata),
    ]);
    const savedId = result.rows[0]?.id || null;

    // Project creator is always the owner: add them to chat_members with role 'owner'
    if (savedId) {
      await client.query(
        `
        INSERT INTO chat_members (id, chat_id, user_id, role)
        VALUES ($1, $2, $3, 'owner')
        ON CONFLICT (chat_id, user_id) DO NOTHING
      `,
        [crypto.randomUUID(), id, userId]
      );
    }

    // Sync prompts table from user messages (record account + chat per prompt)
    if (savedId && Array.isArray(messages)) {
      await syncPromptsFromChatMessagesPostgres(client, id, messages, userId);
    }

    return savedId;
  } catch (error) {
    console.error('Error saving chat to PostgreSQL:', error);
    return null;
  } finally {
    client.release();
  }
}

/** Sync prompts table from chat messages - one row per user prompt with account + chat */
async function syncPromptsFromChatMessagesPostgres(
  client: PoolClient,
  chatId: string,
  messages: any[],
  defaultUserId: string
): Promise<void> {
  for (const msg of messages) {
    if (msg?.role !== 'user') {
      continue;
    }

    const messageId = msg.id;

    if (!messageId || typeof messageId !== 'string') {
      continue;
    }

    const authorId = msg?.author?.id;
    const userId = authorId && typeof authorId === 'string' ? authorId : defaultUserId;
    await client.query(
      `INSERT INTO prompts (id, chat_id, user_id, message_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (chat_id, message_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [crypto.randomUUID(), chatId, userId, messageId]
    );
  }
}

export async function insertPromptPostgres(params: {
  chatId: string;
  userId: string;
  messageId: string;
}): Promise<string | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO prompts (id, chat_id, user_id, message_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (chat_id, message_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [id, params.chatId, params.userId, params.messageId]
    );

    return id;
  } catch (error) {
    console.error('Error inserting prompt:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function getPromptsByChatIdPostgres(
  chatId: string,
  requestingUserId: string,
  isModerator?: boolean
): Promise<{ id: string; message_id: string; user_id: string; email: string; created_at: string }[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    // Ensure requester has access to the chat
    const accessCheck = await client.query(
      `SELECT 1 FROM chats c
       LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN project_members pm ON pm.project_id = c.project_id AND pm.user_id = $2
       WHERE (c.id = $1 OR c.url_id = $1)
         AND (c.user_id = $2 OR cm.user_id = $2 OR p.owner_user_id = $2 OR pm.user_id = $2)`,
      [chatId, requestingUserId]
    );

    if (accessCheck.rows.length === 0 && !isModerator) {
      return [];
    }

    const result = await client.query(
      `SELECT p.id, p.message_id, p.user_id, p.created_at, u.email
       FROM prompts p
       JOIN users u ON p.user_id = u.id
       WHERE p.chat_id = (SELECT id FROM chats WHERE id = $1 OR url_id = $1 LIMIT 1)
       ORDER BY p.created_at ASC`,
      [chatId]
    );

    return result.rows.map((r: any) => ({
      id: r.id,
      message_id: r.message_id,
      user_id: r.user_id,
      email: r.email,
      created_at: r.created_at,
    }));
  } catch (error) {
    console.error('Error fetching prompts:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function getChatsByUserPostgres(userId: string, isModerator?: boolean): Promise<any[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    if (isModerator) {
      const result = await client.query(`
        SELECT c.id, c.project_id, c.url_id, c.description, c.messages, c.metadata, c.created_at, c.updated_at, c.last_activity, c.is_archived
        FROM chats c
        ORDER BY c.updated_at DESC
      `);
      return result.rows.map(row => ({
        ...row,
        messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      }));
    }

    // Include chats where user can access the owning project
    const query = `
      SELECT DISTINCT c.id, c.project_id, c.url_id, c.description, c.messages, c.metadata, c.created_at, c.updated_at, c.last_activity, c.is_archived
      FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $1
      LEFT JOIN projects p ON p.id = c.project_id
      LEFT JOIN project_members pm ON pm.project_id = c.project_id AND pm.user_id = $1
      WHERE c.user_id = $1 OR cm.user_id = $1 OR p.owner_user_id = $1 OR pm.user_id = $1
      ORDER BY c.updated_at DESC
    `;
    const result = await client.query(query, [userId]);

    return result.rows.map(row => ({
      ...row,
      messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    }));
  } catch (error) {
    console.error('Error fetching chats from PostgreSQL:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function getChatByIdPostgres(
  chatId: string,
  userId: string,
  isModerator?: boolean,
  projectId?: string
): Promise<any | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    if (isModerator) {
      const result = await client.query(
        `
        SELECT c.id, c.project_id, c.url_id, c.description, c.messages, c.metadata, c.created_at, c.updated_at, c.last_activity, c.is_archived, c.user_id
        FROM chats c
        WHERE (c.id = $1 OR c.url_id = $1)
          AND ($2::text IS NULL OR c.project_id = $2)
      `,
        [chatId, projectId ?? null]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      return {
        ...row,
        messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      };
    }

    // Allow access if user can access the chat or its owning project
    const query = `
      SELECT c.id, c.project_id, c.url_id, c.description, c.messages, c.metadata, c.created_at, c.updated_at, c.last_activity, c.is_archived, c.user_id
      FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
      LEFT JOIN projects p ON p.id = c.project_id
      LEFT JOIN project_members pm ON pm.project_id = c.project_id AND pm.user_id = $2
      WHERE (c.id = $1 OR c.url_id = $1)
        AND ($3::text IS NULL OR c.project_id = $3)
        AND (c.user_id = $2 OR cm.user_id = $2 OR p.owner_user_id = $2 OR pm.user_id = $2)
    `;
    const result = await client.query(query, [chatId, userId, projectId ?? null]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    return {
      ...row,
      messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
    };
  } catch (error) {
    console.error('Error fetching chat by ID from PostgreSQL:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function deleteChatPostgres(chatId: string, userId: string): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const query = `
      DELETE FROM chats 
      WHERE id = $1 AND user_id = $2
    `;
    const result = await client.query(query, [chatId, userId]);

    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error deleting chat from PostgreSQL:', error);
    return false;
  } finally {
    client.release();
  }
}

// User Activity Functions
export async function logUserActivityPostgres(
  userId: string,
  actionType: string,
  actionDetails: any = {},
  ipAddress?: string,
  userAgent?: string
): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const query = `
      INSERT INTO user_activity (id, user_id, action_type, action_details, ip_address, user_agent, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `;
    const activityId = crypto.randomUUID();
    const result = await client.query(query, [
      activityId,
      userId,
      actionType,
      JSON.stringify(actionDetails),
      ipAddress,
      userAgent,
    ]);

    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Error logging user activity to PostgreSQL:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function getUserActivityPostgres(userId: string, limit: number = 100): Promise<any[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const query = `
      SELECT id, action_type, action_details, ip_address, user_agent, created_at
      FROM user_activity 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2
    `;
    const result = await client.query(query, [userId, limit]);

    return result.rows.map(row => ({
      ...row,
      action_details: typeof row.action_details === 'string' ? JSON.parse(row.action_details) : row.action_details,
    }));
  } catch (error) {
    console.error('Error fetching user activity from PostgreSQL:', error);
    return [];
  } finally {
    client.release();
  }
}

export type ProjectOverviewRecentRun = {
  at: string;
  chatId: string;
  projectId: string;
  /** Prefer this for canonical chat links when present. */
  chatUrlId: string | null;
  projectTitle: string | null;
  totalTokens: number;
  model: string | null;
  provider: string | null;
};

export type ProjectOverview = {
  projectCount: number;
  activeProjectsLast7Days: number;
  tokensLast7Days: number;
  runsLast7Days: number;
  tokenBalanceRemaining: number;
  /** Share of failed-tagged activity vs LLM runs in the last 7 days; null if no denominator. */
  errorRatePercent: number | null;
  failuresLast7Days: number;
  recentRuns: ProjectOverviewRecentRun[];
  healthStatus: 'healthy' | 'attention';
  healthReasons: string[];
};

/** Lightweight dashboard stats for /app/overview (no full chat message payloads). */
export async function getProjectOverviewPostgres(
  userId: string,
  isModerator?: boolean,
  companyId?: string
): Promise<ProjectOverview> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  const empty: ProjectOverview = {
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

  try {
    const now = new Date().toISOString();

    const projectAgg = isModerator
      ? await client.query(
          `SELECT
             COUNT(*)::int AS project_count,
             COUNT(*) FILTER (WHERE p.updated_at >= NOW() - INTERVAL '7 days')::int AS active_7d
           FROM projects p`
        )
      : await client.query(
          `SELECT
             COUNT(DISTINCT p.id)::int AS project_count,
             COUNT(DISTINCT p.id) FILTER (WHERE p.updated_at >= NOW() - INTERVAL '7 days')::int AS active_7d
           FROM projects p
           LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
           WHERE p.owner_user_id = $1 OR pm.user_id = $1`,
          [userId]
        );

    const projectCount = projectAgg.rows[0]?.project_count ?? 0;
    const activeProjectsLast7Days = projectAgg.rows[0]?.active_7d ?? 0;

    const usageAgg = await client.query(
      `SELECT
         COALESCE(SUM(total_tokens), 0)::bigint AS tokens_7d,
         COUNT(*)::int AS runs_7d
       FROM token_usage
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '7 days'`,
      [userId]
    );
    const tokensLast7Days = parseInt(String(usageAgg.rows[0]?.tokens_7d ?? 0), 10);
    const runsLast7Days = usageAgg.rows[0]?.runs_7d ?? 0;

    const failAgg = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM user_activity
       WHERE user_id = $1
         AND created_at >= NOW() - INTERVAL '7 days'
         AND (
           action_type ILIKE '%error%'
           OR action_type ILIKE '%fail%'
           OR action_type IN ('llm_call_failed', 'chat_stream_error')
         )`,
      [userId]
    );
    const failuresLast7Days = failAgg.rows[0]?.n ?? 0;

    const denom = failuresLast7Days + runsLast7Days;
    const errorRatePercent = denom > 0 ? Math.round((1000 * failuresLast7Days) / denom) / 10 : null;

    const balanceResult = await client.query(
      `SELECT COALESCE(SUM(tokens_allocated - tokens_used), 0)::bigint AS remaining
       FROM token_balances
       WHERE (company_id = $1 OR (company_id IS NULL AND user_id = $2))
         AND effective_start <= $3
         AND (effective_end IS NULL OR effective_end >= $3)`,
      [companyId ?? `cmp_personal_${userId}`, userId, now]
    );
    const tokenBalanceRemaining = parseInt(String(balanceResult.rows[0]?.remaining ?? 0), 10);

    const recent = await client.query(
      `SELECT tu.created_at, tu.chat_id, c.project_id, c.url_id AS chat_url_id, tu.total_tokens, tu.model, tu.provider, c.description
       FROM token_usage tu
       LEFT JOIN chats c ON c.id = tu.chat_id
       WHERE tu.user_id = $1
       ORDER BY tu.created_at DESC
       LIMIT 12`,
      [userId]
    );
    const recentRuns: ProjectOverviewRecentRun[] = recent.rows.map((r: any) => ({
      at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      chatId: r.chat_id,
      projectId: r.project_id ?? `proj_personal_${userId}`,
      chatUrlId: r.chat_url_id ?? null,
      projectTitle: r.description ?? null,
      totalTokens: parseInt(String(r.total_tokens ?? 0), 10),
      model: r.model ?? null,
      provider: r.provider ?? null,
    }));

    let healthStatus: 'healthy' | 'attention' = 'healthy';
    const healthReasons: string[] = [];

    if (tokenBalanceRemaining === 0 && runsLast7Days > 0) {
      healthStatus = 'attention';
      healthReasons.push('Token balance is empty; add credits or a subscription to continue.');
    }

    if (errorRatePercent !== null && errorRatePercent >= 20) {
      healthStatus = 'attention';
      healthReasons.push(
        `Roughly ${errorRatePercent}% of recent activity matched failure signals (vs recorded LLM runs this week).`
      );
    }

    return {
      projectCount,
      activeProjectsLast7Days,
      tokensLast7Days,
      runsLast7Days,
      tokenBalanceRemaining,
      errorRatePercent,
      failuresLast7Days,
      recentRuns,
      healthStatus,
      healthReasons,
    };
  } catch (error) {
    console.error('Error building project overview:', error);
    return empty;
  } finally {
    client.release();
  }
}

// Chat members and invitations (multi-user project sharing)
export async function getChatMembersPostgres(
  chatId: string,
  requestingUserId: string,
  isModerator?: boolean
): Promise<{ members: { id: string; email: string; role: string }[]; currentUserRole: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    let currentUserRole: string;

    if (isModerator) {
      currentUserRole = 'moderator';
    } else {
      const accessCheck = await client.query(
        `
        SELECT c.user_id as owner_id, cm.role as member_role FROM chats c
        LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
        WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
      `,
        [chatId, requestingUserId]
      );

      if (accessCheck.rows.length === 0) {
        return { members: [], currentUserRole: '' };
      }

      currentUserRole =
        accessCheck.rows[0].owner_id === requestingUserId ? 'owner' : accessCheck.rows[0].member_role || 'member';
    }

    // Get owner from chats
    const chatRow = await client.query(`SELECT user_id FROM chats WHERE id = $1 OR url_id = $1`, [chatId]);
    const ownerId = chatRow.rows[0]?.user_id;

    if (!ownerId) {
      return { members: [], currentUserRole: '' };
    }

    const ownerUser = await client.query(`SELECT id, email FROM users WHERE id = $1`, [ownerId]);
    const members: { id: string; email: string; role: string }[] = [];

    if (ownerUser.rows[0]) {
      members.push({ id: ownerUser.rows[0].id, email: ownerUser.rows[0].email, role: 'owner' });
    }

    const memberRows = await client.query(
      `
      SELECT u.id, u.email, cm.role
      FROM chat_members cm
      JOIN users u ON cm.user_id = u.id
      JOIN chats c ON cm.chat_id = c.id
      WHERE (c.id = $1 OR c.url_id = $1) AND cm.user_id != $2
    `,
      [chatId, ownerId]
    );

    for (const row of memberRows.rows) {
      members.push({ id: row.id, email: row.email, role: row.role });
    }

    return { members, currentUserRole };
  } catch (error) {
    console.error('Error getting chat members:', error);
    return { members: [], currentUserRole: '' };
  } finally {
    client.release();
  }
}

export async function inviteToChatPostgres(
  chatId: string,
  invitingUserId: string,
  email: string,
  role: string = 'member'
): Promise<{ success: boolean; error?: string; token?: string; alreadyMember?: boolean }> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      return { success: false, error: 'Email is required' };
    }

    // Check if chat exists first (so we can give a clear error when project hasn't been saved yet)
    const chatRow = await client.query(`SELECT id FROM chats WHERE id = $1 OR url_id = $1`, [chatId]);
    const resolvedChatId = chatRow.rows[0]?.id;

    if (!resolvedChatId) {
      return {
        success: false,
        error: 'Chat not found. Save your project first (send at least one message) before inviting others.',
      };
    }

    // Check inviter has access (owner or admin)
    const accessCheck = await client.query(
      `
      SELECT cm.role, c.user_id FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
      WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
    `,
      [chatId, invitingUserId]
    );

    if (accessCheck.rows.length === 0) {
      return { success: false, error: 'Access denied to this project.' };
    }

    const inviterRole = accessCheck.rows[0].user_id === invitingUserId ? 'owner' : accessCheck.rows[0].role;

    if (inviterRole !== 'owner' && inviterRole !== 'admin') {
      return { success: false, error: 'Only owners and admins can invite' };
    }

    const invitee = await client.query(`SELECT id FROM users WHERE email = $1`, [normalizedEmail]);

    if (invitee.rows[0]) {
      const existingMember = await client.query(`SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2`, [
        resolvedChatId,
        invitee.rows[0].id,
      ]);

      if (existingMember.rows.length > 0) {
        return { success: true, alreadyMember: true };
      }
    }

    const existingInvite = await client.query(
      `SELECT token FROM chat_invitations WHERE chat_id = $1 AND LOWER(email) = $2 AND status = 'pending' AND expires_at > NOW()`,
      [resolvedChatId, normalizedEmail]
    );

    if (existingInvite.rows.length > 0) {
      return { success: false, error: 'Invitation already sent to this email' };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await client.query(
      `
      INSERT INTO chat_invitations (id, chat_id, email, invited_by_user_id, role, status, token, expires_at)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
      ON CONFLICT (chat_id, email) DO UPDATE SET token = $6, expires_at = $7, status = 'pending', invited_by_user_id = $4
    `,
      [crypto.randomUUID(), resolvedChatId, normalizedEmail, invitingUserId, role, token, expiresAt]
    );

    return { success: true, token };
  } catch (error) {
    console.error('Error inviting to chat:', error);
    return { success: false, error: 'Failed to send invitation' };
  } finally {
    client.release();
  }
}

export async function getPendingInvitationsForUserPostgres(userEmail: string): Promise<
  {
    id: string;
    chat_id: string;
    token: string;
    role: string;
    created_at: string;
    project_name: string;
    inviter_email: string;
  }[]
> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const normalizedEmail = userEmail.trim().toLowerCase();
    const result = await client.query(
      `
      SELECT ci.id, ci.chat_id, ci.token, ci.role, ci.created_at,
             COALESCE(c.description, 'Untitled project') as project_name,
             u.email as inviter_email
      FROM chat_invitations ci
      JOIN chats c ON ci.chat_id = c.id
      JOIN users u ON ci.invited_by_user_id = u.id
      WHERE LOWER(ci.email) = $1 AND ci.status = 'pending' AND ci.expires_at > NOW()
      ORDER BY ci.created_at DESC
    `,
      [normalizedEmail]
    );

    return result.rows;
  } catch (error) {
    console.error('Error getting pending invitations for user:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function getChatInvitationsPostgres(
  chatId: string,
  requestingUserId: string
): Promise<{ id: string; email: string; role: string; status: string; created_at: string }[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const accessCheck = await client.query(
      `
      SELECT 1 FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
      WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
    `,
      [chatId, requestingUserId]
    );

    if (accessCheck.rows.length === 0) {
      return [];
    }

    const chatRow = await client.query(`SELECT id FROM chats WHERE id = $1 OR url_id = $1`, [chatId]);
    const resolvedChatId = chatRow.rows[0]?.id;

    if (!resolvedChatId) {
      return [];
    }

    const result = await client.query(
      `
      SELECT id, email, role, status, created_at
      FROM chat_invitations
      WHERE chat_id = $1 AND status = 'pending' AND expires_at > NOW()
      ORDER BY created_at DESC
    `,
      [resolvedChatId]
    );

    return result.rows;
  } catch (error) {
    console.error('Error getting chat invitations:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function addChatMemberPostgres(chatId: string, userId: string, role: string = 'member'): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const chatRow = await client.query(`SELECT id FROM chats WHERE id = $1 OR url_id = $1`, [chatId]);
    const resolvedChatId = chatRow.rows[0]?.id;

    if (!resolvedChatId) {
      return false;
    }

    await client.query(
      `
      INSERT INTO chat_members (id, chat_id, user_id, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (chat_id, user_id) DO UPDATE SET role = $4
    `,
      [crypto.randomUUID(), resolvedChatId, userId, role]
    );

    return true;
  } catch (error) {
    console.error('Error adding chat member:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function updateChatMemberRolePostgres(
  chatId: string,
  requestingUserId: string,
  targetUserId: string,
  newRole: string,
  isModerator?: boolean
): Promise<{ success: boolean; error?: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    if (!['admin', 'member'].includes(newRole)) {
      return { success: false, error: 'Invalid role' };
    }

    const chatRow = await client.query(`SELECT id, user_id as owner_id FROM chats WHERE id = $1 OR url_id = $1`, [
      chatId,
    ]);
    const ownerId = chatRow.rows[0]?.owner_id;

    if (!ownerId) {
      return { success: false, error: 'Chat not found' };
    }

    if (targetUserId === ownerId) {
      return { success: false, error: 'Cannot change owner role' };
    }

    let requesterRole: string;

    if (isModerator) {
      requesterRole = 'owner';
    } else {
      const accessCheck = await client.query(
        `
        SELECT c.user_id, cm.role FROM chats c
        LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
        WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
      `,
        [chatId, requestingUserId]
      );

      if (accessCheck.rows.length === 0) {
        return { success: false, error: 'Access denied' };
      }

      requesterRole = accessCheck.rows[0].user_id === requestingUserId ? 'owner' : accessCheck.rows[0].role || 'member';
    }

    if (requesterRole === 'member') {
      return { success: false, error: 'Only owners and admins can edit roles' };
    }

    if (requesterRole === 'admin') {
      const targetMember = await client.query(
        `SELECT role FROM chat_members cm JOIN chats c ON cm.chat_id = c.id WHERE (c.id = $1 OR c.url_id = $1) AND cm.user_id = $2`,
        [chatId, targetUserId]
      );

      if (targetMember.rows[0]?.role === 'admin') {
        return { success: false, error: "Only the owner can change an admin's role" };
      }
    }

    const resolvedChatId = chatRow.rows[0]?.id;

    if (!resolvedChatId) {
      return { success: false, error: 'Chat not found' };
    }

    await client.query(`UPDATE chat_members SET role = $3 WHERE chat_id = $1 AND user_id = $2`, [
      resolvedChatId,
      targetUserId,
      newRole,
    ]);

    return { success: true };
  } catch (error) {
    console.error('Error updating member role:', error);
    return { success: false, error: 'Failed to update role' };
  } finally {
    client.release();
  }
}

export async function removeChatMemberPostgres(
  chatId: string,
  requestingUserId: string,
  targetUserId: string,
  isModerator?: boolean
): Promise<{ success: boolean; error?: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const chatRow = await client.query(`SELECT id, user_id as owner_id FROM chats WHERE id = $1 OR url_id = $1`, [
      chatId,
    ]);
    const ownerId = chatRow.rows[0]?.owner_id;
    const resolvedChatId = chatRow.rows[0]?.id;

    if (!ownerId || !resolvedChatId) {
      return { success: false, error: 'Chat not found' };
    }

    if (targetUserId === ownerId) {
      return { success: false, error: 'Cannot remove the project owner' };
    }

    let requesterRole: string;

    if (isModerator) {
      requesterRole = 'owner';
    } else {
      const accessCheck = await client.query(
        `
        SELECT c.user_id, cm.role FROM chats c
        LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
        WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
      `,
        [chatId, requestingUserId]
      );

      if (accessCheck.rows.length === 0) {
        return { success: false, error: 'Access denied' };
      }

      requesterRole = accessCheck.rows[0].user_id === requestingUserId ? 'owner' : accessCheck.rows[0].role || 'member';
    }

    if (requesterRole === 'member') {
      return { success: false, error: 'Only owners and admins can remove members' };
    }

    if (requesterRole === 'admin') {
      const targetMember = await client.query(
        `SELECT role FROM chat_members cm JOIN chats c ON cm.chat_id = c.id WHERE (c.id = $1 OR c.url_id = $1) AND cm.user_id = $2`,
        [chatId, targetUserId]
      );

      if (targetMember.rows[0]?.role === 'admin') {
        return { success: false, error: 'Only the owner can remove an admin' };
      }
    }

    await client.query(`DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2`, [resolvedChatId, targetUserId]);

    return { success: true };
  } catch (error) {
    console.error('Error removing member:', error);
    return { success: false, error: 'Failed to remove member' };
  } finally {
    client.release();
  }
}

export async function acceptInvitationByTokenPostgres(
  token: string,
  userId: string,
  userEmail: string
): Promise<{ success: boolean; chatUrl?: string; error?: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const normalizedEmail = userEmail.trim().toLowerCase();
    const invResult = await client.query(
      `
      SELECT ci.id, ci.chat_id, ci.email, ci.role, c.url_id
      FROM chat_invitations ci
      JOIN chats c ON ci.chat_id = c.id
      WHERE ci.token = $1 AND ci.status = 'pending' AND ci.expires_at > NOW()
    `,
      [token]
    );

    if (invResult.rows.length === 0) {
      return { success: false, error: 'Invitation not found or expired' };
    }

    const inv = invResult.rows[0];

    if (inv.email.toLowerCase() !== normalizedEmail) {
      return { success: false, error: 'This invitation was sent to a different email address' };
    }

    await client.query(`UPDATE chat_invitations SET status = 'accepted' WHERE id = $1`, [inv.id]);
    await addChatMemberPostgres(inv.chat_id, userId, inv.role);

    return { success: true, chatUrl: buildProjectChatPath(DEFAULT_PROJECT_ID, inv.url_id || inv.chat_id) };
  } catch (error) {
    console.error('Error accepting invitation:', error);
    return { success: false, error: 'Failed to accept invitation' };
  } finally {
    client.release();
  }
}

/*
 * ============================================================
 * Phase 2: Company (Tenant) Functions
 * ============================================================
 */

export type CompanyRole = 'admin' | 'developer' | 'viewer';
export type AppStatus = 'draft' | 'building' | 'active' | 'sleeping' | 'failed';
export type RuntimeType = 'static' | 'worker' | 'container';

export type Company = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  github_org: string | null;
  owner_user_id: string | null;
  created_at: string;
};

export type CompanyApp = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  status: AppStatus;
  runtime_type: RuntimeType;
  github_repo: string | null;
  deploy_url: string | null;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function createCompanyPostgres(
  name: string,
  slug: string,
  ownerUserId: string,
  githubOrg?: string
): Promise<Company | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const companyId = crypto.randomUUID();
    const result = await client.query(
      `INSERT INTO companies (id, name, slug, owner_user_id, github_org)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [companyId, name, slug, ownerUserId, githubOrg ?? null]
    );
    await client.query(
      `INSERT INTO company_members (id, company_id, user_id, role)
       VALUES ($1, $2, $3, 'admin')`,
      [crypto.randomUUID(), companyId, ownerUserId]
    );
    await client.query('COMMIT');

    return result.rows[0] ?? null;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('Error creating company:', error);

    return null;
  } finally {
    client.release();
  }
}

export async function getCompanyBySlugPostgres(slug: string): Promise<Company | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(`SELECT * FROM companies WHERE slug = $1 LIMIT 1`, [slug]);
    return result.rows[0] ?? null;
  } catch (error) {
    console.error('Error getting company by slug:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function getUserCompaniesPostgres(userId: string): Promise<(Company & { role: CompanyRole })[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT c.*, cm.role
       FROM companies c
       JOIN company_members cm ON c.id = cm.company_id
       WHERE cm.user_id = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting user companies:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function getCompanyMemberPostgres(
  companyId: string,
  userId: string
): Promise<{ role: CompanyRole } | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2 LIMIT 1`,
      [companyId, userId]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    console.error('Error getting company member:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function getCompanyMembersPostgres(
  companyId: string
): Promise<{ user_id: string; email: string; role: CompanyRole; joined_at: string }[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT cm.user_id, u.email, cm.role, cm.joined_at
       FROM company_members cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.company_id = $1
       ORDER BY cm.joined_at ASC`,
      [companyId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting company members:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function addCompanyMemberPostgres(companyId: string, userId: string, role: CompanyRole): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(
      `INSERT INTO company_members (id, company_id, user_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [crypto.randomUUID(), companyId, userId, role]
    );
    return true;
  } catch (error) {
    console.error('Error adding company member:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function removeCompanyMemberPostgres(companyId: string, userId: string): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(`DELETE FROM company_members WHERE company_id = $1 AND user_id = $2`, [companyId, userId]);
    return true;
  } catch (error) {
    console.error('Error removing company member:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function updateCompanyPostgres(
  companyId: string,
  fields: { name?: string; github_org?: string; plan?: string }
): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const values: unknown[] = [];
    let idx = 1;

    if (fields.name !== undefined) {
      setClauses.push(`name = $${idx++}`);
      values.push(fields.name);
    }

    if (fields.github_org !== undefined) {
      setClauses.push(`github_org = $${idx++}`);
      values.push(fields.github_org);
    }

    if (fields.plan !== undefined) {
      setClauses.push(`plan = $${idx++}`);
      values.push(fields.plan);
    }

    if (values.length === 0) {
      return true;
    }

    values.push(companyId);
    await client.query(`UPDATE companies SET ${setClauses.join(', ')} WHERE id = $${idx}`, values);

    return true;
  } catch (error) {
    console.error('Error updating company:', error);
    return false;
  } finally {
    client.release();
  }
}

/*
 * ============================================================
 * Phase 2: Company App Functions
 * ============================================================
 */

export async function getCompanyAppsPostgres(companyId: string): Promise<CompanyApp[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT id, name, slug, description, status, runtime_type, github_repo,
              deploy_url, last_active_at, created_at, updated_at
       FROM projects
       WHERE company_id = $1 AND is_archived = FALSE
       ORDER BY
         CASE status
           WHEN 'active'   THEN 1
           WHEN 'building' THEN 2
           WHEN 'sleeping' THEN 3
           WHEN 'draft'    THEN 4
           WHEN 'failed'   THEN 5
         END,
         updated_at DESC`,
      [companyId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting company apps:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function updateAppStatusPostgres(
  projectId: string,
  status: AppStatus,
  extra?: { deploy_url?: string; github_repo?: string; build_logs?: string }
): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const setClauses = ['status = $1', 'updated_at = CURRENT_TIMESTAMP'];
    const values: unknown[] = [status];
    let idx = 2;

    if (status === 'active') {
      setClauses.push(`last_active_at = CURRENT_TIMESTAMP`);
    }

    if (extra?.deploy_url) {
      setClauses.push(`deploy_url = $${idx++}`);
      values.push(extra.deploy_url);
    }

    if (extra?.github_repo) {
      setClauses.push(`github_repo = $${idx++}`);
      values.push(extra.github_repo);
    }

    if (extra?.build_logs !== undefined) {
      setClauses.push(`build_logs = $${idx++}`);
      values.push(extra.build_logs);
    }

    values.push(projectId);
    await client.query(`UPDATE projects SET ${setClauses.join(', ')} WHERE id = $${idx}`, values);

    return true;
  } catch (error) {
    console.error('Error updating app status:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function getInactiveAppsPostgres(thresholdMinutes = 15): Promise<{ id: string; company_id: string }[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT id, company_id FROM projects
       WHERE status = 'active'
         AND runtime_type = 'container'
         AND last_active_at < NOW() - ($1 || ' minutes')::INTERVAL`,
      [thresholdMinutes]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting inactive apps:', error);
    return [];
  } finally {
    client.release();
  }
}

/*
 * ============================================================
 * Phase 2: Audit Log Functions
 * ============================================================
 */

export type AuditAction =
  | 'CREATE_COMPANY'
  | 'UPDATE_COMPANY'
  | 'MEMBER_ADD'
  | 'MEMBER_REMOVE'
  | 'MEMBER_ROLE_CHANGE'
  | 'CREATE_APP'
  | 'DELETE_APP'
  | 'BUILD'
  | 'DEPLOY'
  | 'PUSH_CODE'
  | 'WAKE'
  | 'SLEEP';

export async function addAuditLogPostgres(params: {
  companyId: string;
  actorId: string;
  projectId?: string | null;
  action: AuditAction;
  payload?: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query(
      `INSERT INTO audit_logs (id, company_id, actor_id, project_id, action, payload, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        crypto.randomUUID(),
        params.companyId,
        params.actorId,
        params.projectId ?? null,
        params.action,
        params.payload ? JSON.stringify(params.payload) : null,
        params.ipAddress ?? null,
      ]
    );
    return true;
  } catch (error) {
    console.error('Error adding audit log:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function getAuditLogsPostgres(
  companyId: string,
  limit = 50
): Promise<
  {
    id: string;
    actor_email: string;
    project_name: string | null;
    action: string;
    payload: unknown;
    created_at: string;
  }[]
> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT al.id, u.email as actor_email, p.name as project_name,
              al.action, al.payload, al.created_at
       FROM audit_logs al
       LEFT JOIN users u ON al.actor_id = u.id
       LEFT JOIN projects p ON al.project_id = p.id
       WHERE al.company_id = $1
       ORDER BY al.created_at DESC
       LIMIT $2`,
      [companyId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting audit logs:', error);
    return [];
  } finally {
    client.release();
  }
}
