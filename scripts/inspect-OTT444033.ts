import { db } from '../src/config/database';
(async () => {
  const o = await db.order.findFirst({
    where: { id: { endsWith: 'pirne0bl' } },
    include: { transactions: true },
  });
  if (!o) { console.log('not found'); process.exit(1); }
  console.log('--- order', o.id);
  console.log(' ext:', o.externalId, 'status:', o.status);
  console.log(' chain:', o.chain, 'token:', o.token, 'amount:', o.amount.toString());
  console.log(' paymentAddress:', o.paymentAddress);
  console.log(' customerWallet:', o.customerWallet);
  console.log(' createdAt:', o.createdAt.toISOString(), 'updatedAt:', o.updatedAt.toISOString());
  console.log(' txs:', o.transactions.length);
  for (const t of o.transactions) {
    console.log('   ', t.txHash, t.status, t.amount.toString(), t.token, 'from=', t.fromAddress);
  }
  console.log('\nwebhooks for this order:');
  const hooks = await db.webhookLog.findMany({
    where: { merchantId: o.merchantId!, payload: { path: ['data', 'orderId'], equals: o.id } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { createdAt: true, event: true, httpStatus: true, deliveredAt: true, attempts: true, response: true },
  });
  for (const h of hooks) {
    console.log(' ', h.createdAt.toISOString(), h.event, 'status=' + h.httpStatus, h.deliveredAt ? 'OK' : 'FAIL', 'attempts=' + h.attempts);
    if (h.response) console.log('    resp:', (h.response || '').substring(0, 200));
  }
  await db.$disconnect();
})();
