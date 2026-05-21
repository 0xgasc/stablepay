/**
 * One-shot: add platform fee wallets for the EVM chains we support but haven't
 * configured. The same EOA controls payments on all EVM chains, so we can use
 * the existing BASE/ETH address for POLYGON, ARBITRUM, and BNB. Solana and TRON
 * are NOT included — they need their own keypairs, set those manually when ready.
 *
 * Idempotent: skips any chain that already has a row.
 */
import { db } from '../src/config/database';

const EVM_ADDRESS = '0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF';

const SEEDS = [
  { chain: 'POLYGON_MAINNET', address: EVM_ADDRESS, label: 'Platform fees (shared EVM)' },
  { chain: 'ARBITRUM_MAINNET', address: EVM_ADDRESS, label: 'Platform fees (shared EVM)' },
  { chain: 'BNB_MAINNET', address: EVM_ADDRESS, label: 'Platform fees (shared EVM)' },
];

(async () => {
  for (const seed of SEEDS) {
    const existing = await db.platformWallet.findFirst({
      where: { chain: seed.chain as any },
    });
    if (existing) {
      console.log(`  skip ${seed.chain} — already configured (${existing.address})`);
      continue;
    }
    await db.platformWallet.create({
      data: { chain: seed.chain as any, address: seed.address, label: seed.label, isActive: true },
    });
    console.log(`  + ${seed.chain} -> ${seed.address}`);
  }
  await db.$disconnect();
})();
