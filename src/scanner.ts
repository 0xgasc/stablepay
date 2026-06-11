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

// Native stranded-fund auto-recovery. Reconciles native orders whose funds landed in a
// receive wallet but never settled: retries the swap (pays the merchant), else refunds a
// known customer wallet, else flags for manual review. Lives here on the long-running
// worker. Idempotent + has a staleness guard so it never races the 15s payment scanner.
const RECOVERY_INTERVAL_MS = 10 * 60 * 1000; // every 10 min
async function driveStrandedRecovery() {
  try {
    const { recoverStrandedNative } = await import('./services/recoveryService');
    const r = await recoverStrandedNative();
    if (r.swapped > 0 || r.refunded > 0 || r.manualReview > 0 || r.errors > 0) {
      console.log(`[recovery] scanned=${r.scanned} funds=${r.withFunds} swapped=${r.swapped} refunded=${r.refunded} manual=${r.manualReview} errors=${r.errors}`);
    }
  } catch (err: any) {
    console.error('[recovery] driver error:', err?.message || err);
  }
}
// Wait 90s on cold start so the worker isn't slammed during boot; then every 10 min.
setTimeout(() => {
  driveStrandedRecovery();
  setInterval(driveStrandedRecovery, RECOVERY_INTERVAL_MS);
}, 90 * 1000);

// Fee overdue check — was a node-cron in the web tier, where it only fired on warm serverless
// instances. The logic lives behind POST /api/fees/check-overdue; call the production API so the
// route stays the single implementation. Every 6 hours.
const FEE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PLATFORM_BASE_URL = process.env.PLATFORM_BASE_URL?.trim() || 'https://wetakestables.shop';
async function driveFeeCheck() {
  try {
    if (!process.env.ADMIN_KEY) return; // not configured on this worker — skip quietly
    const res = await fetch(`${PLATFORM_BASE_URL}/api/fees/check-overdue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': process.env.ADMIN_KEY },
      body: JSON.stringify({}),
    });
    const result = await res.json().catch(() => ({}));
    console.log('[fees] overdue check:', res.status, JSON.stringify(result).slice(0, 200));
  } catch (err: any) {
    console.error('[fees] overdue check error:', err?.message || err);
  }
}
setTimeout(() => {
  driveFeeCheck();
  setInterval(driveFeeCheck, FEE_CHECK_INTERVAL_MS);
}, 3 * 60 * 1000);

// Data retention — telemetry/log tables grew unbounded (widget_events alone fires ~10 events
// per checkout). Daily sweep, 90-day window; idempotency keys use their own 24h TTL cleanup
// (the function existed since launch but was never called from anywhere).
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 90;
async function driveRetention() {
  try {
    const { db } = await import('./config/database');
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const [events, chats, webhookLogs] = await Promise.all([
      db.widgetEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }),
      db.stabloChat.deleteMany({ where: { createdAt: { lt: cutoff } } }),
      db.webhookLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    ]);
    const { cleanupExpiredIdempotencyKeys } = await import('./middleware/idempotency');
    const idem = await cleanupExpiredIdempotencyKeys();
    console.log(`[retention] widget_events=${events.count} stablo_chats=${chats.count} webhook_logs=${webhookLogs.count} idempotency=${idem}`);
  } catch (err: any) {
    console.error('[retention] error:', err?.message || err);
  }
}
setTimeout(() => {
  driveRetention();
  setInterval(driveRetention, RETENTION_INTERVAL_MS);
}, 10 * 60 * 1000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[scanner] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[scanner] Shutting down...');
  process.exit(0);
});
