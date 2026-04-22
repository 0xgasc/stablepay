// Trace what happened with UnlockRiver order cmo98v8tn... and the $159.99 USDT TX.
import { db } from '../src/config/database';

const UNLOCKRIVER = 'cmnom9tx00000nbb6e12ewrnh';
const TX_HASH = '0xf455d00c8bd424161ef6d92716b8e351030b710b81e38a126ebe3aeacafc2f43';

async function main() {
  // Find any transaction row for this hash
  const tx = await db.transaction.findUnique({ where: { txHash: TX_HASH } });
  console.log('=== TX ROW IN DB ===');
  console.log(tx ? JSON.stringify({ ...tx, amount: Number(tx.amount), blockNumber: tx.blockNumber?.toString() }, null, 2) : '(no row found — scanner never recorded this TX)');

  // Recent UnlockRiver ETH orders near the incident time
  console.log('\n=== UNLOCKRIVER ORDERS LAST 12h ===');
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const rows = await db.$queryRaw<any[]>`
    SELECT id, chain, token, amount, status, "paymentAddress", "customerWallet",
           "externalId", "createdAt", "updatedAt", metadata
    FROM orders
    WHERE "merchantId" = ${UNLOCKRIVER}
      AND "createdAt" > ${since}
    ORDER BY "createdAt" DESC
  `;
  for (const o of rows) {
    console.log(`\n${o.id} (${o.externalId || '-'})`);
    console.log(`  $${Number(o.amount)} ${o.token} on ${o.chain}`);
    console.log(`  status: ${o.status}`);
    console.log(`  paymentAddress: ${o.paymentAddress}`);
    console.log(`  customerWallet: ${o.customerWallet || '(not set)'}`);
    console.log(`  created: ${new Date(o.createdAt).toISOString()}`);
    console.log(`  updated: ${new Date(o.updatedAt).toISOString()}`);
    console.log(`  metadata: ${JSON.stringify(o.metadata)}`);
    const txs = await db.transaction.findMany({ where: { orderId: o.id } });
    if (txs.length === 0) console.log(`  ⚠  no transactions linked`);
    for (const t of txs) console.log(`  TX: ${t.txHash.slice(0,20)}... status=${t.status} confs=${t.confirmations}`);
  }

  // Also pull UnlockRiver ETH wallet
  const wallet = await db.merchantWallet.findFirst({
    where: { merchantId: UNLOCKRIVER, chain: 'ETHEREUM_MAINNET' },
  });
  console.log('\n=== UNLOCKRIVER ETH WALLET CONFIG ===');
  console.log(`address: ${wallet?.address}`);
  console.log(`tokens:  ${wallet?.supportedTokens?.join(', ')}`);
  console.log(`active:  ${wallet?.isActive}`);

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
