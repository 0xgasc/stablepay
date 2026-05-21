import { db } from '../src/config/database';
(async () => {
  const merchant = await db.merchant.findFirst({
    where: { companyName: { contains: 'UnlockRiver' } },
    select: { id: true },
  });
  if (!merchant) { console.log('not found'); process.exit(1); }
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const orders = await db.order.findMany({
    where: { merchantId: merchant.id, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    include: { transactions: { select: { txHash: true, status: true, confirmations: true } } },
    take: 50,
  });
  console.log(`UnlockRiver orders last 14d (${orders.length}):`);
  console.log('  status      chain                amount  token  txs  id              created');
  for (const o of orders) {
    console.log(`  ${o.status.padEnd(11)} ${o.chain.padEnd(20)} $${String(Number(o.amount)).padEnd(6)} ${o.token.padEnd(5)} ${o.transactions.length.toString().padEnd(3)}  ${o.id.slice(-10)}  ${o.createdAt.toISOString().slice(0, 19)}`);
  }
  // Surface anything PENDING or EXPIRED with a tx record (= stuck case)
  const stuck = orders.filter(o => (o.status === 'PENDING' || o.status === 'EXPIRED') && o.transactions.length > 0);
  if (stuck.length > 0) {
    console.log(`\n⚠️  POTENTIALLY STUCK (PENDING/EXPIRED with tx):`);
    for (const s of stuck) {
      console.log('  ', s.id, s.status, s.chain, '$' + Number(s.amount), s.token, 'tx=' + s.transactions[0].txHash, 'confs=' + s.transactions[0].confirmations);
    }
  }
  await db.$disconnect();
})();
