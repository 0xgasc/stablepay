import { db } from '../src/config/database';
(async () => {
  const start = new Date('2026-05-03T22:55:00Z');
  const end = new Date('2026-05-03T23:10:00Z');
  const orders = await db.$queryRaw<any[]>`
    SELECT o.id, o."externalId", o."merchantId", m."companyName" as merchant, o.amount, o.token, o.chain, o.status, o."createdAt"
    FROM orders o JOIN merchants m ON o."merchantId" = m.id
    WHERE o."createdAt" BETWEEN ${start} AND ${end}
    ORDER BY o."createdAt" ASC
  `;
  console.log(`=== ${orders.length} orders in window ===`);
  for (const o of orders) {
    const ts = new Date(o.createdAt).toISOString();
    console.log(' ', ts, o.merchant, o.id.slice(-10), 'ext:' + (o.externalId || '-'), '$' + Number(o.amount), o.token, o.chain, o.status);
  }

  const hooks = await db.webhookLog.findMany({
    where: { createdAt: { gte: start, lte: end } },
    orderBy: { createdAt: 'asc' },
    select: { merchantId: true, event: true, httpStatus: true, deliveredAt: true, attempts: true, createdAt: true, response: true, payload: true },
  });
  const merchants = await db.merchant.findMany({
    where: { id: { in: Array.from(new Set(hooks.map(h => h.merchantId))) } },
    select: { id: true, companyName: true },
  });
  const mname = (id: string) => merchants.find(m => m.id === id)?.companyName || id.slice(-8);

  console.log(`\n=== ${hooks.length} webhooks in window ===`);
  for (const h of hooks) {
    const p: any = h.payload;
    console.log(' ', h.createdAt.toISOString().slice(11, 19), mname(h.merchantId), h.event, 'status=' + h.httpStatus, h.deliveredAt ? 'OK' : 'FAIL', 'order=' + (p?.data?.orderId || '').slice(-10));
    if (h.response) console.log('    resp:', (h.response || '').substring(0, 120));
  }
  await db.$disconnect();
})();
