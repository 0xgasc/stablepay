import { db } from '../src/config/database';
(async () => {
  const wallets = await db.platformWallet.findMany({
    orderBy: { chain: 'asc' },
    select: { chain: true, address: true, label: true, isActive: true },
  });
  console.log(`Platform wallets in DB (${wallets.length}):`);
  for (const w of wallets) {
    console.log(`  ${w.chain.padEnd(20)} ${w.isActive ? 'ACTIVE  ' : 'INACTIVE'} ${w.address}  ${w.label || ''}`);
  }
  if (wallets.length === 0) {
    console.log('  (none — fallback hardcoded list will be used for the 3 chains it covers)');
  }
  await db.$disconnect();
})();
