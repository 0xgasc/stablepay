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
    agentGas: ComponentHealth;
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

async function checkAgentGas(): Promise<ComponentHealth> {
  try {
    const { ethers } = await import('ethers');
    const AGENT_ADDR = process.env.AGENT_WALLET_ADDRESS?.trim();
    if (!AGENT_ADDR) return { status: 'warning', message: 'AGENT_WALLET_ADDRESS not set' };

    // Min native balance per chain to cover ~10 swaps + forwards (so we get paged before the wallet drains)
    const CHAINS = [
      { key: 'BASE_MAINNET',     rpc: 'https://mainnet.base.org',                  min: 0.001,  native: 'ETH'   },
      { key: 'ETHEREUM_MAINNET', rpc: 'https://ethereum-rpc.publicnode.com',        min: 0.05,   native: 'ETH'   },
      { key: 'POLYGON_MAINNET',  rpc: 'https://polygon-bor-rpc.publicnode.com',     min: 0.2,    native: 'MATIC' },
      { key: 'ARBITRUM_MAINNET', rpc: 'https://arbitrum-one-rpc.publicnode.com',    min: 0.001,  native: 'ETH'   },
      { key: 'BNB_MAINNET',      rpc: 'https://bsc-dataseed.binance.org',            min: 0.01,   native: 'BNB'   },
    ];

    const balances: Record<string, { balance: number; min: number; native: string; ok: boolean }> = {};
    const lowList: string[] = [];
    const emptyList: string[] = [];

    await Promise.all(CHAINS.map(async (c) => {
      try {
        const p = new ethers.JsonRpcProvider(c.rpc);
        const bal = await p.getBalance(AGENT_ADDR);
        const v = Number(ethers.formatEther(bal));
        balances[c.key] = { balance: Number(v.toFixed(6)), min: c.min, native: c.native, ok: v >= c.min };
        if (v === 0) emptyList.push(c.key);
        else if (v < c.min) lowList.push(c.key);
        p.destroy();
      } catch { balances[c.key] = { balance: -1, min: c.min, native: c.native, ok: false }; }
    }));

    // Check Solana agent too
    try {
      const SOL_ADDR = process.env.AGENT_SOLANA_ADDRESS?.trim();
      if (SOL_ADDR) {
        const r = await fetch('https://api.mainnet-beta.solana.com', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [SOL_ADDR] }),
          signal: AbortSignal.timeout(5_000),
        });
        const j = await r.json() as any;
        const lamports = j?.result?.value ?? 0;
        const sol = lamports / 1e9;
        balances['SOLANA_MAINNET'] = { balance: Number(sol.toFixed(6)), min: 0.05, native: 'SOL', ok: sol >= 0.05 };
        if (sol === 0) emptyList.push('SOLANA_MAINNET');
        else if (sol < 0.05) lowList.push('SOLANA_MAINNET');
      }
    } catch { /* skip */ }

    // Self-bootstrap (since 2026-05-26): empty agent doesn't break orders — the customer's
    // deposit covers gas for the first order, and the sweep seeds the agent. So 'empty' is
    // only a warning, not down. Real outages surface via the swap_failed webhook + Stranded Funds.
    if (emptyList.length > 0 || lowList.length > 0) {
      const allFlagged = [...emptyList, ...lowList];
      return { status: 'warning', message: `agent wallet empty/low on ${allFlagged.length} chain(s): ${allFlagged.join(', ')}`, details: balances as any };
    }
    return { status: 'ok', details: balances as any };
  } catch (err: any) {
    return { status: 'warning', message: `agent gas check failed: ${String(err?.message || err).slice(0, 200)}` };
  }
}

export async function runHealthCheck(): Promise<HealthReport> {
  const t0 = Date.now();
  const [database, scanner, rpc, webhookQueue, webhookDelivery, agentGas] = await Promise.all([
    checkDatabase(),
    checkScanner(),
    checkRpc(),
    checkWebhookQueue(),
    checkWebhookDelivery(),
    checkAgentGas(),
  ]);
  // Overall status = worst component status. "down" wins over "warning" wins over "ok".
  const components = { database, scanner, rpc, webhookQueue, webhookDelivery, agentGas };
  const statuses = Object.values(components).map(c => c.status);
  const overall: Status = statuses.includes('down') ? 'down' : statuses.includes('warning') ? 'warning' : 'ok';
  return {
    status: overall,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    components,
  };
}
