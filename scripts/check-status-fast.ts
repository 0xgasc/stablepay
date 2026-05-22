import { db } from '../src/config/database';
(async () => {
  const ot = await db.merchant.findFirst({ where: { companyName: { contains: 'One Tease' } }, select: { id: true } });
  if (!ot) { console.log('not found'); process.exit(1); }
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const orders = await db.order.findMany({
    where: { merchantId: ot.id, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, amount: true, externalId: true, createdAt: true, chain: true },
  });
  const confirmed = orders.filter(o => o.status === 'CONFIRMED').length;
  const expired = orders.filter(o => o.status === 'EXPIRED').length;
  const cancelled = orders.filter(o => o.status === 'CANCELLED').length;
  const pending = orders.filter(o => o.status === 'PENDING').length;
  console.log(`OneTease — last 7d:`);
  console.log(`  Total orders:    ${orders.length}`);
  console.log(`  CONFIRMED:       ${confirmed}`);
  console.log(`  EXPIRED:         ${expired}`);
  console.log(`  CANCELLED:       ${cancelled}`);
  console.log(`  PENDING (live):  ${pending}`);
  console.log(`\nMost recent 5:`);
  for (const o of orders.slice(0, 5)) {
    console.log(`  ${o.createdAt.toISOString().slice(0, 19)}  ${o.status.padEnd(10)}  $${Number(o.amount)}  ${o.chain}  ext=${o.externalId || '-'}`);
  }
  await db.$disconnect();
})();
