/**
 * StablePay Blockchain Scanner — Railway Worker
 *
 * Standalone process that polls EVM chains for USDC payments.
 * Runs independently from the web server. Same database.
 *
 * Deploy on Railway: node dist/scanner.js
 */

import dotenv from 'dotenv';
dotenv.config();

import { BlockchainService } from './services/blockchainService';

const scanner = new BlockchainService();

console.log('[scanner] StablePay Blockchain Scanner starting...');
console.log('[scanner] DATABASE_URL:', process.env.DATABASE_URL ? '✓ Set' : '✗ Missing');

scanner.startScanning(15000); // Poll every 15 seconds

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[scanner] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[scanner] Shutting down...');
  process.exit(0);
});
