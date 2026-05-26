import { db } from '../src/config/database';
(async () => {
  const merchants = await db.merchant.findMany({
    select: { companyName: true, plan: true, customFeePercent: true, isDayOne: true, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`Total: ${merchants.length}`);
  const byPlan: Record<string, number> = {};
  for (const m of merchants) byPlan[m.plan] = (byPlan[m.plan] || 0) + 1;
  console.log('By plan:', byPlan);
  console.log('\nWith special pricing:');
  for (const m of merchants) {
    if (m.customFeePercent || m.isDayOne) {
      console.log(`  ${m.companyName}: plan=${m.plan} custom=${m.customFeePercent || '-'}% dayOne=${m.isDayOne}`);
    }
  }
  await db.$disconnect();
})();
