import dotenv from 'dotenv';
dotenv.config();
import { db } from '../src/config/database';

async function main() {
  const now = new Date();
  const day = new Date(now.getTime() - 86_400_000);
  const week = new Date(now.getTime() - 7 * 86_400_000);

  const [confirmed24h, confirmed7d, byChain, byStatus24h, native7d, refunds7d, expired7d, recentConfirmed] = await Promise.all([
    db.order.count({ where: { status: 'CONFIRMED', updatedAt: { gte: day } } }),
    db.order.count({ where: { status: 'CONFIRMED', updatedAt: { gte: week } } }),
    db.order.groupBy({ by: ['chain', 'status'], where: { createdAt: { gte: week } }, _count: true }),
    db.order.groupBy({ by: ['status'], where: { createdAt: { gte: day } }, _count: true }),
    db.order.findMany({
      where: { nativeToken: { not: null }, createdAt: { gte: week } },
      select: { id: true, status: true, chain: true, nativeToken: true, amount: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.refund.count({ where: { createdAt: { gte: week } } }),
    db.order.count({ where: { status: 'EXPIRED', createdAt: { gte: week } } }),
    db.order.findMany({
      where: { status: 'CONFIRMED', updatedAt: { gte: day } },
      select: { id: true, chain: true, token: true, amount: true, feeAmount: true, nativeToken: true, conversionFeeAmount: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    }),
  ]);

  // Volume + fees
  const vol7d = await db.order.aggregate({
    where: { status: 'CONFIRMED', updatedAt: { gte: week } },
    _sum: { amount: true, feeAmount: true, conversionFeeAmount: true },
  });

  // Timing on recent confirms
  const timings = recentConfirmed
    .map(o => o.updatedAt.getTime() - o.createdAt.getTime())
    .sort((a, b) => a - b);
  const p50 = timings[Math.floor(timings.length * 0.5)] || 0;
  const p95 = timings[Math.floor(timings.length * 0.95)] || 0;

  console.log(JSON.stringify({
    confirmed_24h: confirmed24h,
    confirmed_7d:  confirmed7d,
    expired_7d:    expired7d,
    refunds_7d:    refunds7d,
    volume_7d_usd: Number(vol7d._sum?.amount ?? 0),
    fees_7d_usd:   Number(vol7d._sum?.feeAmount ?? 0),
    conv_fees_7d:  Number(vol7d._sum?.conversionFeeAmount ?? 0),
    by_chain_7d:   byChain,
    by_status_24h: byStatus24h,
    native_orders_7d: native7d,
    timing_p50_sec: Math.round(p50 / 1000),
    timing_p95_sec: Math.round(p95 / 1000),
    recent_confirmed_24h: recentConfirmed.length,
  }, null, 2));

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
