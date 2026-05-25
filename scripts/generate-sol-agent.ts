/**
 * Generate a fresh Solana keypair to use as the SOL gas-sponsorship agent.
 * Prints the address + secret-key hex. Save the hex to SOL_AGENT_KEY env, fund the address with SOL.
 */
import { Keypair } from '@solana/web3.js';

const kp = Keypair.generate();
const secretHex = Buffer.from(kp.secretKey).toString('hex');

console.log('\n=== StablePay Solana Agent Wallet ===\n');
console.log(`Address:    ${kp.publicKey.toBase58()}`);
console.log(`Secret hex: ${secretHex}`);
console.log('\nNext steps:');
console.log('  1. Set SOL_AGENT_KEY in .env (Railway) to the secret hex above');
console.log('  2. Fund the address with ~0.1 SOL (covers ~50 orders at 0.002 SOL gas each)');
console.log('  3. Restart the scanner');
