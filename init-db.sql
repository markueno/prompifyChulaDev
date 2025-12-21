-- Initialize Prompify Database
-- This file is automatically executed when PostgreSQL container starts

-- Create prompify_user role if it doesn't exist
-- This handles cases where the volume was created with a different user
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'prompify_user') THEN
    CREATE ROLE prompify_user WITH LOGIN PASSWORD 'Mark@3156';
    ALTER ROLE prompify_user CREATEDB;
  END IF;
END
$$;

-- Grant necessary permissions to prompify_user
GRANT ALL PRIVILEGES ON DATABASE prompify TO prompify_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO prompify_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO prompify_user;

-- Create users table
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
);

-- Create user_sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create rate_limits table
CREATE TABLE IF NOT EXISTS rate_limits (
    id TEXT PRIMARY KEY,
    ip_address TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    request_count INTEGER DEFAULT 1,
    window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

-- Create email_logs table
CREATE TABLE IF NOT EXISTS email_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email_type TEXT NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delivered BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create chats table
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
);

-- Create user_activity table
CREATE TABLE IF NOT EXISTS user_activity (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_details JSONB DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create KooGallery instances table
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
);

-- Create KooGallery logs table
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
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token);
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_endpoint ON rate_limits(ip_address, endpoint);
CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_url_id ON chats(url_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_action_type ON user_activity(action_type);
CREATE INDEX IF NOT EXISTS idx_koogallery_order_id ON koogallery_instances(order_id);
CREATE INDEX IF NOT EXISTS idx_koogallery_instance_id ON koogallery_instances(instance_id);
CREATE INDEX IF NOT EXISTS idx_koogallery_logs_endpoint ON koogallery_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_koogallery_logs_order_id ON koogallery_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_koogallery_logs_instance_id ON koogallery_logs(instance_id);
CREATE INDEX IF NOT EXISTS idx_koogallery_logs_timestamp ON koogallery_logs(timestamp);
