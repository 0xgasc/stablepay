// Generate a webhook secret for UnlockRiver. Safe: only writes when no secret exists.
import crypto from 'crypto';
import { db } from '../src/config/database';

const MERCHANT_ID = 'cmnom9tx00000nbb6e12ewrnh';

async function main() {
  const m = await db.merchant.findUnique({
    where: { id: MERCHANT_ID },
    select: { companyName: true, webhookSecret: true },
  });
  if (!m) { console.error('Not found'); process.exit(1); }
  if (m.webhookSecret) {
    console.log('Already has secret — printing existing:');
    console.log(m.webhookSecret);
    return;
  }
  const secret = crypto.randomBytes(32).toString('hex');
  await db.$executeRaw`UPDATE merchants SET "webhookSecret" = ${secret} WHERE id = ${MERCHANT_ID}`;
  console.log(`Merchant: ${m.companyName}`);
  console.log(`New secret:`);
  console.log(secret);
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
