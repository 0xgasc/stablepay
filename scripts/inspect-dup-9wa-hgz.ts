import { db } from '../src/config/database';
(async () => {
  const ids = ['9wa681ib', 'hgznv2z2'];
  for (const idFrag of ids) {
    const o = await db.order.findFirst({
      where: { id: { endsWith: idFrag } },
      include: { merchant: { select: { companyName: true } } }
    });
    if (!o) { console.log('not found', idFrag); continue; }
    console.log('---', o.id);
    console.log(' externalId:', o.externalId);
    console.log(' merchant:', o.merchant.companyName);
    console.log(' amount:', o.amount.toString(), o.token, o.chain);
    console.log(' status:', o.status);
    console.log(' paymentAddress:', o.paymentAddress);
    console.log(' createdAt:', o.createdAt.toISOString());
    console.log(' confirmedAt:', o.confirmedAt?.toISOString());
    console.log(' txHash:', o.txHash);
    console.log(' customerWallet:', o.customerWallet);
    console.log(' metadata:', JSON.stringify(o.metadata, null, 2));
  }
  await db.$disconnect();
})();
