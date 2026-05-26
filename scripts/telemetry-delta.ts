/**
 * Compare widget telemetry + orders in the LAST N hours vs the prior N hours.
 * Surfaces user-behavior shifts after recent deploys.
 */
import dotenv from 'dotenv';
dotenv.config();
import { db } from '../src/config/database';

async function main() {
  const HOURS = parseInt(process.argv[2] ?? '6');
  const now = new Date();
  const winStart    = new Date(now.getTime() - HOURS * 3600_000);
  const priorStart  = new Date(now.getTime() - 2 * HOURS * 3600_000);

  const fmtRange = (a: Date, b: Date) => `${a.toISOString().slice(5, 16).replace('T', ' ')} → ${b.toISOString().slice(5, 16).replace('T', ' ')}`;
  console.log(`\n=== Telemetry delta (last ${HOURS}h vs prior ${HOURS}h) ===`);
  console.log(`Current window: ${fmtRange(winStart, now)}`);
  console.log(`Prior window:   ${fmtRange(priorStart, winStart)}\n`);

  // Widget events
  const [curEvents, priorEvents] = await Promise.all([
    db.widgetEvent.groupBy({ by: ['action'], where: { createdAt: { gte: winStart } }, _count: true }),
    db.widgetEvent.groupBy({ by: ['action'], where: { createdAt: { gte: priorStart, lt: winStart } }, _count: true }),
  ]);
  const curMap   = new Map(curEvents.map(r => [r.action, r._count]));
  const priorMap = new Map(priorEvents.map(r => [r.action, r._count]));
  const allActions = new Set([...curMap.keys(), ...priorMap.keys()]);

  console.log('WIDGET EVENTS:');
  if (allActions.size === 0) {
    console.log('  (no widget events in either window)\n');
  } else {
    console.log('  Action                 | Now  | Prior | Δ');
    console.log('  ' + '─'.repeat(48));
    for (const a of [...allActions].sort()) {
      const c = curMap.get(a) ?? 0;
      const p = priorMap.get(a) ?? 0;
      const d = c - p;
      const arrow = d > 0 ? `+${d}` : d < 0 ? `${d}` : '·';
      console.log(`  ${a.padEnd(22)} | ${String(c).padStart(4)} | ${String(p).padStart(5)} | ${arrow}`);
    }
    console.log();
  }

  // Sessions
  const [curSessions, priorSessions] = await Promise.all([
    db.widgetEvent.findMany({ where: { createdAt: { gte: winStart } }, distinct: ['sessionId'], select: { sessionId: true } }),
    db.widgetEvent.findMany({ where: { createdAt: { gte: priorStart, lt: winStart } }, distinct: ['sessionId'], select: { sessionId: true } }),
  ]);
  console.log(`SESSIONS:    now=${curSessions.length}  prior=${priorSessions.length}  Δ=${curSessions.length - priorSessions.length}\n`);

  // Orders by status
  const [curOrders, priorOrders] = await Promise.all([
    db.order.groupBy({ by: ['status'], where: { createdAt: { gte: winStart } }, _count: true }),
    db.order.groupBy({ by: ['status'], where: { createdAt: { gte: priorStart, lt: winStart } }, _count: true }),
  ]);
  const curOrd = new Map(curOrders.map(r => [r.status, r._count]));
  const priorOrd = new Map(priorOrders.map(r => [r.status, r._count]));
  const allS = new Set([...curOrd.keys(), ...priorOrd.keys()]);
  console.log('ORDERS BY STATUS:');
  if (allS.size === 0) console.log('  (no orders in either window)\n');
  else {
    console.log('  Status      | Now  | Prior | Δ');
    console.log('  ' + '─'.repeat(40));
    for (const s of [...allS].sort()) {
      const c = curOrd.get(s) ?? 0; const p = priorOrd.get(s) ?? 0; const d = c - p;
      const arrow = d > 0 ? `+${d}` : d < 0 ? `${d}` : '·';
      console.log(`  ${s.padEnd(11)} | ${String(c).padStart(4)} | ${String(p).padStart(5)} | ${arrow}`);
    }
    console.log();
  }

  // Chain distribution in current window
  const chainSplit = await db.order.groupBy({ by: ['chain'], where: { createdAt: { gte: winStart } }, _count: true });
  if (chainSplit.length > 0) {
    console.log(`CHAIN DISTRIBUTION (last ${HOURS}h):`);
    for (const r of chainSplit.sort((a, b) => b._count - a._count)) {
      console.log(`  ${String(r.chain).padEnd(20)} ${r._count}`);
    }
    console.log();
  }

  // Native token activity
  const nativeOrders = await db.order.findMany({
    where: { nativeToken: { not: null }, createdAt: { gte: winStart } },
    select: { id: true, status: true, chain: true, nativeToken: true, amount: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  console.log(`NATIVE TOKEN ORDERS (last ${HOURS}h): ${nativeOrders.length}`);
  for (const o of nativeOrders.slice(0, 10)) {
    console.log(`  ${o.createdAt.toISOString().slice(5, 16).replace('T', ' ')}  ${o.status.padEnd(10)} ${o.nativeToken} on ${String(o.chain).replace('_MAINNET', '')}  $${Number(o.amount).toFixed(2)}`);
  }
  console.log();

  // Recent payment failures (look at PAYMENT_FAILED events to see why)
  const failures = await db.widgetEvent.findMany({
    where: { action: 'PAYMENT_FAILED', createdAt: { gte: winStart } },
    select: { sessionId: true, details: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  if (failures.length > 0) {
    console.log(`PAYMENT FAILURES (last ${HOURS}h):`);
    for (const f of failures) {
      const d: any = f.details;
      console.log(`  ${f.createdAt.toISOString().slice(11, 19)}  ${d?.chain ?? '?'}/${d?.token ?? '?'}  ${(d?.error ?? '').slice(0, 90)}`);
    }
    console.log();
  }

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
