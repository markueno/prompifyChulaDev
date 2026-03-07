import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
type PoolClient = pg.PoolClient;

// PostgreSQL connection pool
let pool: InstanceType<typeof Pool>;

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

    // Test the connection
    pool.on('error', (err: Error) => {
      console.error('Unexpected error on idle client', err);
    });
  }
  return pool;
}

export async function createPostgresTables() {
  const pool = getPostgresPool();
  const client = await pool.connect();
  
  try {
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_verified BOOLEAN DEFAULT FALSE,
        is_moderator BOOLEAN DEFAULT FALSE,
        verification_token TEXT,
        verification_expires TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        login_attempts INTEGER DEFAULT 0,
        locked_until TIMESTAMP,
        reset_token TEXT,
        reset_expires TIMESTAMP
      )
    `);

    // User sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT,
        user_agent TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Rate limiting table
    await client.query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        id TEXT PRIMARY KEY,
        ip_address TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        attempts INTEGER DEFAULT 1,
        first_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(ip_address, endpoint)
      )
    `);

    // Email logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email_type TEXT NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        delivered BOOLEAN DEFAULT FALSE,
        error_message TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Chats table
    await client.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        url_id TEXT UNIQUE,
        description TEXT,
        messages JSONB NOT NULL DEFAULT '[]',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_archived BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // User activity table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_activity (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        action_details JSONB DEFAULT '{}',
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // KooGallery instances table
    await client.query(`
      CREATE TABLE IF NOT EXISTS koogallery_instances (
        id TEXT PRIMARY KEY,
        instance_id TEXT UNIQUE NOT NULL,
        order_id TEXT NOT NULL,
        order_line_id TEXT NOT NULL,
        business_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'creating',
        test_flag BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        metadata TEXT
      )
    `);

    // KooGallery logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS koogallery_logs (
        id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        order_id TEXT,
        instance_id TEXT,
        status TEXT NOT NULL,
        message TEXT,
        request_data TEXT,
        response_data TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT,
        user_agent TEXT
      )
    `);

    // Chat members table (multi-user project sharing)
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_members (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, user_id),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Chat invitations table (invite by email)
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_invitations (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        email TEXT NOT NULL,
        invited_by_user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'pending',
        token TEXT UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, email),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Subscription tiers table (Trial, Builder, Innovator)
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscription_tiers (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        price_cents INTEGER NOT NULL DEFAULT 0,
        limits JSONB DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Subscriptions table - one per user, links to tier
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        tier_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        current_period_start TIMESTAMP,
        current_period_end TIMESTAMP,
        stripe_subscription_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (tier_id) REFERENCES subscription_tiers(id)
      )
    `);

    // Seed subscription tiers (Trial=free, Builder, Innovator)
    await client.query(`
      INSERT INTO subscription_tiers (id, name, display_name, price_cents, limits, sort_order)
      VALUES
        ('tier_trial', 'trial', 'Trial', 0, '{}', 1),
        ('tier_builder', 'builder', 'Builder', 0, '{}', 2),
        ('tier_innovator', 'innovator', 'Innovator', 0, '{}', 3)
      ON CONFLICT (id) DO NOTHING
    `);

    // Prompts table - per-prompt record (account + chat)
    await client.query(`
      CREATE TABLE IF NOT EXISTS prompts (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, message_id),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Token usage - one row per prompt (tokens used for that prompt's response)
    await client.query(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        model TEXT,
        provider TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, message_id),
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Token balances - allocations with effective periods (tier, top-up, promo, etc.)
    await client.query(`
      CREATE TABLE IF NOT EXISTS token_balances (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        source_reference_id TEXT,
        tokens_allocated INTEGER NOT NULL DEFAULT 0,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        effective_start TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        effective_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT chk_token_balances_source CHECK (source IN ('tier', 'top_up', 'promo', 'grant'))
      )
    `);

    // Create indexes
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON user_sessions(token_hash)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_endpoint ON rate_limits(ip_address, endpoint)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chats_url_id ON chats(url_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_user_activity_action_type ON user_activity(action_type)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_koogallery_order_id ON koogallery_instances(order_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_koogallery_instance_id ON koogallery_instances(instance_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_koogallery_logs_endpoint ON koogallery_logs(endpoint)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_koogallery_logs_order_id ON koogallery_logs(order_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_koogallery_logs_instance_id ON koogallery_logs(instance_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_koogallery_logs_timestamp ON koogallery_logs(timestamp)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chat_members_chat_id ON chat_members(chat_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chat_members_user_id ON chat_members(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chat_invitations_chat_id ON chat_invitations(chat_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chat_invitations_email ON chat_invitations(email)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_chat_invitations_token ON chat_invitations(token)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_subscriptions_tier_id ON subscriptions(tier_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_prompts_chat_id ON prompts(chat_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_prompts_created_at ON prompts(created_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_token_usage_chat_id ON token_usage(chat_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_token_usage_message_id ON token_usage(message_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_token_usage_user_id ON token_usage(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_token_usage_user_created ON token_usage(user_id, created_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_token_balances_user_id ON token_balances(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_token_balances_user_effective ON token_balances(user_id, effective_start, effective_end)');

    // Backfill: assign Trial tier to verified users without a subscription
    await client.query(`
      INSERT INTO subscriptions (id, user_id, tier_id, status)
      SELECT gen_random_uuid()::text, u.id, 'tier_trial', 'active'
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id
      WHERE s.id IS NULL AND u.is_verified = TRUE
    `);

    console.log('PostgreSQL tables created successfully');
  } catch (error) {
    console.error('Error creating PostgreSQL tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Database helper functions for PostgreSQL
export async function getUserByEmailPostgres(email: string) {
  const pool = getPostgresPool();
  let client;
  
  try {
    client = await pool.connect();
    const result = await client.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0] || null;
  } catch (error: any) {
    console.error('❌ Error getting user by email:', error);
    // Re-throw connection errors so they can be handled upstream
    if (error.message?.includes('timeout') || 
        error.message?.includes('Connection terminated') || 
        error.message?.includes('ECONNREFUSED') ||
        error.message?.includes('ENOTFOUND')) {
      throw error; // Let the caller handle connection errors
    }
    return null;
  } finally {
    if (client) {
    client.release();
    }
  }
}

/** Create Trial subscription for user. Uses provided client for same-transaction atomicity. Skips if already exists (e.g. double verify). */
async function createSubscriptionForUserWithClient(client: PoolClient, userId: string): Promise<void> {
  const id = crypto.randomUUID();
  await client.query(`
    INSERT INTO subscriptions (id, user_id, tier_id, status)
    VALUES ($1, $2, 'tier_trial', 'active')
    ON CONFLICT (user_id) DO NOTHING
  `, [id, userId]);
}

/** Get subscription by user ID. For future subscription/upgrade logic. */
export async function getSubscriptionByUserIdPostgres(userId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT s.*, st.name as tier_name, st.display_name as tier_display_name, st.price_cents
      FROM subscriptions s
      JOIN subscription_tiers st ON s.tier_id = st.id
      WHERE s.user_id = $1
    `, [userId]);
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
    const result = await client.query(`
      INSERT INTO users (id, email, password_hash, is_verified, verification_token, verification_expires, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      user.id,
      user.email,
      user.passwordHash,
      user.isVerified,
      user.verificationToken,
      user.verificationExpires,
      user.createdAt
    ]);
    return result.rowCount !== null && result.rowCount > 0;
  } catch (error: any) {
    console.error('❌ Error creating user:', error);
    // Re-throw connection errors so they can be handled upstream
    if (error.message?.includes('timeout') ||
        error.message?.includes('Connection terminated') ||
        error.message?.includes('ECONNREFUSED') ||
        error.message?.includes('ENOTFOUND')) {
      throw error;
    }
    // Re-throw duplicate key errors
    if (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
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
    const result = await client.query(
      'SELECT * FROM users WHERE verification_token = $1',
      [token]
    );
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
    const result = await client.query(`
      UPDATE users 
      SET is_verified = TRUE, verification_token = NULL, verification_expires = NULL 
      WHERE id = $1
    `, [userId]);
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
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error verifying user:', error);
    return false;
  } finally {
    client.release();
  }
}

const RESET_TOKEN_EXPIRY_HOURS = 1;

/** Create a password reset token for the user with the given email. Returns the token and user, or null. */
export async function createPasswordResetTokenPostgres(email: string): Promise<{ token: string; user: { id: string; email: string } } | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    const userResult = await client.query(
      'SELECT id, email FROM users WHERE email = $1',
      [email]
    );
    const user = userResult.rows[0];
    if (!user) return null;

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    await client.query(
      'UPDATE users SET reset_token = $1, reset_expires = $2 WHERE id = $3',
      [token, expires, user.id]
    );
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
    const result = await client.query(
      'SELECT * FROM users WHERE reset_token = $1',
      [token]
    );
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
    const result = await client.query(`
      UPDATE users
      SET password_hash = $1, reset_token = NULL, reset_expires = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE reset_token = $2 AND reset_expires > CURRENT_TIMESTAMP
    `, [passwordHash, token]);
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
    await client.query(`
      UPDATE users 
      SET login_attempts = $1, last_login = CURRENT_TIMESTAMP 
      WHERE email = $2
    `, [attempts, email]);
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
    await client.query(`
      UPDATE users 
      SET login_attempts = 0, last_login = CURRENT_TIMESTAMP 
      WHERE id = $1
    `, [userId]);
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
    await client.query(`
      INSERT INTO email_logs (id, user_id, email_type, delivered, error_message)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      crypto.randomUUID(),
      userId,
      emailType,
      delivered,
      errorMessage
    ]);
    return true;
  } catch (error) {
    console.error('Error logging email:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function createUserSessionPostgres(userId: string, tokenHash: string, expiresAt: string, ipAddress?: string, userAgent?: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  
  try {
    // First, invalidate any existing sessions for this user (single session enforcement)
    await invalidateUserSessionsPostgres(userId);
    
    // Create new session
    const result = await client.query(`
      INSERT INTO user_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      crypto.randomUUID(),
      userId,
      tokenHash,
      expiresAt,
      ipAddress || null,
      userAgent || null
    ]);
    return result.rowCount > 0;
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
    await client.query(
      'DELETE FROM user_sessions WHERE user_id = $1',
      [userId]
    );
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
    const result = await client.query(`
      SELECT us.*, u.email, u.is_verified 
      FROM user_sessions us
      JOIN users u ON us.user_id = u.id
      WHERE us.token_hash = $1 AND us.expires_at > NOW()
    `, [tokenHash]);
    
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
    await client.query(`
      UPDATE user_sessions 
      SET last_used = NOW()
      WHERE token_hash = $1
    `, [tokenHash]);
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
    await client.query(
      'DELETE FROM user_sessions WHERE token_hash = $1',
      [tokenHash]
    );
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
    const result = await client.query(`
      SELECT COUNT(*) as count 
      FROM user_sessions 
      WHERE user_id = $1 AND expires_at > NOW()
    `, [userId]);
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('Error getting active session count:', error);
    return 0;
  } finally {
    client.release();
  }
}

// Token usage and balance functions
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

export async function consumeTokenBalancePostgres(userId: string, tokensToConsume: number): Promise<boolean> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const now = new Date().toISOString();
    const balances = await client.query(
      `SELECT id, tokens_allocated, tokens_used
       FROM token_balances
       WHERE user_id = $1
         AND effective_start <= $2
         AND (effective_end IS NULL OR effective_end >= $2)
         AND (tokens_allocated - tokens_used) > 0
       ORDER BY effective_end ASC NULLS LAST`,
      [userId, now]
    );

    let remaining = tokensToConsume;
    for (const row of balances.rows) {
      if (remaining <= 0) break;
      const available = row.tokens_allocated - row.tokens_used;
      const deduct = Math.min(remaining, available);
      await client.query(
        `UPDATE token_balances SET tokens_used = tokens_used + $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [row.id, deduct]
      );
      remaining -= deduct;
    }

    await client.query('COMMIT');
    return remaining <= 0;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error consuming token balance:', error);
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

// Chat Management Functions
export async function saveChatPostgres(userId: string, chatData: any): Promise<string | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  
  try {
    const { id, urlId, url_id, description, messages, metadata } = chatData;
    const resolvedUrlId = urlId ?? url_id;
    const query = `
      INSERT INTO chats (id, user_id, url_id, description, messages, metadata, updated_at, last_activity)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        description = EXCLUDED.description,
        messages = EXCLUDED.messages,
        metadata = EXCLUDED.metadata,
        updated_at = CURRENT_TIMESTAMP,
        last_activity = CURRENT_TIMESTAMP
      RETURNING id
    `;
    const result = await client.query(query, [id, userId, resolvedUrlId, description, JSON.stringify(messages), JSON.stringify(metadata)]);
    const savedId = result.rows[0]?.id || null;

    // Project creator is always the owner: add them to chat_members with role 'owner'
    if (savedId) {
      await client.query(`
        INSERT INTO chat_members (id, chat_id, user_id, role)
        VALUES ($1, $2, $3, 'owner')
        ON CONFLICT (chat_id, user_id) DO NOTHING
      `, [crypto.randomUUID(), id, userId]);
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
    if (msg?.role !== 'user') continue;
    const messageId = msg.id;
    if (!messageId || typeof messageId !== 'string') continue;
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
       WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)`,
      [chatId, requestingUserId]
    );
    if (accessCheck.rows.length === 0 && !isModerator) return [];

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
        SELECT c.id, c.url_id, c.description, c.messages, c.metadata, c.created_at, c.updated_at, c.last_activity, c.is_archived
        FROM chats c
        ORDER BY c.updated_at DESC
      `);
      return result.rows.map(row => ({
        ...row,
        messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      }));
    }
    // Include chats owned by user OR where user is a member (shared projects)
    const query = `
      SELECT DISTINCT c.id, c.url_id, c.description, c.messages, c.metadata, c.created_at, c.updated_at, c.last_activity, c.is_archived
      FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $1
      WHERE c.user_id = $1 OR cm.user_id = $1
      ORDER BY c.updated_at DESC
    `;
    const result = await client.query(query, [userId]);
    return result.rows.map(row => ({
      ...row,
      messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
    }));
  } catch (error) {
    console.error('Error fetching chats from PostgreSQL:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function getChatByIdPostgres(chatId: string, userId: string, isModerator?: boolean): Promise<any | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  
  try {
    if (isModerator) {
      const result = await client.query(`
        SELECT c.id, c.url_id, c.description, c.messages, c.metadata, c.created_at, c.updated_at, c.last_activity, c.is_archived, c.user_id
        FROM chats c
        WHERE c.id = $1 OR c.url_id = $1
      `, [chatId]);
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        ...row,
        messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
      };
    }
    // Allow access if user is owner OR is a chat member (shared project)
    const query = `
      SELECT c.id, c.url_id, c.description, c.messages, c.metadata, c.created_at, c.updated_at, c.last_activity, c.is_archived, c.user_id
      FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
      WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
    `;
    const result = await client.query(query, [chatId, userId]);
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      ...row,
      messages: typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata
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
    return result.rowCount > 0;
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
      userAgent
    ]);
    return result.rowCount > 0;
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
      action_details: typeof row.action_details === 'string' ? JSON.parse(row.action_details) : row.action_details
    }));
  } catch (error) {
    console.error('Error fetching user activity from PostgreSQL:', error);
    return [];
  } finally {
    client.release();
  }
}

// Chat members and invitations (multi-user project sharing)
export async function getChatMembersPostgres(chatId: string, requestingUserId: string, isModerator?: boolean): Promise<{ members: { id: string; email: string; role: string }[]; currentUserRole: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    let currentUserRole: string;
    if (isModerator) {
      currentUserRole = 'moderator';
    } else {
      const accessCheck = await client.query(`
        SELECT c.user_id as owner_id, cm.role as member_role FROM chats c
        LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
        WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
      `, [chatId, requestingUserId]);
      if (accessCheck.rows.length === 0) return { members: [], currentUserRole: '' };
      currentUserRole = accessCheck.rows[0].owner_id === requestingUserId ? 'owner' : (accessCheck.rows[0].member_role || 'member');
    }

    // Get owner from chats
    const chatRow = await client.query(`SELECT user_id FROM chats WHERE id = $1 OR url_id = $1`, [chatId]);
    const ownerId = chatRow.rows[0]?.user_id;
    if (!ownerId) return { members: [], currentUserRole: '' };

    const ownerUser = await client.query(`SELECT id, email FROM users WHERE id = $1`, [ownerId]);
    const members: { id: string; email: string; role: string }[] = [];
    if (ownerUser.rows[0]) {
      members.push({ id: ownerUser.rows[0].id, email: ownerUser.rows[0].email, role: 'owner' });
    }

    const memberRows = await client.query(`
      SELECT u.id, u.email, cm.role
      FROM chat_members cm
      JOIN users u ON cm.user_id = u.id
      JOIN chats c ON cm.chat_id = c.id
      WHERE (c.id = $1 OR c.url_id = $1) AND cm.user_id != $2
    `, [chatId, ownerId]);
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

export async function inviteToChatPostgres(chatId: string, invitingUserId: string, email: string, role: string = 'member'): Promise<{ success: boolean; error?: string; token?: string; alreadyMember?: boolean }> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return { success: false, error: 'Email is required' };

    // Check if chat exists first (so we can give a clear error when project hasn't been saved yet)
    const chatRow = await client.query(`SELECT id FROM chats WHERE id = $1 OR url_id = $1`, [chatId]);
    const resolvedChatId = chatRow.rows[0]?.id;
    if (!resolvedChatId) {
      return { success: false, error: 'Chat not found. Save your project first (send at least one message) before inviting others.' };
    }

    // Check inviter has access (owner or admin)
    const accessCheck = await client.query(`
      SELECT cm.role, c.user_id FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
      WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
    `, [chatId, invitingUserId]);
    if (accessCheck.rows.length === 0) return { success: false, error: 'Access denied to this project.' };
    const inviterRole = accessCheck.rows[0].user_id === invitingUserId ? 'owner' : accessCheck.rows[0].role;
    if (inviterRole !== 'owner' && inviterRole !== 'admin') return { success: false, error: 'Only owners and admins can invite' };

    const invitee = await client.query(`SELECT id FROM users WHERE email = $1`, [normalizedEmail]);
    if (invitee.rows[0]) {
      const existingMember = await client.query(`SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2`, [resolvedChatId, invitee.rows[0].id]);
      if (existingMember.rows.length > 0) {
        return { success: true, alreadyMember: true };
      }
    }

    const existingInvite = await client.query(`SELECT token FROM chat_invitations WHERE chat_id = $1 AND LOWER(email) = $2 AND status = 'pending' AND expires_at > NOW()`, [resolvedChatId, normalizedEmail]);
    if (existingInvite.rows.length > 0) return { success: false, error: 'Invitation already sent to this email' };

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await client.query(`
      INSERT INTO chat_invitations (id, chat_id, email, invited_by_user_id, role, status, token, expires_at)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
      ON CONFLICT (chat_id, email) DO UPDATE SET token = $6, expires_at = $7, status = 'pending', invited_by_user_id = $4
    `, [crypto.randomUUID(), resolvedChatId, normalizedEmail, invitingUserId, role, token, expiresAt]);

    return { success: true, token };
  } catch (error) {
    console.error('Error inviting to chat:', error);
    return { success: false, error: 'Failed to send invitation' };
  } finally {
    client.release();
  }
}

export async function getPendingInvitationsForUserPostgres(userEmail: string): Promise<{ id: string; chat_id: string; token: string; role: string; created_at: string; project_name: string; inviter_email: string }[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    const normalizedEmail = userEmail.trim().toLowerCase();
    const result = await client.query(`
      SELECT ci.id, ci.chat_id, ci.token, ci.role, ci.created_at,
             COALESCE(c.description, 'Untitled project') as project_name,
             u.email as inviter_email
      FROM chat_invitations ci
      JOIN chats c ON ci.chat_id = c.id
      JOIN users u ON ci.invited_by_user_id = u.id
      WHERE LOWER(ci.email) = $1 AND ci.status = 'pending' AND ci.expires_at > NOW()
      ORDER BY ci.created_at DESC
    `, [normalizedEmail]);
    return result.rows;
  } catch (error) {
    console.error('Error getting pending invitations for user:', error);
    return [];
  } finally {
    client.release();
  }
}

export async function getChatInvitationsPostgres(chatId: string, requestingUserId: string): Promise<{ id: string; email: string; role: string; status: string; created_at: string }[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    const accessCheck = await client.query(`
      SELECT 1 FROM chats c
      LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
      WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
    `, [chatId, requestingUserId]);
    if (accessCheck.rows.length === 0) return [];

    const chatRow = await client.query(`SELECT id FROM chats WHERE id = $1 OR url_id = $1`, [chatId]);
    const resolvedChatId = chatRow.rows[0]?.id;
    if (!resolvedChatId) return [];

    const result = await client.query(`
      SELECT id, email, role, status, created_at
      FROM chat_invitations
      WHERE chat_id = $1 AND status = 'pending' AND expires_at > NOW()
      ORDER BY created_at DESC
    `, [resolvedChatId]);
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
    if (!resolvedChatId) return false;

    await client.query(`
      INSERT INTO chat_members (id, chat_id, user_id, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (chat_id, user_id) DO UPDATE SET role = $4
    `, [crypto.randomUUID(), resolvedChatId, userId, role]);
    return true;
  } catch (error) {
    console.error('Error adding chat member:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function updateChatMemberRolePostgres(chatId: string, requestingUserId: string, targetUserId: string, newRole: string, isModerator?: boolean): Promise<{ success: boolean; error?: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    if (!['admin', 'member'].includes(newRole)) return { success: false, error: 'Invalid role' };

    const chatRow = await client.query(`SELECT id, user_id as owner_id FROM chats WHERE id = $1 OR url_id = $1`, [chatId]);
    const ownerId = chatRow.rows[0]?.owner_id;
    if (!ownerId) return { success: false, error: 'Chat not found' };
    if (targetUserId === ownerId) return { success: false, error: 'Cannot change owner role' };

    let requesterRole: string;
    if (isModerator) {
      requesterRole = 'owner';
    } else {
      const accessCheck = await client.query(`
        SELECT c.user_id, cm.role FROM chats c
        LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
        WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
      `, [chatId, requestingUserId]);
      if (accessCheck.rows.length === 0) return { success: false, error: 'Access denied' };
      requesterRole = accessCheck.rows[0].user_id === requestingUserId ? 'owner' : (accessCheck.rows[0].role || 'member');
    }

    if (requesterRole === 'member') return { success: false, error: 'Only owners and admins can edit roles' };
    if (requesterRole === 'admin') {
      const targetMember = await client.query(`SELECT role FROM chat_members cm JOIN chats c ON cm.chat_id = c.id WHERE (c.id = $1 OR c.url_id = $1) AND cm.user_id = $2`, [chatId, targetUserId]);
      if (targetMember.rows[0]?.role === 'admin') return { success: false, error: 'Only the owner can change an admin\'s role' };
    }

    const resolvedChatId = chatRow.rows[0]?.id;
    if (!resolvedChatId) return { success: false, error: 'Chat not found' };

    await client.query(`UPDATE chat_members SET role = $3 WHERE chat_id = $1 AND user_id = $2`, [resolvedChatId, targetUserId, newRole]);
    return { success: true };
  } catch (error) {
    console.error('Error updating member role:', error);
    return { success: false, error: 'Failed to update role' };
  } finally {
    client.release();
  }
}

export async function removeChatMemberPostgres(chatId: string, requestingUserId: string, targetUserId: string, isModerator?: boolean): Promise<{ success: boolean; error?: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    const chatRow = await client.query(`SELECT id, user_id as owner_id FROM chats WHERE id = $1 OR url_id = $1`, [chatId]);
    const ownerId = chatRow.rows[0]?.owner_id;
    const resolvedChatId = chatRow.rows[0]?.id;
    if (!ownerId || !resolvedChatId) return { success: false, error: 'Chat not found' };
    if (targetUserId === ownerId) return { success: false, error: 'Cannot remove the project owner' };

    let requesterRole: string;
    if (isModerator) {
      requesterRole = 'owner';
    } else {
      const accessCheck = await client.query(`
        SELECT c.user_id, cm.role FROM chats c
        LEFT JOIN chat_members cm ON c.id = cm.chat_id AND cm.user_id = $2
        WHERE (c.id = $1 OR c.url_id = $1) AND (c.user_id = $2 OR cm.user_id = $2)
      `, [chatId, requestingUserId]);
      if (accessCheck.rows.length === 0) return { success: false, error: 'Access denied' };
      requesterRole = accessCheck.rows[0].user_id === requestingUserId ? 'owner' : (accessCheck.rows[0].role || 'member');
    }

    if (requesterRole === 'member') return { success: false, error: 'Only owners and admins can remove members' };
    if (requesterRole === 'admin') {
      const targetMember = await client.query(`SELECT role FROM chat_members cm JOIN chats c ON cm.chat_id = c.id WHERE (c.id = $1 OR c.url_id = $1) AND cm.user_id = $2`, [chatId, targetUserId]);
      if (targetMember.rows[0]?.role === 'admin') return { success: false, error: 'Only the owner can remove an admin' };
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

export async function acceptInvitationByTokenPostgres(token: string, userId: string, userEmail: string): Promise<{ success: boolean; chatUrl?: string; error?: string }> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    const normalizedEmail = userEmail.trim().toLowerCase();
    const invResult = await client.query(`
      SELECT ci.id, ci.chat_id, ci.email, ci.role, c.url_id
      FROM chat_invitations ci
      JOIN chats c ON ci.chat_id = c.id
      WHERE ci.token = $1 AND ci.status = 'pending' AND ci.expires_at > NOW()
    `, [token]);
    if (invResult.rows.length === 0) return { success: false, error: 'Invitation not found or expired' };

    const inv = invResult.rows[0];
    if (inv.email.toLowerCase() !== normalizedEmail) return { success: false, error: 'This invitation was sent to a different email address' };

    await client.query(`UPDATE chat_invitations SET status = 'accepted' WHERE id = $1`, [inv.id]);
    await addChatMemberPostgres(inv.chat_id, userId, inv.role);

    return { success: true, chatUrl: `/chat/${inv.url_id || inv.chat_id}` };
  } catch (error) {
    console.error('Error accepting invitation:', error);
    return { success: false, error: 'Failed to accept invitation' };
  } finally {
    client.release();
  }
} 