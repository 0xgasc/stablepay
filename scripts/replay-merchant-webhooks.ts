/**
 * Replay failed webhooks for a merchant. Resets abandoned (5-attempt-maxed) and
 * error-state deliveries so the scanner retry loop picks them up within 60s.
 *
 * Usage:
 *   npx tsx scripts/replay-merchant-webhooks.ts <merchantId> [--hours=N]
 *
 * Defaults to replaying everything in the last 7 days.
 */
import { db } from '../src/config/database';

async function main() {
  const merchantId = process.argv[2];
  if (!merchantId) {
    console.error('usage: replay-merchant-webhooks.ts <merchantId> [--hours=N]');
    process.exit(1);
  }
  const hoursArg = process.argv.find(a => a.startsWith('--hours='));
  const hours = hoursArg ? Number(hoursArg.split('=')[1]) : 7 * 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: { companyName: true, webhookUrl: true, webhookEnabled: true },
  });
  if (!merchant) { console.error('merchant not found'); process.exit(1); }
  console.log(`Replaying for ${merchant.companyName}`);
  console.log(`  webhookUrl: ${merchant.webhookUrl}`);
  console.log(`  enabled:    ${merchant.webhookEnabled}`);
  console.log(`  window:     last ${hours}h (since ${since.toISOString()})`);

  const stuck = await db.webhookLog.findMany({
    where: {
      merchantId,
      deliveredAt: null,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, event: true, httpStatus: true, attempts: true, createdAt: true },
  });
  console.log(`  stuck:      ${stuck.length} deliveries`);
  for (const s of stuck.slice(0, 20)) {
    console.log(`    ${s.createdAt.toISOString()} ${s.event} status=${s.httpStatus} attempts=${s.attempts}`);
  }
  if (stuck.length > 20) console.log(`    … + ${stuck.length - 20} more`);

  if (stuck.length === 0) { await db.$disconnect(); return; }

  // Reset state so processRetries picks them up on the next Railway tick (60s).
  // Attempts reset to 1 (pre-retry state), nextRetryAt set to now.
  const result = await db.webhookLog.updateMany({
    where: { id: { in: stuck.map(s => s.id) } },
    data: { attempts: 1, nextRetryAt: new Date() },
  });
  console.log(`\nReset ${result.count} deliveries. Railway scanner will pick them up within 60s.`);
  console.log(`Watch live:  npx tsx scripts/check-onetease-webhooks.ts`);

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
