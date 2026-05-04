/**
 * One-shot: any merchant/store subscribed to `order.expired` was implicitly receiving
 * cancel notifications too (since the cancel endpoint used to fire `order.expired`).
 * After splitting them into distinct events, also subscribe them to `order.cancelled`
 * so they keep getting cancel notifications without having to update their config.
 *
 * Idempotent — safe to re-run.
 */
import { db } from '../src/config/database';

(async () => {
  const merchants = await db.merchant.findMany({
    where: { webhookEvents: { has: 'order.expired' }, NOT: { webhookEvents: { has: 'order.cancelled' } } },
    select: { id: true, companyName: true, webhookEvents: true },
  });
  console.log(`Merchants to update: ${merchants.length}`);
  for (const m of merchants) {
    await db.merchant.update({
      where: { id: m.id },
      data: { webhookEvents: [...m.webhookEvents, 'order.cancelled'] },
    });
    console.log('  +', m.companyName);
  }

  const stores = await db.store.findMany({
    where: { webhookEvents: { has: 'order.expired' }, NOT: { webhookEvents: { has: 'order.cancelled' } } },
    select: { id: true, name: true, merchantId: true, webhookEvents: true },
  });
  console.log(`\nStores to update: ${stores.length}`);
  for (const s of stores) {
    await db.store.update({
      where: { id: s.id },
      data: { webhookEvents: [...s.webhookEvents, 'order.cancelled'] },
    });
    console.log('  +', s.name);
  }

  await db.$disconnect();
})();
