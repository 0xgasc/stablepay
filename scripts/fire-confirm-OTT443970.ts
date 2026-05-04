import { db } from '../src/config/database';
import { webhookService } from '../src/services/webhookService';

(async () => {
  const o = await db.order.findFirst({ where: { id: { endsWith: '9wa681ib' } } });
  if (!o || !o.merchantId) { console.log('not found'); process.exit(1); }
  if (o.status !== 'CONFIRMED') {
    console.log('order not CONFIRMED, status =', o.status, '— aborting webhook fire');
    process.exit(1);
  }
  console.log('firing order.confirmed for', o.id, 'ext=', o.externalId);
  await webhookService.sendWebhook(
    o.merchantId,
    'order.confirmed',
    {
      orderId: o.id,
      externalId: o.externalId,
      amount: Number(o.amount),
      token: o.token,
      chain: o.chain,
      status: 'CONFIRMED',
      customerWallet: o.customerWallet,
      paymentAddress: o.paymentAddress,
      confirmedAt: o.updatedAt.toISOString(),
    },
    { storeId: o.storeId || undefined }
  );
  console.log('queued — sleeping 6s for delivery, then printing webhook log');
  await new Promise(r => setTimeout(r, 6000));
  const last = await db.webhookLog.findMany({
    where: { merchantId: o.merchantId, event: 'order.confirmed' },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { createdAt: true, httpStatus: true, deliveredAt: true, attempts: true, response: true, payload: true },
  });
  for (const w of last) {
    const p: any = w.payload;
    console.log(' ', w.createdAt.toISOString(), 'status=' + w.httpStatus, w.deliveredAt ? 'OK' : 'FAIL', 'orderId=' + (p?.data?.orderId || '').slice(-10), 'ext=' + (p?.data?.externalId || '-'));
    if (w.response) console.log('     resp:', (w.response || '').substring(0, 160));
  }
  await db.$disconnect();
})();
