// One-off: credit order cmq7b4h9l000y9y23dxnreeug — customer sent 4.90 USDT (tx below) against a
// 4.99 USDT order on 2026-06-10. Exchange fee was deducted from the amount (1.8% short, outside
// the 1% tolerance), order expired, funds sat at the merchant's wallet uncredited. Confirms via
// the late-payment grace path and records the shortfall (absorbed by StablePay).
import { db } from '../src/config/database';
import { OrderService } from '../src/services/orderService';

const ORDER_ID = 'cmq7b4h9l000y9y23dxnreeug';
const TX_HASH = '5KQsbUnEDAZJiqv7qYtp4npCNecu13VXhAaMSsJUQhBpaaJoo9a47bW3SeG4ftW9zCqrgp9eiHokpc7vKbPcxgj3';

(async () => {
  const os = new OrderService();
  const result = await os.confirmOrder(ORDER_ID, { txHash: TX_HASH, confirmations: 1 });
  console.log('status:', result.status, 'staleSkipped:', (result as any)._staleSkipped || false);

  const existing = await db.order.findUnique({ where: { id: ORDER_ID }, select: { metadata: true, status: true } });
  const meta = (existing?.metadata as Record<string, unknown>) || {};
  await db.order.update({
    where: { id: ORDER_ID },
    data: {
      metadata: {
        ...meta,
        underpaid: {
          expected: 4.99, received: 4.9, shortfall: 0.09,
          coveredBy: 'stablepay', reason: 'exchange fee deducted from amount',
          txHash: TX_HASH, creditedAt: new Date().toISOString(),
        },
      },
    },
  });
  console.log('final status:', existing?.status, '→ metadata.underpaid written');
  await db.$disconnect();
})();
