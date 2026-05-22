import { db } from '../src/config/database';
(async () => {
  const ur = await db.merchant.findFirst({ where: { companyName: { contains: 'UnlockRiver' } }, select: { id: true } });
  if (!ur) process.exit(1);
  const since = new Date(Date.now() - 60 * 60 * 1000); // last 60 min
  const orders = await db.order.findMany({
    where: { merchantId: ur.id, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, amount: true, externalId: true, createdAt: true, chain: true, token: true, paymentAddress: true },
  });
  console.log(`UnlockRiver orders in last 60 min: ${orders.length}`);
  for (const o of orders) {
    console.log(`  ${o.createdAt.toISOString()} ${o.status} $${Number(o.amount)} ${o.token} ${o.chain} ext=${o.externalId || '-'} addr=${o.paymentAddress?.slice(0, 14)}...`);
  }
  // Also check recent webhook logs for UnlockRiver
  const hooks = await db.webhookLog.findMany({
    where: { merchantId: ur.id, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { event: true, createdAt: true, httpStatus: true, deliveredAt: true, response: true },
  });
  console.log(`\nWebhook logs in last 60 min: ${hooks.length}`);
  for (const h of hooks) {
    console.log(`  ${h.createdAt.toISOString()} ${h.event} status=${h.httpStatus} delivered=${!!h.deliveredAt} ${(h.response || '').substring(0, 80)}`);
  }
  await db.$disconnect();
})();
