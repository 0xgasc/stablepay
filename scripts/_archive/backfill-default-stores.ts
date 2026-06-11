/**
 * One-shot migration: create a "Default" store per merchant and back-fill
 * orders + payment links + webhook logs to point at it.
 *
 * Safe to re-run. On first run, copies merchant webhook config into the store so
 * existing customer integrations (which verify with the merchant's secret) continue
 * to work without any key-rollover coordination.
 *
 * Usage: npx tsx scripts/backfill-default-stores.ts
 */
import crypto from 'crypto';
import { db } from '../src/config/database';

async function main() {
  const merchants = await db.merchant.findMany({
    select: {
      id: true, companyName: true, website: true, webhookUrl: true, webhookSecret: true,
      webhookEnabled: true, webhookEvents: true, widgetConfig: true,
      successUrl: true, cancelUrl: true,
    },
  });
  console.log(`[backfill] Processing ${merchants.length} merchants`);

  let storesCreated = 0;
  let storesReused = 0;
  let ordersBackfilled = 0;
  let linksBackfilled = 0;

  for (const m of merchants) {
    // Upsert the default store. Idempotent: re-running won't create duplicates.
    const existing = await db.store.findFirst({
      where: { merchantId: m.id, slug: 'default' },
      select: { id: true },
    });

    let storeId: string;
    if (existing) {
      storeId = existing.id;
      storesReused++;
    } else {
      const widgetConfig = (m.widgetConfig as any) || {};
      const store = await db.store.create({
        data: {
          merchantId: m.id,
          slug: 'default',
          name: 'Default',
          displayName: widgetConfig.displayName || m.companyName,
          logoUrl: widgetConfig.logoUrl || null,
          headerColor: widgetConfig.headerColor || null,
          headerTextColor: widgetConfig.headerTextColor || null,
          website: m.website,
          backButtonText: widgetConfig.backButtonText || null,
          widgetConfig: m.widgetConfig as any,
          successUrl: m.successUrl,
          cancelUrl: m.cancelUrl,
          webhookUrl: m.webhookUrl,
          // Inherit merchant's current secret so downstream signature verification keeps working
          // without customer-side changes. If merchant had no secret yet, mint a fresh one.
          webhookSecret: m.webhookSecret || crypto.randomBytes(32).toString('hex'),
          webhookEnabled: m.webhookEnabled,
          webhookEvents: m.webhookEvents,
        },
      });
      storeId = store.id;
      storesCreated++;
    }

    // Back-fill orders for this merchant with null storeId
    const o = await db.$executeRaw`
      UPDATE orders SET "storeId" = ${storeId}
      WHERE "merchantId" = ${m.id} AND "storeId" IS NULL
    `;
    ordersBackfilled += Number(o);

    // Back-fill payment links
    const l = await db.$executeRaw`
      UPDATE payment_links SET "storeId" = ${storeId}
      WHERE "merchantId" = ${m.id} AND "storeId" IS NULL
    `;
    linksBackfilled += Number(l);
  }

  // Assert no merchant-bound orders remain without a store
  const orphans: any[] = await db.$queryRaw`
    SELECT COUNT(*)::int AS count FROM orders
    WHERE "merchantId" IS NOT NULL AND "storeId" IS NULL
  `;
  const orphanCount = orphans[0]?.count ?? 0;

  console.log(`[backfill] Stores created: ${storesCreated}, reused: ${storesReused}`);
  console.log(`[backfill] Orders back-filled: ${ordersBackfilled}`);
  console.log(`[backfill] Payment links back-filled: ${linksBackfilled}`);
  console.log(`[backfill] Orphan orders (merchantId set, storeId null): ${orphanCount}`);
  if (orphanCount > 0) {
    console.error('[backfill] ❌ Orphans remain — investigate before deploying');
    process.exit(1);
  }
  console.log('[backfill] ✅ Complete');
  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
