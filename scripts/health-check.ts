// Pulse check: verify web API, scanner, and DB are all live.
import { db } from '../src/config/database';

async function main() {
  const now = new Date();
  const mins = (d: Date) => Math.round((now.getTime() - d.getTime()) / 60000);

  // DB reachable = this whole script runs
  console.log('DB: reachable');

  // Web API live = recent webhook attempts (every order.created fires one = means /api/embed/checkout is serving)
  const latestLog = await db.webhookLog.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, event: true, httpStatus: true },
  });
  if (latestLog) {
    console.log(`Web API: last webhook attempt ${mins(latestLog.createdAt)} min ago (${latestLog.event}, http=${latestLog.httpStatus ?? 'no-response'})`);
  } else {
    console.log('Web API: no webhook logs ever');
  }

  // Scanner live = recent order status flip (PENDING → CONFIRMED or PENDING → EXPIRED)
  const latestConfirmed = await db.order.findFirst({
    where: { status: 'CONFIRMED' },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true, id: true, chain: true },
  });
  if (latestConfirmed) {
    console.log(`Scanner confirms: last ${mins(latestConfirmed.updatedAt)} min ago (${latestConfirmed.chain}, ${latestConfirmed.id})`);
  } else {
    console.log('Scanner: no confirmed orders ever');
  }

  const latestExpired = await db.order.findFirst({
    where: { status: 'EXPIRED' },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  });
  if (latestExpired) {
    console.log(`Scanner expiry sweep: last ${mins(latestExpired.updatedAt)} min ago`);
  }

  // Pending orders right now
  const pendingCount = await db.order.count({ where: { status: 'PENDING', expiresAt: { gt: now } } });
  console.log(`Pending orders (not yet expired): ${pendingCount}`);

  // Merchants live
  const merchantCount = await db.merchant.count({ where: { isActive: true } });
  console.log(`Active merchants: ${merchantCount}`);

  // Stuck webhooks (in retry queue, not abandoned)
  const stuckWebhooks = await db.webhookLog.count({
    where: { deliveredAt: null, nextRetryAt: { not: null } },
  });
  console.log(`Webhooks in retry queue: ${stuckWebhooks}`);

  // Webhooks abandoned (reached max retries, still undelivered)
  const abandonedWebhooks = await db.webhookLog.count({
    where: { deliveredAt: null, nextRetryAt: null, attempts: { gte: 5 } },
  });
  console.log(`Webhooks abandoned (≥5 fails): ${abandonedWebhooks}`);

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
