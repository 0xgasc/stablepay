/**
 * Re-fire order.confirmed (and order.created) for One Tease orders whose webhooks never
 * delivered, using a FRESH timestamp + signature so their verify accepts them.
 *
 * Why a fresh fire instead of replay-merchant-webhooks.ts: the retry path re-uses the
 * ORIGINAL payload timestamp so the signature stays valid across attempts. After their
 * verify started enforcing freshness (5-min replay window), all our queued retries land
 * as "Timestamp too old". This script bypasses the queue and fires brand-new requests.
 */
import crypto from 'crypto';
import { db } from '../src/config/database';

const ONETEASE = 'cmnem8xia00008da9g8o13tp4';

async function main() {
  const merchant = await db.merchant.findUnique({
    where: { id: ONETEASE },
    select: { webhookUrl: true, webhookSecret: true },
  });
  if (!merchant?.webhookUrl || !merchant.webhookSecret) {
    console.error('merchant not configured'); process.exit(1);
  }

  // Find every CONFIRMED order whose order.confirmed webhook never delivered.
  const rows = await db.$queryRaw<any[]>`
    SELECT o.id, o."externalId", o.amount, o.token, o.chain, o."paymentAddress",
           o."customerEmail", o."customerWallet", o."paymentMethod", o.metadata,
           o."feePercent", o."feeAmount", o."updatedAt"
    FROM orders o
    WHERE o."merchantId" = ${ONETEASE}
      AND o.status = 'CONFIRMED'
      AND NOT EXISTS (
        SELECT 1 FROM webhook_logs w
        WHERE w."merchantId" = ${ONETEASE}
          AND w.event = 'order.confirmed'
          AND w."deliveredAt" IS NOT NULL
          AND (w.payload->'data'->>'orderId') = o.id
      )
    ORDER BY o."updatedAt" ASC
  `;
  console.log(`Found ${rows.length} confirmed One Tease orders with no delivered order.confirmed webhook`);

  const explorerUrls: Record<string, string> = {
    BASE_MAINNET: 'https://basescan.org/tx/',
    ETHEREUM_MAINNET: 'https://etherscan.io/tx/',
    POLYGON_MAINNET: 'https://polygonscan.com/tx/',
    ARBITRUM_MAINNET: 'https://arbiscan.io/tx/',
    BNB_MAINNET: 'https://bscscan.com/tx/',
    SOLANA_MAINNET: 'https://solscan.io/tx/',
  };

  for (const o of rows) {
    // Find the canonical confirmed TX for this order
    const tx = await db.transaction.findFirst({
      where: { orderId: o.id, status: 'CONFIRMED' },
      orderBy: { blockTimestamp: 'desc' },
      select: { txHash: true, blockTimestamp: true },
    });
    const orderAmount = Number(o.amount);
    const feePercent = Number(o.feePercent ?? 0);
    const feeAmount = Number(o.feeAmount ?? 0);

    const ts = new Date().toISOString();
    const payload = {
      event: 'order.confirmed',
      timestamp: ts,
      data: {
        orderId: o.id,
        externalId: o.externalId || null,
        amount: orderAmount,
        token: o.token,
        chain: o.chain,
        status: 'CONFIRMED',
        txHash: tx?.txHash || null,
        explorerLink: tx?.txHash && explorerUrls[o.chain] ? explorerUrls[o.chain] + tx.txHash : null,
        customerEmail: o.customerEmail || null,
        customerWallet: o.customerWallet || null,
        paymentAddress: o.paymentAddress,
        paymentMethod: o.paymentMethod || null,
        feePercent,
        feeAmount,
        netAmount: orderAmount - feeAmount,
        metadata: o.metadata || null,
        confirmedAt: o.updatedAt.toISOString(),
        _refiredAt: ts,
      },
    };
    const body = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', merchant.webhookSecret!).update(`${ts}.${body}`).digest('hex');
    const idempotencyKey = `refire-${o.id}-${Date.now()}`;

    const t0 = Date.now();
    let status: number | null = null;
    let respText = '';
    try {
      const r = await fetch(merchant.webhookUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-StablePay-Signature': sig,
          'X-StablePay-Timestamp': ts,
          'X-StablePay-Idempotency-Key': idempotencyKey,
        },
        body,
        signal: AbortSignal.timeout(15000),
      });
      status = r.status;
      respText = await r.text().then(t => t.slice(0, 120)).catch(() => '');
    } catch (e: any) {
      respText = String(e?.message || e).slice(0, 120);
    }
    const ms = Date.now() - t0;
    const tag = status === 200 || status === 201 || status === 204 ? '✓' : '✗';
    console.log(`${tag} ${o.id.slice(-10)} ext=${o.externalId || '-'} $${orderAmount} ${o.token} ${o.chain} → ${status ?? 'no-resp'} (${ms}ms) ${respText}`);

    // Persist a webhook_log row marked delivered so we don't refire twice and the merchant
    // dashboard shows accurate history.
    if (status && status >= 200 && status < 300) {
      await db.webhookLog.create({
        data: {
          merchantId: ONETEASE,
          event: 'order.confirmed',
          payload: payload as any,
          url: merchant.webhookUrl!,
          httpStatus: status,
          response: respText,
          attempts: 1,
          deliveredAt: new Date(),
        },
      });
    }
  }

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
