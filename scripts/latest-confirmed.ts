import { db } from '../src/config/database';
(async () => {
  const recent = await db.order.findMany({
    where: { status: 'CONFIRMED' },
    orderBy: { updatedAt: 'desc' },
    take: 5,
    include: { merchant: { select: { companyName: true } } },
  });
  for (const o of recent) {
    console.log(o.updatedAt.toISOString(), '·', o.merchant?.companyName || '(no merchant)', '·', o.id.slice(-10), '·', `$${Number(o.amount)} ${o.token} on ${o.chain}`, '·', o.externalId ? `ext=${o.externalId}` : '');
  }
  await db.$disconnect();
})();
