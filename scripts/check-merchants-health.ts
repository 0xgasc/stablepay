import { db } from '../src/config/database';
(async () => {
  const merchants = await db.merchant.findMany({
    where: { OR: [{ companyName: { contains: 'One Tease' } }, { companyName: { contains: 'UnlockRiver' } }] },
    select: { id: true, companyName: true, webhookUrl: true, webhookEnabled: true, webhookEvents: true, webhookLastFailure: true, isDayOne: true, monthlyVolumeUsed: true },
  });
  const sinceHrs = 48;
  const since = new Date(Date.now() - sinceHrs * 60 * 60 * 1000);

  for (const m of merchants) {
    console.log('\n========', m.companyName, '(' + m.id.slice(-8) + ') ========');
    console.log('  webhookUrl:', m.webhookUrl);
    console.log('  enabled:', m.webhookEnabled, '| events:', m.webhookEvents);
    console.log('  lastFailure:', m.webhookLastFailure?.toISOString() || 'never');
    console.log('  isDayOne:', m.isDayOne, '| monthlyVolume: $' + Number(m.monthlyVolumeUsed).toFixed(2));

    const recentOrders = await db.order.findMany({
      where: { merchantId: m.id, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, externalId: true, status: true, amount: true, chain: true, token: true, createdAt: true },
    });
    console.log(`\n  Orders last ${sinceHrs}h (${recentOrders.length}):`);
    for (const o of recentOrders) {
      console.log(`    ${o.createdAt.toISOString().slice(11, 19)}  ${o.id.slice(-10)}  ext=${o.externalId || '-'}  ${o.status.padEnd(10)} $${Number(o.amount)} ${o.token} ${o.chain}`);
    }

    const recentWebhooks = await db.webhookLog.findMany({
      where: { merchantId: m.id, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { event: true, httpStatus: true, deliveredAt: true, attempts: true, response: true, createdAt: true },
    });
    const delivered = recentWebhooks.filter(w => w.deliveredAt).length;
    const failed = recentWebhooks.filter(w => !w.deliveredAt).length;
    console.log(`\n  Webhooks last ${sinceHrs}h (${recentWebhooks.length}): ${delivered} OK, ${failed} pending/failed`);
    for (const w of recentWebhooks.slice(0, 10)) {
      const status = w.deliveredAt ? `✓${w.httpStatus}` : `✗${w.httpStatus || '-'}/${w.attempts}attempts`;
      const resp = (w.response || '').substring(0, 90).replace(/\n/g, ' ');
      console.log(`    ${w.createdAt.toISOString().slice(11, 19)}  ${w.event.padEnd(20)} ${status.padEnd(15)} ${resp}`);
    }

    const alerts = await db.merchantAlert.findMany({
      where: { merchantId: m.id, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { alertClass: true, affectedCount: true, resolved: true, createdAt: true },
    });
    if (alerts.length > 0) {
      console.log(`\n  Alerts sent last ${sinceHrs}h:`);
      for (const a of alerts) {
        console.log(`    ${a.createdAt.toISOString().slice(11, 19)}  ${a.alertClass}  affected=${a.affectedCount}  resolved=${a.resolved}`);
      }
    }
  }
  await db.$disconnect();
})();
