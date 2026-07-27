-- Database Schema for Prompify Authentication System
-- This is a reference schema for implementing the authentication system

-- Users table
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(64),
    verification_expires TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    login_attempts INT DEFAULT 0,
    locked_until TIMESTAMP,
    reset_token VARCHAR(64),
    reset_expires TIMESTAMP
);

-- User sessions table (for session management)
CREATE TABLE user_sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Rate limiting table
CREATE TABLE rate_limits (
    id VARCHAR(36) PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    endpoint VARCHAR(100) NOT NULL,
    attempts INT DEFAULT 1,
    first_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_ip_endpoint (ip_address, endpoint)
);

-- Email verification logs
CREATE TABLE email_logs (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    email_type ENUM('verification', 'reset', 'welcome') NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delivered BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_verification_token ON users(verification_token);
CREATE INDEX idx_users_reset_token ON users(reset_token);
CREATE INDEX idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX idx_rate_limits_ip_endpoint ON rate_limits(ip_address, endpoint);
CREATE INDEX idx_email_logs_user_id ON email_logs(user_id);

-- Triggers for updated_at
DELIMITER //
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    SET NEW.updated_at = CURRENT_TIMESTAMP;
//

CREATE TRIGGER update_sessions_last_used
    BEFORE UPDATE ON user_sessions
    FOR EACH ROW
    SET NEW.last_used = CURRENT_TIMESTAMP;
//
DELIMITER ;

-- Cleanup procedures
DELIMITER //
CREATE PROCEDURE cleanup_expired_sessions()
BEGIN
    DELETE FROM user_sessions WHERE expires_at < NOW();
END//

CREATE PROCEDURE cleanup_expired_rate_limits()
BEGIN
    DELETE FROM rate_limits WHERE last_attempt < DATE_SUB(NOW(), INTERVAL 1 HOUR);
END//

CREATE PROCEDURE cleanup_expired_tokens()
BEGIN
    UPDATE users 
    SET verification_token = NULL, verification_expires = NULL 
    WHERE verification_expires < NOW();
    
    UPDATE users 
    SET reset_token = NULL, reset_expires = NULL 
    WHERE reset_expires < NOW();
END//
DELIMITER ;

-- Example queries for the authentication system:

-- 1. Create a new user
-- INSERT INTO users (id, email, password_hash, verification_token, verification_expires)
-- VALUES (UUID(), 'user@example.com', 'hashed_password', 'verification_token', DATE_ADD(NOW(), INTERVAL 24 HOUR));

-- 2. Verify a user's email
-- UPDATE users 
-- SET verified = TRUE, verification_token = NULL, verification_expires = NULL 
-- WHERE verification_token = 'token_here' AND verification_expires > NOW();

-- 3. Get user by email
-- SELECT * FROM users WHERE email = 'user@example.com';

-- 4. Update login attempts
-- UPDATE users 
-- SET login_attempts = login_attempts + 1, last_login = NOW() 
-- WHERE email = 'user@example.com';

-- 5. Reset login attempts on successful login
-- UPDATE users 
-- SET login_attempts = 0, last_login = NOW() 
-- WHERE id = 'user_id_here';

-- 6. Check rate limiting
-- SELECT COUNT(*) FROM rate_limits 
-- WHERE ip_address = 'ip_here' AND endpoint = 'login' 
-- AND last_attempt > DATE_SUB(NOW(), INTERVAL 15 MINUTE);

-- 7. Create a session
-- INSERT INTO user_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
-- VALUES (UUID(), 'user_id', 'token_hash', DATE_ADD(NOW(), INTERVAL 24 HOUR), 'ip', 'user_agent');

-- 8. Validate session
-- SELECT us.*, u.email, u.verified 
-- FROM user_sessions us 
-- JOIN users u ON us.user_id = u.id 
-- WHERE us.token_hash = 'token_hash' AND us.expires_at > NOW();

-- 9. Log email sending
-- INSERT INTO email_logs (id, user_id, email_type, delivered)
-- VALUES (UUID(), 'user_id', 'verification', TRUE);

-- KooGallery SaaS 2.0 Integration Tables

-- KooGallery instances table
CREATE TABLE IF NOT EXISTS koogallery_instances (
    id VARCHAR(36) PRIMARY KEY,
    instance_id VARCHAR(64) UNIQUE NOT NULL,
    order_id VARCHAR(64) NOT NULL,
    order_line_id VARCHAR(64) NOT NULL,
    business_id VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'creating',
    test_flag BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    metadata TEXT
);

-- Create indexes for koogallery_instances
CREATE INDEX IF NOT EXISTS idx_koogallery_instances_order_id ON koogallery_instances(order_id);
CREATE INDEX IF NOT EXISTS idx_koogallery_instances_instance_id ON koogallery_instances(instance_id);
CREATE INDEX IF NOT EXISTS idx_koogallery_instances_business_id ON koogallery_instances(business_id);
CREATE INDEX IF NOT EXISTS idx_koogallery_instances_status ON koogallery_instances(status);

-- KooGallery API logs table
CREATE TABLE IF NOT EXISTS koogallery_logs (
    id VARCHAR(36) PRIMARY KEY,
    endpoint VARCHAR(100) NOT NULL,
    method VARCHAR(10) NOT NULL,
    order_id VARCHAR(64),
    instance_id VARCHAR(64),
    status VARCHAR(10) NOT NULL,
    message TEXT,
    request_data TEXT,
    response_data TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    user_agent TEXT
);

-- Create indexes for koogallery_logs
CREATE INDEX IF NOT EXISTS idx_koogallery_logs_endpoint ON koogallery_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_koogallery_logs_order_id ON koogallery_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_koogallery_logs_instance_id ON koogallery_logs(instance_id);
CREATE INDEX IF NOT EXISTS idx_koogallery_logs_timestamp ON koogallery_logs(timestamp); 