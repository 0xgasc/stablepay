import { db } from '../src/config/database';
(async () => {
  // Pull last 5 OneTease webhooks, full detail
  const merchant = await db.merchant.findFirst({ where: { companyName: { contains: 'One Tease' } } });
  if (!merchant) process.exit(1);
  const recent = await db.webhookLog.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true, event: true, createdAt: true, deliveredAt: true, httpStatus: true,
      attempts: true, nextRetryAt: true, response: true,
    },
  });
  for (const w of recent) {
    console.log('---', w.id);
    console.log('  event:', w.event);
    console.log('  createdAt:', w.createdAt.toISOString());
    console.log('  deliveredAt:', w.deliveredAt?.toISOString() || 'null');
    console.log('  httpStatus:', w.httpStatus);
    console.log('  attempts:', w.attempts);
    console.log('  nextRetryAt:', w.nextRetryAt?.toISOString() || 'null');
    console.log('  response:', (w.response || '').substring(0, 200));
  }
  await db.$disconnect();
})();
