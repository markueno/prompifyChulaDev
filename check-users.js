import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'prompify.db');

console.log('🔍 Starting database check...');
console.log('Database path:', dbPath);

try {
  console.log('📂 Opening database...');
  const db = new Database(dbPath);
  console.log('✅ Database opened successfully');
  
  // List all tables
  console.log('🔍 Querying tables...');
  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table'
  `).all();
  
  console.log('📋 Tables found:', tables.length);
  console.log('Table names:', tables.map(t => t.name).join(', '));
  console.log('');
  
  // Check users table
  if (tables.some(t => t.name === 'users')) {
    console.log('👥 Users table found, checking count...');
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    console.log(`Total users: ${userCount.count}`);
    
    if (userCount.count > 0) {
      console.log('📊 Getting user details...');
      const users = db.prepare('SELECT * FROM users LIMIT 5').all();
      console.log('Recent users:');
      users.forEach((user, i) => {
        console.log(`${i + 1}. ${user.email} (ID: ${user.id})`);
      });
    }
  } else {
    console.log('❌ Users table not found');
  }
  
  // Check sessions table
  if (tables.some(t => t.name === 'sessions')) {
    console.log('🔐 Sessions table found, checking count...');
    const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get();
    console.log(`Active sessions: ${sessionCount.count}`);
  }
  
  console.log('🔒 Closing database...');
  db.close();
  console.log('✅ Database check complete');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('Stack:', error.stack);
} 