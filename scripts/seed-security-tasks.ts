/**
 * Add security-pass tasks from the Hermes audit to the growth tracker so they
 * don't get lost. Idempotent — won't duplicate.
 */
import { db } from '../src/config/database';

const SECURITY_TASKS: { title: string; description: string; category: string; priority: number; week: number }[] = [
  {
    title: 'Migrate rate limiting to DB-backed RateLimitBucket',
    description: 'In-memory rateLimitStore resets on every Vercel cold start, so the limiter is effectively off in serverless. The RateLimitBucket table is already in the schema but unused. Refactor src/middleware/rateLimit.ts to read/write it.',
    category: 'setup', priority: 1, week: 5,
  },
  {
    title: 'Wire idempotency middleware on order creation',
    description: 'IdempotencyKey model exists, idempotency.ts middleware exists, but POST /api/orders / /api/embed/checkout don\'t invoke it. Merchants retrying after a timeout could create duplicate orders. Real-money risk.',
    category: 'setup', priority: 1, week: 5,
  },
  {
    title: 'Add merchant token rotation endpoint',
    description: 'Tokens are static for 1 year with no rotation. Add POST /api/auth/rotate-token (merchant-authed) that generates a new token and invalidates the old. Show "Rotate API token" button in dashboard Settings.',
    category: 'setup', priority: 2, week: 5,
  },
  {
    title: 'Drop ?token=X query-param auth path',
    description: 'requireMerchantAuth accepts the token via Authorization header OR ?token=X query param. Query params leak through referrer headers, server access logs, and browser history. Remove the query param fallback.',
    category: 'setup', priority: 2, week: 5,
  },
  {
    title: 'Scanner circuit breaker per chain',
    description: 'If a chain\'s RPC is down for hours, the scanner keeps trying every 15s. Add escalating backoff after N consecutive failures (15s → 60s → 300s → 1800s). Log a single alert when backoff escalates.',
    category: 'setup', priority: 3, week: 6,
  },
  {
    title: 'Per-merchant cap on pending webhook retries',
    description: 'processRetries pulls up to 100 logs per cycle. A single dead merchant endpoint can dominate that 100 and starve others. Add: max N pending retries per merchantId, oldest first.',
    category: 'setup', priority: 3, week: 6,
  },
  {
    title: 'Validate refund txHash on-chain before marking PROCESSED',
    description: 'processRefund() accepts whatever txHash the merchant pastes. Should verify on-chain that the tx exists, sender is merchant\'s wallet, recipient is customer, amount matches refund amount, token matches. Avoids fake refunds.',
    category: 'setup', priority: 2, week: 5,
  },
  {
    title: 'TypeScript strict mode pass',
    description: 'tsconfig has strict mode off in places, leading to `: any` sprinkled in admin.ts, blockchainService.ts. Turn on strict + fix the resulting type errors. Catches real bugs.',
    category: 'setup', priority: 4, week: 7,
  },
  {
    title: 'Plan re-encryption migration for managed wallets',
    description: 'Now that MANAGED_WALLET_ENCRYPTION_KEY is a separate var, plan a one-shot migration that decrypts with old key (JWT_SECRET) and re-encrypts with fresh dedicated key. Requires generating new key, running migration script, retiring old fallback chain.',
    category: 'setup', priority: 2, week: 6,
  },
];

(async () => {
  let inserted = 0, skipped = 0;
  for (const t of SECURITY_TASKS) {
    const existing = await db.growthTask.findFirst({ where: { title: t.title } });
    if (existing) { skipped++; continue; }
    await db.growthTask.create({ data: t });
    inserted++;
    console.log('  +', t.title);
  }
  console.log(`\nSecurity tasks seeded: ${inserted} new, ${skipped} already existed`);
  await db.$disconnect();
})();
