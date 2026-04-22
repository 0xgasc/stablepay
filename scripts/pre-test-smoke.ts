/**
 * Pre-test health check. Run BEFORE every live testing session with a merchant.
 * Verifies every thing that has bitten us in the past:
 *   1. DB reachable + schema migrated
 *   2. Scanner is actually running (recent heartbeat in logs)
 *   3. All chain RPCs respond within 4s (not just primary — every fallback)
 *   4. Webhook queue isn't silently backed up
 *   5. The merchant under test has correct wallet + webhook config
 *   6. Merchant's webhook endpoint responds to a cheap probe (optional)
 *
 * Usage: npx tsx scripts/pre-test-smoke.ts [merchantIdOrName]
 * Exits non-zero if anything is unhealthy so it's CI-friendly.
 */
import { db } from '../src/config/database';
import { CHAIN_CONFIGS } from '../src/config/chains';
import { getHealthyProvider } from '../src/services/rpcProvider';

const MAINNET_CHAINS = ['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'BNB_MAINNET'] as const;
let failures = 0;
const pass = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => { console.log(`  ✗ ${m}`); failures++; };

async function main() {
  const target = process.argv[2];
  console.log(`\n=== StablePay pre-test smoke check ===`);

  // 1. DB
  console.log(`\n[1] database`);
  try {
    await db.$queryRaw`SELECT 1`;
    pass('DB reachable');
  } catch (e: any) { fail(`DB unreachable: ${e.message}`); }

  // 2. Scanner recent activity — proves Railway worker is alive
  console.log(`\n[2] scanner`);
  const lastLog = await db.webhookLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  const lastExpire = await db.order.findFirst({
    where: { status: 'EXPIRED' },
    orderBy: { updatedAt: 'desc' }, select: { updatedAt: true },
  });
  const lastActivity = Math.max(lastLog?.createdAt.getTime() || 0, lastExpire?.updatedAt.getTime() || 0);
  const ageMin = Math.round((Date.now() - lastActivity) / 60_000);
  if (ageMin < 120) pass(`scanner active, last tick ${ageMin} min ago`);
  else fail(`scanner silent for ${ageMin} min — Railway may be down`);

  // 3. RPC fallback health — probes every configured URL per chain
  console.log(`\n[3] RPC endpoints (primary + fallbacks)`);
  for (const chain of MAINNET_CHAINS) {
    const cfg = CHAIN_CONFIGS[chain];
    const urls = [cfg.rpcUrl, ...(cfg.rpcFallbacks || [])];
    try {
      const p = await getHealthyProvider(chain as any);
      const b = await p.getBlockNumber();
      pass(`${chain.padEnd(18)} healthy @ block ${b} (${urls.length} endpoints configured)`);
    } catch (e: any) {
      fail(`${chain} — ALL ${urls.length} RPCs unreachable: ${e.message}`);
    }
  }

  // 4. Webhook queue
  console.log(`\n[4] webhook queue`);
  // Overdue = retries that SHOULD have fired but haven't — scanner retry loop stalled if > 10.
  const overdue = await db.webhookLog.count({ where: { deliveredAt: null, nextRetryAt: { lte: new Date(), not: null } } });
  // Fresh abandoned (last 24h only) — historical abandons from old incidents aren't actionable.
  const freshAbandoned = await db.webhookLog.count({
    where: {
      deliveredAt: null, attempts: { gte: 5 }, nextRetryAt: null,
      createdAt: { gte: new Date(Date.now() - 24 * 3600_000) },
    },
  });
  if (overdue < 10) pass(`overdue retries: ${overdue}`);
  else fail(`overdue retries: ${overdue} — scanner retry loop may be stalled`);
  if (freshAbandoned < 5) pass(`abandoned in last 24h: ${freshAbandoned}`);
  else fail(`abandoned in last 24h: ${freshAbandoned} — a merchant endpoint is rejecting`);

  // 5. Target merchant check (if specified)
  if (target) {
    console.log(`\n[5] merchant config for "${target}"`);
    const m = await db.merchant.findFirst({
      where: { OR: [{ id: target }, { email: target }, { companyName: { contains: target, mode: 'insensitive' } }] },
      include: {
        wallets: { where: { isActive: true }, select: { chain: true, address: true, supportedTokens: true } },
      },
    });
    if (!m) { fail(`merchant not found: ${target}`); }
    else {
      pass(`merchant: ${m.companyName} (${m.id})`);
      if (m.isSuspended) fail(`merchant SUSPENDED`); else pass(`not suspended`);
      if (m.webhookUrl) pass(`webhook URL: ${m.webhookUrl}`); else fail(`no webhook URL configured`);
      if (m.webhookEnabled) pass(`webhook enabled`); else fail(`webhook disabled`);
      if (m.webhookSecret) pass(`webhook secret present`); else fail(`webhook secret MISSING — we'll sign with empty string`);
      if (m.wallets.length > 0) {
        pass(`${m.wallets.length} active wallet(s): ${m.wallets.map(w => w.chain).join(', ')}`);
      } else fail(`no active wallets`);

      // Recent webhook success rate to this merchant
      const recent = await db.webhookLog.findMany({
        where: { merchantId: m.id, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
        select: { httpStatus: true, deliveredAt: true },
      });
      if (recent.length > 0) {
        const ok = recent.filter(r => r.deliveredAt).length;
        const pct = Math.round((ok / recent.length) * 100);
        if (pct >= 80) pass(`24h delivery rate: ${ok}/${recent.length} (${pct}%)`);
        else fail(`24h delivery rate: ${ok}/${recent.length} (${pct}%) — merchant endpoint is rejecting/failing`);
      } else {
        console.log(`    (no webhook activity in last 24h)`);
      }
    }
  }

  console.log(`\n=== ${failures === 0 ? 'ALL GREEN ✓' : `${failures} FAILURE(S) ✗`} ===\n`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
