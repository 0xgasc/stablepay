import { db } from '../src/config/database';

async function main() {
  const log = await db.webhookLog.findFirst({
    where: {
      merchantId: 'cmnem8xia00008da9g8o13tp4',
      event: 'order.confirmed',
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!log) { console.log('no log'); return; }
  console.log('URL:', log.url);
  console.log('Event:', log.event);
  console.log('Sent at:', log.createdAt.toISOString());
  console.log('HTTP response status:', log.httpStatus);
  console.log('Response body:', log.response);
  console.log('\n=== FULL JSON PAYLOAD ===');
  console.log(JSON.stringify(log.payload, null, 2));
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
