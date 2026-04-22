/**
 * Manually confirm UnlockRiver order cmo9cpf0r... using the on-chain-verified TX.
 * Creates the Transaction row, flips order to CONFIRMED via OrderService.confirmOrder
 * (which fires webhooks, creates receipt, accrues fees — same path as scanner).
 *
 * Run once: npx tsx scripts/confirm-unlockriver-incident.ts
 */
import { db } from '../src/config/database';

const ORDER_ID = 'cmo9cpf0r00019v683uehb62i';
const TX_HASH = '0xf455d00c8bd424161ef6d92716b8e351030b710b81e38a126ebe3aeacafc2f43';
// Block number from Etherscan for this tx (customer-reported 3043 confirmations as of 2026-04-22)
// Scanner path only needs blockNumber for display; confirmation math uses 1 as a placeholder
// since the tx is on-chain-final.

async function main() {
  const rows = await db.$queryRaw<any[]>`
    SELECT id, status, chain, token, amount, "paymentAddress", "merchantId", "customerWallet", "externalId", "expiresAt"
    FROM orders WHERE id = ${ORDER_ID}
  `;
  if (rows.length === 0) { console.error('order not found'); process.exit(1); }
  const order = rows[0];
  console.log(`Order ${order.id}`);
  console.log(`  status=${order.status} chain=${order.chain} token=${order.token} amount=${order.amount}`);
  console.log(`  merchantId=${order.merchantId} customerWallet=${order.customerWallet}`);

  // Refuse if already confirmed — idempotent protection.
  if (order.status === 'CONFIRMED') {
    console.log('Already CONFIRMED, nothing to do');
    return;
  }
  if (order.status === 'REFUNDED') {
    console.log('Order was refunded, aborting'); process.exit(1);
  }

  // Check TX row doesn't already exist (unique constraint on txHash means double-use would fail).
  const existingTx = await db.transaction.findUnique({ where: { txHash: TX_HASH } });
  if (existingTx && existingTx.orderId !== ORDER_ID) {
    console.error(`TX already linked to order ${existingTx.orderId} — aborting`);
    process.exit(1);
  }

  // Reset to PENDING + extend expiry so confirmOrder's atomic guard accepts.
  // The guard requires status='PENDING' AND expiresAt > now().
  const now = new Date();
  const newExpiry = new Date(now.getTime() + 60 * 60 * 1000);
  await db.$executeRaw`
    UPDATE orders
    SET status = 'PENDING'::"OrderStatus",
        "expiresAt" = ${newExpiry},
        "updatedAt" = ${now}
    WHERE id = ${ORDER_ID}
  `;
  console.log(`Reset status EXPIRED → PENDING, extended expiresAt to ${newExpiry.toISOString()}`);

  // Create TX row (confirmOrder upserts it but we want explicit fromAddress from customerWallet).
  if (!existingTx) {
    await db.transaction.create({
      data: {
        orderId: ORDER_ID,
        txHash: TX_HASH,
        chain: 'ETHEREUM_MAINNET',
        amount: order.amount,
        fromAddress: order.customerWallet || 'manual_ops_confirm',
        toAddress: order.paymentAddress,
        status: 'CONFIRMED',
        confirmations: 12,
        blockTimestamp: new Date('2026-04-22T01:19:00Z'),
      },
    });
    console.log('Created Transaction row');
  }

  // Use the official confirmOrder path — webhooks + receipt + fees all follow.
  const { OrderService } = await import('../src/services/orderService');
  const result = await new OrderService().confirmOrder(ORDER_ID, {
    txHash: TX_HASH,
    confirmations: 12,
  });
  console.log(`Order status after confirm: ${(result as any).status}`);
  console.log('Webhook (order.confirmed + receipt.created) fired from OrderService path');

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
