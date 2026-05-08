import { db } from '../src/config/database';
(async () => {
  const m = await db.merchant.findFirst({
    where: { companyName: { contains: 'One Tease' } },
    select: { id: true, companyName: true, webhookUrl: true },
  });
  console.log('merchant webhook url:', m);
  const stores = await db.store.findMany({
    where: { merchantId: m?.id },
    select: { id: true, name: true, webhookUrl: true },
  });
  console.log('store webhook urls:');
  for (const s of stores) console.log(' ', s.name, '→', s.webhookUrl);
  await db.$disconnect();
})();
