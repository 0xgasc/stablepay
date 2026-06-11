// Mark the test merchant's dead-URL webhooks as max-retried so they stop polluting the retry queue.
import { db } from '../src/config/database';

async function main() {
  // Find the test merchant by its dead webhook URL
  const testMerchant = await db.merchant.findFirst({
    where: { webhookUrl: 'https://s-o-l-o.fun/api/webhooks/stablepay' },
    select: { id: true, companyName: true },
  });
  if (!testMerchant) {
    console.log('Test merchant not found');
    return;
  }
  console.log(`Found: ${testMerchant.companyName} (${testMerchant.id})`);

  const before = await db.webhookLog.count({
    where: { merchantId: testMerchant.id, deliveredAt: null, nextRetryAt: { not: null } },
  });
  console.log(`Stuck webhooks before: ${before}`);

  // Mark as max-attempts so processRetries skips them forever
  const result = await db.webhookLog.updateMany({
    where: { merchantId: testMerchant.id, deliveredAt: null },
    data: { nextRetryAt: null, attempts: 5 },
  });
  console.log(`Abandoned ${result.count} webhook deliveries`);

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
