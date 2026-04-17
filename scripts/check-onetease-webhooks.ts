// One-off diagnostic: inspect One Tease's webhook config + last 10 delivery attempts.
// Run: npx tsx scripts/check-onetease-webhooks.ts
import { db } from '../src/config/database';

const ONETEASE = 'cmnem8xia00008da9g8o13tp4';

async function main() {
  const m = await db.merchant.findUnique({
    where: { id: ONETEASE },
    select: {
      companyName: true,
      email: true,
      webhookUrl: true,
      webhookEnabled: true,
      webhookEvents: true,
      webhookSecret: true,
      webhookLastSuccess: true,
      webhookLastFailure: true,
    },
  });
  console.log('\n=== MERCHANT CONFIG ===');
  console.log(JSON.stringify({
    ...m,
    webhookSecret: m?.webhookSecret ? `<${m.webhookSecret.length} chars>` : null,
  }, null, 2));

  const orders = await db.order.groupBy({
    by: ['status'],
    where: { merchantId: ONETEASE },
    _count: { _all: true },
  });
  console.log('\n=== ORDER STATUS COUNTS ===');
  console.log(JSON.stringify(orders, null, 2));

  const logs = await db.webhookLog.findMany({
    where: { merchantId: ONETEASE },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: {
      id: true,
      event: true,
      url: true,
      httpStatus: true,
      response: true,
      attempts: true,
      nextRetryAt: true,
      deliveredAt: true,
      createdAt: true,
      payload: true,
    },
  });
  console.log('\n=== LAST 15 WEBHOOK DELIVERY ATTEMPTS ===');
  for (const l of logs) {
    console.log(`\n[${l.createdAt.toISOString()}] ${l.event}`);
    console.log(`  url=${l.url}`);
    console.log(`  status=${l.httpStatus ?? 'no-response'} attempts=${l.attempts} delivered=${l.deliveredAt ? 'yes@' + l.deliveredAt.toISOString() : 'NO'}`);
    if (l.nextRetryAt) console.log(`  nextRetry=${l.nextRetryAt.toISOString()}`);
    if (l.response) console.log(`  response=${(l.response || '').substring(0, 300).replace(/\n/g, ' ')}`);
    const p: any = l.payload;
    if (p?.data?.orderId) console.log(`  orderId=${p.data.orderId} amount=${p.data.amount} txHash=${p.data.txHash ?? ''}`);
  }

  const confirmedOrders = await db.order.findMany({
    where: { merchantId: ONETEASE, status: 'CONFIRMED' },
    orderBy: { updatedAt: 'desc' },
    take: 5,
    select: { id: true, amount: true, chain: true, token: true, createdAt: true, updatedAt: true, externalId: true },
  });
  console.log('\n=== LAST 5 CONFIRMED ORDERS ===');
  for (const o of confirmedOrders) {
    console.log(`  ${o.id} — $${Number(o.amount)} ${o.token} on ${o.chain} ext=${o.externalId || '-'} confirmedAt=${o.updatedAt.toISOString()}`);
  }

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
