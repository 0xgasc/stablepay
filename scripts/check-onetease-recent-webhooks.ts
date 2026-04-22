// Last 24h of webhook deliveries to One Tease — did their verify fix land?
import { db } from '../src/config/database';

async function main() {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const logs = await db.webhookLog.findMany({
    where: { merchantId: 'cmnem8xia00008da9g8o13tp4', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, event: true, httpStatus: true, attempts: true,
      deliveredAt: true, createdAt: true, response: true, payload: true,
    },
  });
  console.log(`=== ${logs.length} deliveries in last 48h ===`);
  for (const l of logs) {
    const orderId = (l.payload as any)?.data?.orderId || '';
    console.log(`[${l.createdAt.toISOString()}] ${l.event.padEnd(18)} status=${l.httpStatus ?? 'no-resp'} attempts=${l.attempts} delivered=${l.deliveredAt ? 'yes' : 'NO '} orderId=${orderId.slice(-10)}`);
    if (l.response && l.httpStatus && l.httpStatus >= 400) {
      console.log(`  response: ${(l.response || '').substring(0, 200).replace(/\n/g, ' ')}`);
    }
  }
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
