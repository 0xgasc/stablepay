import { db } from '../src/config/database';

async function main() {
  const now = new Date();

  // Retry queue broken down by merchant
  const byMerchant = await db.webhookLog.groupBy({
    by: ['merchantId'],
    where: { deliveredAt: null, nextRetryAt: { not: null } },
    _count: { _all: true },
  });
  const merchants = await db.merchant.findMany({
    where: { id: { in: byMerchant.map(b => b.merchantId) } },
    select: { id: true, companyName: true, webhookUrl: true, webhookLastFailure: true },
  });
  console.log('=== RETRY QUEUE BY MERCHANT ===');
  for (const b of byMerchant) {
    const m = merchants.find(mm => mm.id === b.merchantId);
    console.log(`${m?.companyName ?? b.merchantId}: ${b._count._all} stuck  |  url=${m?.webhookUrl ?? '—'}  |  lastFail=${m?.webhookLastFailure?.toISOString() ?? 'never'}`);
  }

  // Retry queue: next scheduled retries
  const overdue = await db.webhookLog.count({
    where: { deliveredAt: null, nextRetryAt: { lte: now, not: null } },
  });
  const future = await db.webhookLog.count({
    where: { deliveredAt: null, nextRetryAt: { gt: now } },
  });
  console.log(`\nOverdue retries (should already have fired): ${overdue}`);
  console.log(`Future-scheduled retries: ${future}`);

  // Oldest & newest entries in queue
  const oldest = await db.webhookLog.findFirst({
    where: { deliveredAt: null, nextRetryAt: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, attempts: true, httpStatus: true },
  });
  const newest = await db.webhookLog.findFirst({
    where: { deliveredAt: null, nextRetryAt: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, attempts: true, httpStatus: true },
  });
  console.log(`\nOldest stuck: ${oldest?.createdAt.toISOString()} (attempts=${oldest?.attempts}, status=${oldest?.httpStatus})`);
  console.log(`Newest stuck: ${newest?.createdAt.toISOString()} (attempts=${newest?.attempts}, status=${newest?.httpStatus})`);

  // Check vercel.json for cron config
  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
