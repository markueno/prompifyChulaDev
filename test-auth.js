// Test script for authentication system
// Run with: node test-auth.js

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

console.log('🧪 Testing Authentication System...\n');

// Test 1: Password hashing
console.log('1. Testing password hashing...');
const password = 'SecurePass123!';
const hashedPassword = bcrypt.hashSync(password, 12);
console.log('✅ Password hashed successfully');
console.log('   Original:', password);
console.log('   Hashed:', hashedPassword.substring(0, 20) + '...');
console.log('   Verification:', bcrypt.compareSync(password, hashedPassword) ? '✅ PASS' : '❌ FAIL');

// Test 2: JWT token generation
console.log('\n2. Testing JWT token generation...');
const jwt = require('jsonwebtoken');
const secret = 'test-secret-key';
const payload = { userId: '123', email: 'test@example.com', verified: true };
const token = jwt.sign(payload, secret, { expiresIn: '24h' });
console.log('✅ JWT token generated successfully');
console.log('   Token:', token.substring(0, 50) + '...');
const decoded = jwt.verify(token, secret);
console.log('   Decoded:', decoded);

// Test 3: Email verification token
console.log('\n3. Testing email verification token...');
const verificationToken = crypto.randomBytes(32).toString('hex');
console.log('✅ Verification token generated successfully');
console.log('   Token:', verificationToken.substring(0, 20) + '...');

// Test 4: Database connection (if SQLite is available)
console.log('\n4. Testing database connection...');
try {
  const Database = require('better-sqlite3');
  const db = new Database('./data/prompify.db');
  console.log('✅ Database connection successful');
  
  // Test table creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    )
  `);
  console.log('✅ Table creation successful');
  
  // Test insert
  const testUser = {
    id: crypto.randomUUID(),
    email: 'test@example.com',
    password_hash: hashedPassword
  };
  
  const insertResult = db.prepare(`
    INSERT INTO test_users (id, email, password_hash)
    VALUES (?, ?, ?)
  `).run(testUser.id, testUser.email, testUser.password_hash);
  
  console.log('✅ User insertion successful');
  
  // Test select
  const user = db.prepare('SELECT * FROM test_users WHERE email = ?').get(testUser.email);
  console.log('✅ User retrieval successful');
  console.log('   Retrieved user:', user.email);
  
  // Cleanup
  db.prepare('DELETE FROM test_users WHERE id = ?').run(testUser.id);
  db.close();
  console.log('✅ Database cleanup successful');
  
} catch (error) {
  console.log('❌ Database test failed:', error.message);
  console.log('   Make sure to run: npm install better-sqlite3');
}

// Test 5: Email service
console.log('\n5. Testing email service...');
const { sendVerificationEmail } = require('./app/lib/email.js');
console.log('✅ Email service imported successfully');

console.log('\n🎉 All tests completed!');
console.log('\n📋 Next steps:');
console.log('   1. Run: npm install');
console.log('   2. Start the development server: npm run dev');
console.log('   3. Visit: http://localhost:5173/auth/register');
console.log('   4. Check the console for email logs'); 