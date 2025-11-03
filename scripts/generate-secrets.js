#!/usr/bin/env node

/**
 * Generate Secure Secrets for StablePay
 * Run with: node scripts/generate-secrets.js
 */

const crypto = require('crypto');

console.log('\n🔐 StablePay Secret Generator\n');
console.log('='.repeat(60));

// Generate JWT Secret (32 bytes = 256 bits)
const jwtSecret = crypto.randomBytes(32).toString('base64');
console.log('\nJWT_SECRET (copy to .env):');
console.log(jwtSecret);

// Generate Admin Password (16 bytes = 128 bits, hex)
const adminPassword = crypto.randomBytes(16).toString('hex');
console.log('\nADMIN_PASSWORD (copy to .env):');
console.log(adminPassword);

// Generate Ethereum Private Key (32 bytes)
const privateKey = crypto.randomBytes(32).toString('hex');
console.log('\nPRIVATE_KEY (copy to .env):');
console.log(privateKey);

// Generate derived Ethereum address (for reference)
console.log('\n⚠️  Note: The private key above needs to be imported to a wallet');
console.log('   to derive the actual Ethereum address.');

console.log('\n' + '='.repeat(60));
console.log('\n✅ Secrets generated successfully!');
console.log('\n📋 Next steps:');
console.log('   1. Copy the values above to your .env file');
console.log('   2. Never commit these values to git');
console.log('   3. Store securely (use password manager)');
console.log('   4. Update Vercel environment variables\n');
