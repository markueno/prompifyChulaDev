#!/usr/bin/env node

import pg from 'pg';
import Database from 'better-sqlite3';

const { Pool } = pg;

console.log('🔍 Testing Database Connections...\n');

// Test SQLite
console.log('📦 Testing SQLite...');
try {
  const sqliteDb = new Database('./data/prompify.db');
  console.log('✅ SQLite connection successful');
  
  // Test a simple query
  const result = sqliteDb.prepare('SELECT COUNT(*) as count FROM sqlite_master WHERE type=\'table\'').get();
  console.log(`📊 Found ${result.count} tables in SQLite`);
  
  sqliteDb.close();
} catch (error) {
  console.error('❌ SQLite connection failed:', error.message);
}

console.log('\n🐘 Testing PostgreSQL...');

// Test PostgreSQL
async function testPostgreSQL() {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.log('⚠️  DATABASE_URL not set, skipping PostgreSQL test');
      return;
    }

    const pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    const client = await pool.connect();
    console.log('✅ PostgreSQL connection successful');
    
    // Test a simple query
    const result = await client.query('SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = \'public\'');
    console.log(`📊 Found ${result.rows[0].count} tables in PostgreSQL`);
    
    client.release();
    await pool.end();
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', error.message);
  }
}

testPostgreSQL().then(() => {
  console.log('\n🎯 Database test completed!');
  console.log('\n📝 Next steps:');
  console.log('1. Set DATABASE_TYPE=postgresql to use PostgreSQL');
  console.log('2. Set DATABASE_URL for PostgreSQL connection');
  console.log('3. Run the application with docker-compose.prod.yaml');
}); 