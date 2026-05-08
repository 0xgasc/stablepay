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

import { initSentry } from './utils/sentry';
initSentry('scanner');

import { BlockchainService } from './services/blockchainService';
import { webhookService } from './services/webhookService';
import { startHealthAlerter } from './services/healthAlerter';
import { runMerchantAlerter } from './services/merchantAlerter';

const scanner = new BlockchainService();

console.log('[scanner] StablePay Blockchain Scanner starting...');
console.log('[scanner] DATABASE_URL:', process.env.DATABASE_URL ? '✓ Set' : '✗ Missing');

scanner.startScanning(15000); // Poll every 15 seconds

// Synthetic health monitor — emails ops when components break / recover. Lives here on the
// long-running Railway worker (the same reason the webhook-retry loop lives here, not on Vercel).
startHealthAlerter();

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

// Hourly merchant alerter — finds merchants with persistent webhook failures and
// emails them a diagnosis. Lives here on the long-running worker so we don't
// depend on Vercel cron limits. Idempotent (12h cooldown per merchant+errorClass).
const MERCHANT_ALERT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
async function driveMerchantAlerts() {
  try {
    const result = await runMerchantAlerter();
    if (result.sent > 0 || result.errors > 0) {
      console.log(`[merchant-alerter] groups=${result.groups} sent=${result.sent} cooldown=${result.cooldown} errors=${result.errors}`);
    }
  } catch (err: any) {
    console.error('[merchant-alerter] error:', err?.message || err);
  }
}
// Wait 5 min on cold start so the worker isn't slammed during boot
setTimeout(() => {
  driveMerchantAlerts();
  setInterval(driveMerchantAlerts, MERCHANT_ALERT_INTERVAL_MS);
}, 5 * 60 * 1000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[scanner] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[scanner] Shutting down...');
  process.exit(0);
});
