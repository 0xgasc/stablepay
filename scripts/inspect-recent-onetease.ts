import { db } from '../src/config/database';
(async () => {
  const since = new Date(Date.now() - 30 * 60_000);
  const rows = await db.$queryRaw<any[]>`
    SELECT id, "externalId", chain, token, amount, status, "customerWallet", "paymentAddress", metadata, "createdAt", "updatedAt"
    FROM orders
    WHERE "merchantId" = 'cmnem8xia00008da9g8o13tp4' AND "createdAt" > ${since}
    ORDER BY "createdAt" ASC
  `;
  for (const o of rows) {
    console.log('---');
    console.log('id:', o.id, '  ext:', o.externalId || '(NULL)');
    console.log('chain:', o.chain, '  token:', o.token, '  amount:', Number(o.amount));
    console.log('status:', o.status, '  customerWallet:', o.customerWallet || '-');
    console.log('paymentAddress:', o.paymentAddress);
    console.log('metadata:', JSON.stringify(o.metadata));
    console.log('createdAt:', new Date(o.createdAt).toISOString());
  }
  await db.$disconnect();
})();
