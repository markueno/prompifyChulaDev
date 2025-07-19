import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'prompify.db');

try {
  console.log('🔍 Checking database schema...');
  const db = new Database(dbPath);
  
  // Check users table schema
  console.log('\n📋 Users table schema:');
  const userSchema = db.prepare(`
    PRAGMA table_info(users)
  `).all();
  
  userSchema.forEach(col => {
    console.log(`   ${col.name} (${col.type}) - Default: ${col.dflt_value}`);
  });
  
  // Check actual user data
  console.log('\n👥 Sample user data:');
  const users = db.prepare('SELECT * FROM users LIMIT 1').all();
  if (users.length > 0) {
    const user = users[0];
    Object.keys(user).forEach(key => {
      console.log(`   ${key}: ${user[key]} (${typeof user[key]})`);
    });
  }
  
  db.close();
  
} catch (error) {
  console.error('❌ Error:', error.message);
} 