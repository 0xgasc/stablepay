import { db } from '../src/config/database';
(async () => {
  const m = await db.merchant.findUnique({
    where: { email: 'gasolomonc@gmail.com' },
    include: { wallets: { orderBy: { createdAt: 'asc' } }, stores: true },
  });
  if (!m) { console.log('NOT FOUND'); await db.$disconnect(); return; }
  console.log('Merchant:');
  console.log('  id:', m.id);
  console.log('  email:', m.email);
  console.log('  companyName:', m.companyName);
  console.log('  isActive:', m.isActive, 'isDayOne:', m.isDayOne, 'plan:', m.plan);
  console.log('  apiToken (prefix):', m.apiToken?.substring(0, 20) + '...');
  console.log('  webhookUrl:', m.webhookUrl);
  console.log('  customFeePercent:', m.customFeePercent);
  console.log('\n  Wallets:', m.wallets.length);
  for (const w of m.wallets) console.log(`    ${w.chain.padEnd(20)} ${w.address}`);
  console.log('\n  Stores:', m.stores.length);
  for (const s of m.stores) console.log(`    ${s.id} ${s.name}`);

  console.log('\n--- Platform wallets (admin) ---');
  const platform = await db.platformWallet.findMany({ orderBy: { chain: 'asc' } });
  for (const p of platform) console.log(`  ${p.chain.padEnd(20)} ${p.address}`);

  await db.$disconnect();
})();
