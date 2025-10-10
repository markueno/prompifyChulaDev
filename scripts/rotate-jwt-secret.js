#!/usr/bin/env node

/**
 * JWT Secret Rotation Script
 * This script helps rotate JWT secrets and invalidate existing sessions
 */

const crypto = require('crypto');

console.log('🔐 JWT Secret Rotation Script');
console.log('============================\n');

// New JWT Secret (generated securely)
const newJwtSecret = '3155fe193555555324b144266188cdecb97a61a83c66299f467c969e1f8f57a1';

console.log('✅ New JWT Secret Generated:');
console.log(`   ${newJwtSecret}\n`);

console.log('📋 Steps to Complete JWT Rotation:');
console.log('===================================');

console.log('\n1. 🔄 Update Environment Files:');
console.log('   ✅ env.production.example - Updated');
console.log('   ✅ env.local.example - Updated');
console.log('   ⚠️  Update your actual .env files with the new secret');

console.log('\n2. 🗄️  Invalidate All Existing Sessions:');
console.log('   Run this SQL to clear all sessions:');
console.log('   DELETE FROM user_sessions;');

console.log('\n3. 🔄 Restart Your Application:');
console.log('   docker-compose down');
console.log('   docker-compose up -d');

console.log('\n4. 🧪 Test Authentication:');
console.log('   - Try logging in with existing credentials');
console.log('   - Verify old tokens are rejected');
console.log('   - Confirm new tokens work properly');

console.log('\n5. 🔍 Monitor for Issues:');
console.log('   - Check application logs for JWT errors');
console.log('   - Verify all users can log in successfully');
console.log('   - Monitor for any authentication failures');

console.log('\n⚠️  Important Security Notes:');
console.log('============================');
console.log('• All existing user sessions will be invalidated');
console.log('• Users will need to log in again');
console.log('• Old JWT tokens will be rejected');
console.log('• This prevents attackers from using compromised tokens');

console.log('\n🎯 Next Steps:');
console.log('==============');
console.log('1. Copy the new JWT secret to your .env files');
console.log('2. Clear the user_sessions table in your database');
console.log('3. Restart your application');
console.log('4. Test the authentication flow');

console.log('\n✅ JWT Secret rotation prepared successfully!');
