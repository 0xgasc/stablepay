import { db } from '../src/config/database';

(async () => {
  const m = await db.merchant.findUnique({ where: { email: 'gasolomonc@gmail.com' }, select: { id: true, companyName: true } });
  if (!m) throw new Error('OFFSET merchant not found');

  const platform = await db.platformWallet.findMany();
  if (platform.length === 0) throw new Error('No platform wallets configured');

  console.log(`Merchant: ${m.companyName} (${m.id})`);
  console.log(`Platform wallets to mirror: ${platform.length}`);

  for (const p of platform) {
    const existing = await db.merchantWallet.findFirst({ where: { merchantId: m.id, chain: p.chain } });
    if (existing) {
      await db.merchantWallet.update({
        where: { id: existing.id },
        data: { address: p.address },
      });
      console.log(`  UPDATED ${p.chain.padEnd(20)} ${p.address}`);
    } else {
      await db.merchantWallet.create({
        data: {
          merchantId: m.id,
          chain: p.chain,
          address: p.address,
          supportedTokens: ['USDC', 'USDT'],
        },
      });
      console.log(`  CREATED ${p.chain.padEnd(20)} ${p.address}`);
    }
  }

  console.log('\nVerification:');
  const after = await db.merchantWallet.findMany({ where: { merchantId: m.id }, orderBy: { chain: 'asc' } });
  for (const w of after) console.log(`  ${w.chain.padEnd(20)} ${w.address}`);
  await db.$disconnect();
})();
