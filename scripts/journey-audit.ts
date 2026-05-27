/**
 * Audit telemetry coverage + merchant traffic + journey replay.
 * Surfaces: who's seeing checkout, where they drop off, what we DON'T track.
 */
import dotenv from 'dotenv';
dotenv.config();
import { db } from '../src/config/database';

async function main() {
  const since = new Date(Date.now() - 7 * 86_400_000);

  // 1. Per-merchant traffic in last 7d
  const merchants = await db.merchant.findMany({
    where: { email: { in: ['info@oneteasetech.com', 'khrisflohr@unlockriver.com'] } },
    select: { id: true, email: true, companyName: true },
  });
  console.log('\n=== MERCHANT TRAFFIC (last 7d) ===\n');
  for (const m of merchants) {
    const [orders, events] = await Promise.all([
      db.order.groupBy({ by: ['status'], where: { merchantId: m.id, createdAt: { gte: since } }, _count: true }),
      db.widgetEvent.findMany({ where: { merchantId: m.id, createdAt: { gte: since } }, select: { sessionId: true }, distinct: ['sessionId'] }),
    ]);
    const totalOrders = orders.reduce((s, r) => s + r._count, 0);
    const confirmed = orders.find(o => o.status === 'CONFIRMED')?._count ?? 0;
    console.log(`${m.companyName}:`);
    console.log(`  orders: ${totalOrders} total, ${confirmed} confirmed`);
    console.log(`  status breakdown: ${orders.map(o => `${o.status}=${o._count}`).join(', ') || '(none)'}`);
    console.log(`  unique widget sessions: ${events.length}`);
    console.log();
  }

  // 2. Journey replay for the most recent ABANDONED session (variant=guided to test wizard data)
  console.log('=== JOURNEY REPLAY: most recent abandoned guided session ===\n');
  const recentSessions = await db.widgetEvent.findMany({
    where: { action: 'VARIANT_ASSIGNED', createdAt: { gte: since }, details: { path: ['variant'], equals: 'guided' } as any },
    select: { sessionId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  let abandonedSessionId: string | null = null;
  for (const r of recentSessions) {
    const evs = await db.widgetEvent.findMany({
      where: { sessionId: r.sessionId },
      select: { action: true },
    });
    const hasTerminal = evs.some(e => e.action === 'PAY_CLICKED' || e.action === 'NATIVE_TX_BROADCAST');
    if (!hasTerminal) { abandonedSessionId = r.sessionId; break; }
  }

  if (!abandonedSessionId) console.log('(no abandoned guided sessions in window)\n');
  else {
    const journey = await db.widgetEvent.findMany({
      where: { sessionId: abandonedSessionId },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`Session: ${abandonedSessionId.slice(0, 12)}…`);
    console.log(`Events: ${journey.length}`);
    let prevTs = 0;
    for (const e of journey) {
      const ts = e.createdAt.toISOString().slice(11, 19);
      const ms = prevTs ? e.createdAt.getTime() - prevTs : 0;
      const gap = prevTs ? `+${(ms/1000).toFixed(1)}s` : '';
      const dKeys = e.details && typeof e.details === 'object' ? Object.keys(e.details as any).map(k => `${k}=${(e.details as any)[k]}`).join(' ') : '';
      console.log(`  ${ts} ${gap.padStart(8)}  ${e.action.padEnd(22)} ${dKeys.slice(0, 80)}`);
      prevTs = e.createdAt.getTime();
    }
    console.log();
  }

  // 3. Coverage audit: list events we capture vs events that would help
  console.log('=== TELEMETRY COVERAGE GAP ANALYSIS ===\n');
  const captured = await db.widgetEvent.groupBy({
    by: ['action'], where: { createdAt: { gte: since } }, _count: true,
  });
  console.log('Currently captured (last 7d):');
  for (const c of captured.sort((a, b) => b._count - a._count)) {
    console.log(`  ${c.action.padEnd(24)} ${c._count}`);
  }

  console.log('\nNOT YET captured — gaps that would directly explain abandonment:');
  const missing = [
    'MANUAL_PAY_VIEWED        when customer reaches the QR/address screen',
    'QR_DISPLAYED             QR code was rendered (= customer about to send)',
    'ADDRESS_COPIED           customer clicked Copy on the receive address',
    'WALLET_CONNECT_OPENED    customer clicked Connect Wallet button',
    'WALLET_CONNECT_FAILED    connection rejected or timed out (with reason)',
    'INSUFFICIENT_BALANCE     we showed "not enough X" message',
    'BACK_BUTTON_CLICKED      customer left via Back',
    'CANCEL_CLICKED           customer clicked Cancel Payment',
    'TX_REJECTED              MetaMask/Phantom user rejected the tx prompt',
    'CHAIN_SWITCH_REJECTED    wallet refused to switch to required chain',
  ];
  for (const m of missing) console.log(`  ${m}`);

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
