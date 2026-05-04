import { db } from '../src/config/database';
(async () => {
  const onetease = await db.merchant.findFirst({ where: { companyName: { contains: 'One Tease' } }, select: { id: true, companyName: true, webhookEvents: true } });
  if (!onetease) { console.log('not found'); process.exit(1); }
  console.log('Merchant:', onetease.companyName, onetease.id);
  console.log('Subscribed events:', onetease.webhookEvents);

  const cancelledOrders = await db.order.findMany({
    where: { merchantId: onetease.id, status: 'CANCELLED' },
    orderBy: { updatedAt: 'desc' },
    take: 5,
    select: { id: true, externalId: true, updatedAt: true, createdAt: true, chain: true },
  });
  console.log('\nRecent cancelled orders:');
  for (const o of cancelledOrders) {
    console.log(' ', o.updatedAt.toISOString(), o.id.slice(-10), 'ext:' + (o.externalId || '-'), o.chain);
  }

  const recentExpired = await db.webhookLog.findMany({
    where: { merchantId: onetease.id, event: 'order.expired' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { createdAt: true, event: true, httpStatus: true, deliveredAt: true, attempts: true, response: true, payload: true },
  });
  console.log('\nRecent order.expired webhooks:');
  for (const w of recentExpired) {
    const p: any = w.payload;
    console.log(' ', w.createdAt.toISOString(), w.event, 'status=' + w.httpStatus, w.deliveredAt ? 'OK' : 'FAIL', 'order=' + (p?.data?.orderId || '').slice(-10), 'ext=' + (p?.data?.externalId || '-'), 'reason=' + (p?.data?.reason || '-'));
    if (w.response) console.log('    resp:', (w.response || '').substring(0, 200));
  }
  await db.$disconnect();
})();
