import { db } from '../src/config/database';
(async () => {
  const count = await db.growthTask.count();
  console.log('GrowthTask count:', count);
  if (count > 0) {
    const sample = await db.growthTask.findMany({ take: 5, orderBy: { createdAt: 'desc' } });
    console.log('Sample:', sample);
  }
  await db.$disconnect();
})();
