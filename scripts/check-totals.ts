import { db } from '../src/config/database';
(async () => {
  const total = await db.order.count();
  const confirmed = await db.order.findMany({ where: { status: 'CONFIRMED' }, select: { amount: true, feeAmount: true } });
  const all = await db.order.findMany({ select: { amount: true, status: true } });

  const sumConfirmed = confirmed.reduce((a, o) => a + Number(o.amount), 0);
  const sumAll = all.reduce((a, o) => a + Number(o.amount), 0);
  const fees = confirmed.reduce((a, o) => a + Number(o.feeAmount || 0), 0);

  console.log('Total orders:', total);
  console.log('Confirmed:', confirmed.length, '($', sumConfirmed.toFixed(2), ')');
  console.log('All orders sum (any status):', '$', sumAll.toFixed(2));
  console.log('Fees from confirmed:', '$', fees.toFixed(4));

  const byStatus: Record<string, { count: number; sum: number }> = {};
  for (const o of all) {
    if (!byStatus[o.status]) byStatus[o.status] = { count: 0, sum: 0 };
    byStatus[o.status].count++;
    byStatus[o.status].sum += Number(o.amount);
  }
  console.log('\nBy status:');
  for (const [s, v] of Object.entries(byStatus)) console.log(`  ${s.padEnd(12)} ${v.count.toString().padStart(4)}  $${v.sum.toFixed(2)}`);
  await db.$disconnect();
})();
