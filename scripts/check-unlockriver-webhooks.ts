import { db } from '../src/config/database';

const UNLOCKRIVER = 'cmnom9tx00000nbb6e12ewrnh';

async function main() {
  // Stuck ones
  const stuck = await db.webhookLog.findMany({
    where: { merchantId: UNLOCKRIVER, deliveredAt: null, nextRetryAt: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, event: true, httpStatus: true, response: true,
      attempts: true, createdAt: true, nextRetryAt: true, payload: true,
    },
  });

  console.log(`=== ${stuck.length} STUCK WEBHOOKS ===`);
  for (const s of stuck) {
    console.log(`\n[${s.createdAt.toISOString()}] ${s.event}`);
    console.log(`  status=${s.httpStatus ?? 'no-response'}  attempts=${s.attempts}`);
    console.log(`  response: ${(s.response || '').substring(0, 400).replace(/\n/g, ' ')}`);
    const p: any = s.payload;
    if (p?.data?.orderId) console.log(`  orderId=${p.data.orderId}  amount=${p.data.amount}`);
  }

  // Recent successful deliveries — are they actually receiving anything?
  const recent = await db.webhookLog.findMany({
    where: { merchantId: UNLOCKRIVER, deliveredAt: { not: null } },
    orderBy: { deliveredAt: 'desc' },
    take: 5,
    select: {
      id: true, event: true, httpStatus: true,
      deliveredAt: true, createdAt: true, attempts: true,
    },
  });
  console.log(`\n=== 5 MOST RECENT SUCCESSFUL DELIVERIES ===`);
  for (const r of recent) {
    console.log(`${r.deliveredAt?.toISOString()} — ${r.event} (status=${r.httpStatus}, attempts=${r.attempts})`);
  }

  // Counts
  const total = await db.webhookLog.count({ where: { merchantId: UNLOCKRIVER } });
  const delivered = await db.webhookLog.count({ where: { merchantId: UNLOCKRIVER, deliveredAt: { not: null } } });
  console.log(`\nOverall: ${delivered}/${total} delivered`);

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
