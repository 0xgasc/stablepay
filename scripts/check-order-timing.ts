// Trace the timing of an order: when detected on-chain vs when order flipped to CONFIRMED.
import { db } from '../src/config/database';

async function main() {
  // Most recent confirmed ETH order for One Tease — use raw SQL because the new storeId column
  // isn't migrated yet and Prisma's implicit select would try to read it.
  const rows = await db.$queryRaw<any[]>`
    SELECT id, "externalId", amount, token, "createdAt", "updatedAt"
    FROM orders
    WHERE "merchantId" = 'cmnem8xia00008da9g8o13tp4'
      AND chain = 'ETHEREUM_MAINNET'
      AND status = 'CONFIRMED'
    ORDER BY "updatedAt" DESC
    LIMIT 1
  `;
  if (rows.length === 0) { console.log('no confirmed ETH order'); return; }
  const order = {
    id: rows[0].id as string,
    externalId: rows[0].externalId as string | null,
    amount: rows[0].amount,
    token: rows[0].token as string,
    createdAt: new Date(rows[0].createdAt),
    updatedAt: new Date(rows[0].updatedAt),
    transactions: await db.transaction.findMany({
      where: { orderId: rows[0].id },
      orderBy: { createdAt: 'asc' },
    }),
  };

  console.log(`Order ${order.id} (${order.externalId})`);
  console.log(`  amount: $${Number(order.amount)} ${order.token}`);
  console.log(`  created:   ${order.createdAt.toISOString()}`);
  console.log(`  confirmed: ${order.updatedAt.toISOString()}`);
  console.log(`  time to confirm: ${Math.round((order.updatedAt.getTime() - order.createdAt.getTime()) / 1000)}s`);

  for (const tx of order.transactions) {
    console.log(`\nTX ${tx.txHash.slice(0, 20)}...`);
    console.log(`  status: ${tx.status}`);
    console.log(`  confirmations: ${tx.confirmations}`);
    console.log(`  blockNumber: ${tx.blockNumber}`);
    console.log(`  tx.created:    ${tx.createdAt.toISOString()} (scanner first saw it)`);
    console.log(`  tx.updated:    ${tx.updatedAt.toISOString()} (last confirmation update)`);
    console.log(`  blockTimestamp: ${tx.blockTimestamp?.toISOString()} (on-chain inclusion)`);

    if (tx.blockTimestamp && order.updatedAt) {
      const onchainToConfirmed = Math.round((order.updatedAt.getTime() - tx.blockTimestamp.getTime()) / 1000);
      console.log(`  ⏱  time from on-chain inclusion → order confirmed: ${onchainToConfirmed}s`);
    }
    if (tx.createdAt && order.updatedAt) {
      const detectedToConfirmed = Math.round((order.updatedAt.getTime() - tx.createdAt.getTime()) / 1000);
      console.log(`  ⏱  time from scanner-detected → order confirmed: ${detectedToConfirmed}s`);
    }
  }

  const { CHAIN_CONFIGS } = await import('../src/config/chains');
  const cfg = CHAIN_CONFIGS.ETHEREUM_MAINNET;
  console.log(`\nETH config: requiredConfirms=${cfg.requiredConfirms}, blockTimeSeconds=${cfg.blockTimeSeconds}`);
  console.log(`Expected finality: ${cfg.requiredConfirms * cfg.blockTimeSeconds}s = ${(cfg.requiredConfirms * cfg.blockTimeSeconds / 60).toFixed(1)}min`);

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
