import { db } from '../src/config/database';
(async () => {
  const merchant = await db.merchant.findFirst({
    where: { companyName: { contains: 'UnlockRiver' } },
    select: { id: true, companyName: true },
  });
  if (!merchant) { console.log('not found'); process.exit(1); }
  // BNB orders in the last 7 days, regardless of status
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const orders = await db.order.findMany({
    where: { merchantId: merchant.id, chain: 'BNB_MAINNET' as any, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    include: { transactions: true },
  });
  console.log(`UnlockRiver BNB orders last 7d (${orders.length}):`);
  for (const o of orders) {
    console.log('\n  ----', o.id, '----');
    console.log('    status:', o.status);
    console.log('    amount:', Number(o.amount), o.token);
    console.log('    paymentAddress:', o.paymentAddress);
    console.log('    customerWallet:', o.customerWallet);
    console.log('    externalId:', o.externalId);
    console.log('    createdAt:', o.createdAt.toISOString());
    console.log('    expiresAt:', o.expiresAt.toISOString());
    console.log('    transactions:', o.transactions.length);
    for (const t of o.transactions) {
      console.log('      tx:', t.txHash, 'status=' + t.status, 'confirmations=' + t.confirmations, 'amount=' + Number(t.amount), 'from=' + t.fromAddress);
    }
  }
  await db.$disconnect();
})();
