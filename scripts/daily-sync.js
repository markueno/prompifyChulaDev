#!/usr/bin/env node

/**
 * Daily Database Sync Script
 * Syncs data from main PostgreSQL database to backup database
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database configurations
const MAIN_DB_CONFIG = {
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
};

const BACKUP_DB_CONFIG = {
  connectionString: process.env.BACKUP_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
};

// Tables to sync
const TABLES_TO_SYNC = [
  'users',
  'user_sessions', 
  'rate_limits',
  'email_logs',
  'chats',
  'user_activity'
];

async function syncTable(mainPool, backupPool, tableName) {
  console.log(`🔄 Syncing table: ${tableName}`);
  
  try {
    // Get data from main database
    const mainClient = await mainPool.connect();
    const result = await mainClient.query(`SELECT * FROM ${tableName}`);
    const rows = result.rows;
    mainClient.release();
    
    if (rows.length === 0) {
      console.log(`  ✅ No data to sync for ${tableName}`);
      return;
    }
    
    // Clear existing data in backup database
    const backupClient = await backupPool.connect();
    await backupClient.query(`DELETE FROM ${tableName}`);
    
    // Insert data into backup database
    if (rows.length > 0) {
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const insertQuery = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
      
      for (const row of rows) {
        const values = columns.map(col => row[col]);
        await backupClient.query(insertQuery, values);
      }
    }
    
    backupClient.release();
    console.log(`  ✅ Synced ${rows.length} rows for ${tableName}`);
    
  } catch (error) {
    console.error(`  ❌ Error syncing ${tableName}:`, error.message);
    throw error;
  }
}

async function createBackupTables(backupPool) {
  console.log('🏗️  Creating backup tables...');
  
  const backupClient = await backupPool.connect();
  
  try {
    // Create tables in backup database
    const createTablesSQL = `
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        verified BOOLEAN DEFAULT FALSE,
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

      -- User sessions table
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
      );

      -- Rate limiting table
      CREATE TABLE IF NOT EXISTS rate_limits (
        id TEXT PRIMARY KEY,
        ip_address TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        attempts INTEGER DEFAULT 1,
        first_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_attempt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(ip_address, endpoint)
      );

      -- Email logs table
      CREATE TABLE IF NOT EXISTS email_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        email_type TEXT NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        delivered BOOLEAN DEFAULT FALSE,
        error_message TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      -- Chats table
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

      -- User activity table
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
    `;
    
    await backupClient.query(createTablesSQL);
    console.log('  ✅ Backup tables created successfully');
    
  } catch (error) {
    console.error('  ❌ Error creating backup tables:', error.message);
    throw error;
  } finally {
    backupClient.release();
  }
}

async function main() {
  console.log('🚀 Starting daily database sync...');
  console.log(`📅 Sync time: ${new Date().toISOString()}`);
  
  const mainPool = new Pool(MAIN_DB_CONFIG);
  const backupPool = new Pool(BACKUP_DB_CONFIG);
  
  try {
    // Test connections
    console.log('🔌 Testing database connections...');
    await mainPool.query('SELECT 1');
    await backupPool.query('SELECT 1');
    console.log('  ✅ Both database connections successful');
    
    // Create backup tables if they don't exist
    await createBackupTables(backupPool);
    
    // Sync each table
    for (const tableName of TABLES_TO_SYNC) {
      await syncTable(mainPool, backupPool, tableName);
    }
    
    console.log('🎉 Daily sync completed successfully!');
    
    // Log sync completion
    const logEntry = {
      timestamp: new Date().toISOString(),
      status: 'success',
      tables_synced: TABLES_TO_SYNC.length
    };
    
    const logFile = path.join(__dirname, '../logs/sync.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    
  } catch (error) {
    console.error('❌ Sync failed:', error);
    
    // Log sync failure
    const logEntry = {
      timestamp: new Date().toISOString(),
      status: 'error',
      error: error.message
    };
    
    const logFile = path.join(__dirname, '../logs/sync.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    
    process.exit(1);
  } finally {
    await mainPool.end();
    await backupPool.end();
  }
}

// Run the sync
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };

