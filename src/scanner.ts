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
import { webhookService } from './services/webhookService';

const scanner = new BlockchainService();

console.log('[scanner] StablePay Blockchain Scanner starting...');
console.log('[scanner] DATABASE_URL:', process.env.DATABASE_URL ? '✓ Set' : '✗ Missing');

scanner.startScanning(15000); // Poll every 15 seconds

// Webhook retry driver. The web tier (Vercel) can't reliably host a scheduler
// because serverless functions don't survive between requests — any node-cron
// registered there gets set up and immediately forgotten. This worker is
// long-running, so we drive retries from here.
const WEBHOOK_RETRY_INTERVAL_MS = 60_000;
async function driveWebhookRetries() {
  try {
    const processed = await webhookService.processRetries();
    if (processed > 0) {
      console.log(`[webhooks] retried ${processed} pending deliveries`);
    }
  } catch (err: any) {
    console.error('[webhooks] retry driver error:', err?.message || err);
  }
}
driveWebhookRetries();
setInterval(driveWebhookRetries, WEBHOOK_RETRY_INTERVAL_MS);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[scanner] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[scanner] Shutting down...');
  process.exit(0);
});
