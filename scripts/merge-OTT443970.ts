import { db } from '../src/config/database';
import { webhookService } from '../src/services/webhookService';

(async () => {
  const placeholder = await db.order.findFirst({ where: { id: { endsWith: '9wa681ib' } } });
  const real = await db.order.findFirst({ where: { id: { endsWith: 'hgznv2z2' } } });
  if (!placeholder || !real) {
    console.log('missing', { placeholder: !!placeholder, real: !!real });
    process.exit(1);
  }
  if (placeholder.merchantId !== real.merchantId) {
    console.log('merchant mismatch — abort');
    process.exit(1);
  }

  console.log('Merging:');
  console.log('  placeholder', placeholder.id, placeholder.externalId, placeholder.status);
  console.log('  real      ', real.id, real.externalId, real.status, real.chain, real.token);

  const updated = await db.order.update({
    where: { id: placeholder.id },
    data: {
      chain: real.chain,
      token: real.token,
      paymentAddress: real.paymentAddress,
      customerWallet: real.customerWallet,
      paymentMethod: real.paymentMethod,
      status: 'CONFIRMED',
      metadata: {
        ...(placeholder.metadata as any || {}),
        _mergedFrom: real.id,
        _mergedAt: new Date().toISOString(),
        _mergeReason: 'frontend created duplicate Solana order without externalId; merging into placeholder so merchant sees confirmation against their OTT443970',
      },
    },
  });

  await db.order.update({
    where: { id: real.id },
    data: {
      status: 'CANCELLED',
      metadata: {
        _mergedInto: placeholder.id,
        _mergedAt: new Date().toISOString(),
        _mergeReason: 'duplicate of placeholder for OTT443970',
      },
    },
  });

  await db.transaction.updateMany({
    where: { orderId: real.id },
    data: { orderId: updated.id },
  });

  console.log('updated placeholder →', updated.status, updated.chain, updated.token);

  if (!placeholder.merchantId) {
    console.log('no merchant id, skipping webhook');
    await db.$disconnect();
    return;
  }
  await webhookService.sendWebhook(
    placeholder.merchantId,
    'order.confirmed',
    {
      orderId: updated.id,
      externalId: updated.externalId,
      amount: Number(updated.amount),
      token: updated.token,
      chain: updated.chain,
      status: 'CONFIRMED',
      customerWallet: updated.customerWallet,
      paymentAddress: updated.paymentAddress,
      confirmedAt: updated.updatedAt.toISOString(),
    },
    { storeId: updated.storeId || undefined }
  );
  console.log('order.confirmed webhook fired');
  await db.$disconnect();
})();
