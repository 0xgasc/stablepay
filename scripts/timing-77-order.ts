import { db } from '../src/config/database';
(async () => {
  const orders = await db.order.findMany({
    where: { id: { in: ['cmpfiagvm000910ds2q6ug41p', 'cmpfia0vt000510ds92g4urb9', 'cmpfi7zlj000110dsc7nchx2o'] } },
    include: { transactions: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const o of orders) {
    console.log('\n---', o.id, '---');
    console.log('  status:', o.status);
    console.log('  amount:', Number(o.amount), o.token);
    console.log('  createdAt:', o.createdAt.toISOString());
    console.log('  updatedAt:', o.updatedAt.toISOString());
    console.log('  delta create→update:', Math.round((o.updatedAt.getTime() - o.createdAt.getTime()) / 1000) + 's');
    for (const t of o.transactions) {
      console.log('  TX:');
      console.log('    hash:', t.txHash);
      console.log('    blockNumber:', String(t.blockNumber));
      console.log('    blockTimestamp:', t.blockTimestamp?.toISOString(), '← when tx actually mined');
      console.log('    confs at record:', t.confirmations);
      console.log('    detected (createdAt):', t.createdAt.toISOString());
      console.log('    delta block→detect:', Math.round((t.createdAt.getTime() - (t.blockTimestamp?.getTime() || 0)) / 1000) + 's');
      console.log('    delta detect→order-confirm:', Math.round((o.updatedAt.getTime() - t.createdAt.getTime()) / 1000) + 's');
    }
  }
  await db.$disconnect();
})();
