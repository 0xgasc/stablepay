/**
 * Platform health check. Aggregates the things that, when broken, have caused real
 * customer-visible incidents (UnlockRiver scanner silent-drop, One Tease 401 storm,
 * llamarpc Cloudflare blocks). Used by:
 *   - GET /api/health        (public read-only JSON, drives /status page)
 *   - healthAlerter loop     (polls every 5 min, emails ops if things stay broken)
 *
 * Categories ordered by blast radius — the first non-OK component in this list determines
 * the overall status. So a DB outage degrades to "down" while a single noisy RPC degrades
 * to "warning".
 */
import { db } from '../config/database';
import { CHAIN_CONFIGS } from '../config/chains';
import { getHealthyProvider } from './rpcProvider';

export type Status = 'ok' | 'warning' | 'down';

export interface ComponentHealth {
  status: Status;
  message?: string;
  details?: Record<string, any>;
}

export interface HealthReport {
  status: Status;
  checkedAt: string;
  durationMs: number;
  components: {
    database: ComponentHealth;
    scanner: ComponentHealth;
    rpc: ComponentHealth;
    webhookQueue: ComponentHealth;
    webhookDelivery: ComponentHealth;
  };
}

const MAINNETS = ['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'BNB_MAINNET'] as const;

async function checkDatabase(): Promise<ComponentHealth> {
  try {
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    const ms = Date.now() - t0;
    if (ms > 2000) return { status: 'warning', message: `slow query (${ms}ms)`, details: { latencyMs: ms } };
    return { status: 'ok', details: { latencyMs: ms } };
  } catch (err: any) {
    return { status: 'down', message: String(err?.message || err).split('\n')[0].slice(0, 200) };
  }
}

async function checkScanner(): Promise<ComponentHealth> {
  // Read the dedicated scanner heartbeat (written every cycle by blockchainService.startScanning).
  // This is the authoritative liveness signal — independent of webhook traffic or order
  // creation, so it doesn't false-flag during quiet periods.
  try {
    const [hb, pendingNow] = await Promise.all([
      db.systemConfig.findUnique({ where: { key: 'scanner_heartbeat_at' } }),
      db.order.count({ where: { status: 'PENDING', expiresAt: { gt: new Date() } } }),
    ]);
    const heartbeatTs = hb?.value ? new Date(hb.value).getTime() : 0;
    const ageSec = heartbeatTs ? Math.round((Date.now() - heartbeatTs) / 1000) : Infinity;

    if (!heartbeatTs) {
      return { status: 'warning', message: 'no scanner heartbeat recorded yet (waiting for first cycle)', details: { pendingNow } };
    }
    // Scanner cycles every 5s when active, max 5s + idle gap. Anything >60s old means scanner stalled.
    if (ageSec > 60) {
      return { status: 'down', message: `scanner heartbeat ${ageSec}s old — worker is stalled`, details: { lastHeartbeatSecAgo: ageSec, pendingNow } };
    }
    return { status: 'ok', details: { lastHeartbeatSecAgo: ageSec, pendingNow } };
  } catch (err: any) {
    return { status: 'down', message: String(err?.message || err).slice(0, 200) };
  }
}

async function checkRpc(): Promise<ComponentHealth> {
  // Probe every mainnet chain in parallel. With the rpcProvider fallback layer, "down" only
  // happens if ALL configured RPCs (primary + fallbacks) for a given chain are unreachable.
  const results = await Promise.all(
    MAINNETS.map(async (chain) => {
      try {
        const p = await getHealthyProvider(chain as any);
        const block = await p.getBlockNumber();
        return { chain, ok: block > 0, block };
      } catch (err: any) {
        return { chain, ok: false, error: String(err?.message || err).slice(0, 120) };
      }
    })
  );
  const failed = results.filter(r => !r.ok);
  if (failed.length === 0) return { status: 'ok', details: Object.fromEntries(results.map(r => [r.chain, (r as any).block || 'fail'])) };
  if (failed.length < MAINNETS.length) return { status: 'warning', message: `${failed.length}/${MAINNETS.length} chains have no healthy RPC`, details: { failed: failed.map(f => f.chain) } };
  return { status: 'down', message: 'No mainnet RPC responding for any chain', details: { failed: failed.map(f => f.chain) } };
}

async function checkWebhookQueue(): Promise<ComponentHealth> {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60_000);
    const [overdue, stuckOldest] = await Promise.all([
      db.webhookLog.count({ where: { deliveredAt: null, nextRetryAt: { lte: now, not: null } } }),
      db.webhookLog.findFirst({
        where: { deliveredAt: null, nextRetryAt: { lte: now, not: null } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    if (overdue > 50) {
      const stalledMin = stuckOldest ? Math.round((Date.now() - stuckOldest.createdAt.getTime()) / 60_000) : 0;
      return { status: 'down', message: `${overdue} overdue retries, oldest ${stalledMin} min — retry loop stalled`, details: { overdue, stalledMin } };
    }
    if (overdue > 10) return { status: 'warning', message: `${overdue} overdue retries`, details: { overdue } };
    return { status: 'ok', details: { overdue } };
  } catch (err: any) {
    return { status: 'down', message: String(err?.message || err).slice(0, 200) };
  }
}

async function checkWebhookDelivery(): Promise<ComponentHealth> {
  // Per-merchant 1h success rate. If ANY merchant is below 50%, that's a "merchant rejecting
  // our webhooks" situation (One Tease 401 storm) — a structural issue we want flagged even
  // though the platform itself is fine.
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000);
    const recent = await db.webhookLog.findMany({
      where: { createdAt: { gte: oneHourAgo } },
      select: { merchantId: true, deliveredAt: true, httpStatus: true },
    });
    if (recent.length === 0) return { status: 'ok', message: 'no recent webhook activity', details: { count: 0 } };

    const byMerchant = new Map<string, { total: number; ok: number }>();
    for (const r of recent) {
      const slot = byMerchant.get(r.merchantId) || { total: 0, ok: 0 };
      slot.total++;
      if (r.deliveredAt) slot.ok++;
      byMerchant.set(r.merchantId, slot);
    }

    const failingMerchants: { merchantId: string; pct: number; total: number }[] = [];
    for (const [merchantId, s] of byMerchant) {
      const pct = Math.round((s.ok / s.total) * 100);
      if (s.total >= 5 && pct < 50) failingMerchants.push({ merchantId, pct, total: s.total });
    }
    if (failingMerchants.length > 0) {
      return {
        status: 'warning',
        message: `${failingMerchants.length} merchant(s) below 50% delivery rate`,
        details: { failingMerchants },
      };
    }
    const totalOk = [...byMerchant.values()].reduce((a, s) => a + s.ok, 0);
    const total = recent.length;
    return { status: 'ok', details: { total, deliveredPct: Math.round((totalOk / total) * 100) } };
  } catch (err: any) {
    return { status: 'down', message: String(err?.message || err).slice(0, 200) };
  }
}

export async function runHealthCheck(): Promise<HealthReport> {
  const t0 = Date.now();
  const [database, scanner, rpc, webhookQueue, webhookDelivery] = await Promise.all([
    checkDatabase(),
    checkScanner(),
    checkRpc(),
    checkWebhookQueue(),
    checkWebhookDelivery(),
  ]);
  // Overall status = worst component status. "down" wins over "warning" wins over "ok".
  const components = { database, scanner, rpc, webhookQueue, webhookDelivery };
  const statuses = Object.values(components).map(c => c.status);
  const overall: Status = statuses.includes('down') ? 'down' : statuses.includes('warning') ? 'warning' : 'ok';
  return {
    status: overall,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    components,
  };
}
