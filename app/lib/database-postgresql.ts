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
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting user by email:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function createUserPostgres(user: any) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  
  try {
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
    return result.rowCount > 0;
  } catch (error) {
    console.error('Error creating user:', error);
    return false;
  } finally {
    client.release();
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
    const result = await client.query(`
      UPDATE users 
      SET is_verified = TRUE, verification_token = NULL, verification_expires = NULL 
      WHERE id = $1
    `, [userId]);
    return result.rowCount > 0;
  } catch (error) {
    console.error('Error verifying user:', error);
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

// Chat Management Functions
export async function saveChatPostgres(userId: string, chatData: any): Promise<string | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  
  try {
    const { id, urlId, description, messages, metadata } = chatData;
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
    const result = await client.query(query, [id, userId, urlId, description, JSON.stringify(messages), JSON.stringify(metadata)]);
    return result.rows[0]?.id || null;
  } catch (error) {
    console.error('Error saving chat to PostgreSQL:', error);
    return null;
  } finally {
    client.release();
  }
}

export async function getChatsByUserPostgres(userId: string): Promise<any[]> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  
  try {
    const query = `
      SELECT id, url_id, description, messages, metadata, created_at, updated_at, last_activity, is_archived
      FROM chats 
      WHERE user_id = $1 
      ORDER BY updated_at DESC
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

export async function getChatByIdPostgres(chatId: string, userId: string): Promise<any | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  
  try {
    const query = `
      SELECT id, url_id, description, messages, metadata, created_at, updated_at, last_activity, is_archived
      FROM chats 
      WHERE id = $1 AND user_id = $2
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