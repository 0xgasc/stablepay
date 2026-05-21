import { db } from '../src/config/database';
(async () => {
  const SOLANA_ADDRESS = 'Ecj9RZcPeygb5kdBUqyaX9YGxnfDQTNtgh1vbUmhDpus';
  const existing = await db.platformWallet.findFirst({ where: { chain: 'SOLANA_MAINNET' as any } });
  if (existing) {
    if (existing.address === SOLANA_ADDRESS) {
      console.log('SOLANA_MAINNET already configured with this address — no-op');
    } else {
      await db.platformWallet.update({
        where: { id: existing.id },
        data: { address: SOLANA_ADDRESS, isActive: true },
      });
      console.log('Updated SOLANA_MAINNET ->', SOLANA_ADDRESS);
    }
  } else {
    await db.platformWallet.create({
      data: {
        chain: 'SOLANA_MAINNET' as any,
        address: SOLANA_ADDRESS,
        label: 'Platform fees (Solana)',
        isActive: true,
      },
    });
    console.log('+ SOLANA_MAINNET ->', SOLANA_ADDRESS);
  }
  await db.$disconnect();
})();
