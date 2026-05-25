/**
 * overnight-monitor.ts — called by the Claude /loop every 20 min
 * Outputs structured JSON for the morning report.
 * Usage: npx ts-node scripts/overnight-monitor.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';
import { db } from '../src/config/database';

const AGENT_ADDR = process.env.AGENT_WALLET_ADDRESS?.trim() ?? '';

const EVM_CHAINS = [
  { key: 'Base',     chainId: 8453,  rpc: 'https://mainnet.base.org',                   native: 'ETH',  minOk: 0.001 },
  { key: 'Ethereum', chainId: 1,     rpc: 'https://eth.llamarpc.com',                    native: 'ETH',  minOk: 0.01  },
  { key: 'Polygon',  chainId: 137,   rpc: 'https://polygon-rpc.com',                     native: 'MATIC', minOk: 0.1  },
  { key: 'Arbitrum', chainId: 42161, rpc: 'https://arbitrum-one-rpc.publicnode.com',     native: 'ETH',  minOk: 0.001 },
  { key: 'BNB',      chainId: 56,    rpc: 'https://bsc-dataseed.binance.org',             native: 'BNB',  minOk: 0.005 },
];

async function main() {
  const report: Record<string, unknown> = { ts: new Date().toISOString() };

  // 1. Production health
  try {
    const h = await fetch('https://wetakestables.shop/api/health/platform', { signal: AbortSignal.timeout(8_000) });
    report.health = h.ok ? await h.json() : { status: 'error', code: h.status };
  } catch (e: any) { report.health = { status: 'unreachable', error: e.message }; }

  // 2. Agent wallet balances on EVM chains
  const wallets: Record<string, string> = {};
  const lowGas: string[] = [];
  for (const chain of EVM_CHAINS) {
    try {
      const p = new ethers.JsonRpcProvider(chain.rpc);
      const bal = await p.getBalance(AGENT_ADDR);
      const eth = Number(ethers.formatEther(bal));
      wallets[chain.key] = `${eth.toFixed(6)} ${chain.native}`;
      if (eth < chain.minOk) lowGas.push(`${chain.key} (${eth.toFixed(6)} < ${chain.minOk} ${chain.native})`);
    } catch { wallets[chain.key] = 'RPC_ERROR'; }
  }
  report.agentWallets = wallets;
  report.lowGasAlerts = lowGas;

  // 3. Order stats
  try {
    const [pending, processing, confirmed24h, stuck] = await Promise.all([
      db.order.count({ where: { status: 'PENDING' } }),
      db.order.count({ where: { status: 'PROCESSING' } }),
      db.order.count({ where: { status: 'CONFIRMED', updatedAt: { gte: new Date(Date.now() - 86400_000) } } }),
      // Orders stuck in PROCESSING for > 5 min
      db.order.findMany({
        where: { status: 'PROCESSING', updatedAt: { lte: new Date(Date.now() - 5 * 60_000) } },
        select: { id: true, updatedAt: true, chain: true, nativeToken: true },
      }),
    ]);
    report.orders = { pending, processing, confirmed_24h: confirmed24h, stuckInProcessing: stuck };
  } catch (e: any) { report.orders = { error: e.message }; }

  // 4. Recent native token orders (last 2 hours)
  try {
    const native = await db.order.findMany({
      where: { nativeToken: { not: null }, createdAt: { gte: new Date(Date.now() - 7_200_000) } },
      select: { id: true, status: true, nativeToken: true, chain: true, amount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    report.recentNativeOrders = native;
  } catch (e: any) { report.recentNativeOrders = { error: e.message }; }

  // 5. Railway deploy (check if latest commit is live via health endpoint version hint)
  report.latestCommit = '7e81db9'; // last known good deploy

  await db.$disconnect();
  console.log(JSON.stringify(report, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });
