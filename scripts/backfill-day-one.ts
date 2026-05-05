/**
 * One-shot: every merchant currently in the system was onboarded under earlier,
 * lower-rate marketing copy that promised ~1% to the smallest merchants. We're
 * shipping a higher public rate (2.0% → 1.0% sliding) for new signups going
 * forward; existing merchants get grandfathered into the "Day 1" program — flat
 * 1% regardless of volume — so nobody's effective rate goes UP from this change.
 *
 * Idempotent — safe to re-run.
 */
import { db } from '../src/config/database';

(async () => {
  const merchants = await db.merchant.findMany({
    where: { isDayOne: false },
    select: { id: true, companyName: true, email: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Merchants to flag as Day 1: ${merchants.length}`);
  for (const m of merchants) {
    await db.merchant.update({ where: { id: m.id }, data: { isDayOne: true } });
    console.log('  ✓', m.companyName, '—', m.email, '(joined', m.createdAt.toISOString().slice(0, 10) + ')');
  }
  await db.$disconnect();
})();
