import { db } from '../src/config/database';
(async () => {
  const orders = await db.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, status: true, amount: true, feePercent: true, feeAmount: true, merchant: { select: { companyName: true, isDayOne: true } } },
  });
  for (const o of orders) {
    const fp = Number(o.feePercent);
    console.log(`${o.id.slice(0,8)} ${o.merchant?.companyName?.slice(0,15).padEnd(15)} ${o.status.padEnd(10)} amt=$${Number(o.amount).toFixed(2).padStart(8)} feePct=${fp} (${(fp*100).toFixed(2)}%) feeAmt=${Number(o.feeAmount || 0)}`);
  }
  await db.$disconnect();
})();
