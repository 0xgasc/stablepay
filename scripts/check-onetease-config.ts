import dotenv from 'dotenv';
dotenv.config();
import { db } from '../src/config/database';

async function main() {
  const m = await db.merchant.findUnique({
    where: { email: 'info@oneteasetech.com' },
    include: { wallets: true },
  });
  if (!m) { console.error('NOT FOUND'); return; }
  console.log(JSON.stringify({
    id: m.id, email: m.email, companyName: m.companyName,
    plan: m.plan, isActive: m.isActive, isSuspended: m.isSuspended,
    networkMode: m.networkMode, kycStatus: m.kycStatus,
    monthlyVolumeUsed: Number(m.monthlyVolumeUsed),
    monthlyTransactions: m.monthlyTransactions,
    wallets: m.wallets.map(w => ({
      chain: w.chain, supportedTokens: w.supportedTokens, address: w.address,
      isActive: w.isActive,
      acceptNativeTokens: w.acceptNativeTokens,
      preferredStablecoin: w.preferredStablecoin,
    })),
  }, null, 2));
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
