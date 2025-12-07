#!/usr/bin/env node

import pg from 'pg';

const { Pool } = pg;

console.log('🔍 Testing PostgreSQL Database Connection...\n');

// Test PostgreSQL
async function testPostgreSQL() {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      console.log('⚠️  DATABASE_URL not set, cannot test PostgreSQL');
      console.log('   Please set DATABASE_URL environment variable');
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
    
    // List all tables
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    if (tablesResult.rows.length > 0) {
      console.log('\n📋 Tables in database:');
      tablesResult.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
    }
    
    client.release();
    await pool.end();
    
    console.log('\n🎯 Database test completed successfully!');
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    console.error('\n💡 Troubleshooting tips:');
    console.error('   1. Check that DATABASE_URL is correctly set');
    console.error('   2. Verify PostgreSQL is running');
    console.error('   3. Check network connectivity to database server');
    console.error('   4. Verify credentials are correct');
  }
}

testPostgreSQL().then(() => {
  console.log('\n📝 Next steps:');
  console.log('   - Ensure DATABASE_URL is set in your environment');
  console.log('   - Run the application with docker-compose.prod.yaml for production');
  console.log('   - Or set DATABASE_URL for local development');
});
