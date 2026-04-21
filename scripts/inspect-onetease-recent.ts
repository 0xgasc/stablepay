// Detailed trace of the last N One Tease orders: chain, transactions, webhooks, timings.
import { db } from '../src/config/database';

async function main() {
  const N = Number(process.argv[2] || 8);
  const rows = await db.$queryRaw<any[]>`
    SELECT id, chain, token, amount, status, "externalId", "customerWallet",
           "paymentAddress", "createdAt", "updatedAt", metadata, "storeId"
    FROM orders
    WHERE "merchantId" = 'cmnem8xia00008da9g8o13tp4'
    ORDER BY "createdAt" DESC
    LIMIT ${N}
  `;

  for (const o of rows) {
    console.log(`\n=== ${o.id} (${o.externalId || '-'}) ===`);
    console.log(`  amount: $${Number(o.amount)} ${o.token}`);
    console.log(`  chain:  ${o.chain}`);
    console.log(`  status: ${o.status}`);
    console.log(`  paymentAddress: ${o.paymentAddress}`);
    console.log(`  customerWallet: ${o.customerWallet || '(not set)'}`);
    console.log(`  storeId: ${o.storeId || '(none)'}`);
    console.log(`  created:  ${new Date(o.createdAt).toISOString()}`);
    console.log(`  updated:  ${new Date(o.updatedAt).toISOString()}`);
    if (o.metadata) console.log(`  metadata: ${JSON.stringify(o.metadata)}`);

    const txs = await db.transaction.findMany({
      where: { orderId: o.id },
      orderBy: { createdAt: 'asc' },
      select: { txHash: true, chain: true, amount: true, status: true, confirmations: true, fromAddress: true, toAddress: true, blockTimestamp: true, blockNumber: true, createdAt: true },
    });
    if (txs.length === 0) {
      console.log(`  ⚠  NO TRANSACTIONS FOUND`);
    } else {
      for (const t of txs) {
        console.log(`  TX ${t.txHash.slice(0, 20)}...`);
        console.log(`     chain=${t.chain} amt=${Number(t.amount)} status=${t.status} confs=${t.confirmations} block=${t.blockNumber}`);
        console.log(`     from=${t.fromAddress.slice(0, 10)}... to=${t.toAddress.slice(0, 10)}...`);
        console.log(`     detected=${t.createdAt.toISOString()} blockTs=${t.blockTimestamp?.toISOString() || 'null'}`);
      }
    }

    const hooks = await db.webhookLog.findMany({
      where: { merchantId: 'cmnem8xia00008da9g8o13tp4', payload: { path: ['data', 'orderId'], equals: o.id } },
      orderBy: { createdAt: 'asc' },
      select: { event: true, httpStatus: true, attempts: true, deliveredAt: true, createdAt: true },
    });
    for (const h of hooks) {
      console.log(`  WH ${h.event} @ ${h.createdAt.toISOString()} status=${h.httpStatus} attempts=${h.attempts} delivered=${h.deliveredAt ? 'yes' : 'NO'}`);
    }
  }
  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
