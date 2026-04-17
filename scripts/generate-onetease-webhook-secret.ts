// Generate a webhook secret for One Tease Tech B.V. and store it on their merchant record.
// Safe-ish: only writes when no secret exists yet. Pass --force to overwrite.
import crypto from 'crypto';
import { db } from '../src/config/database';

const MERCHANT_ID = 'cmnem8xia00008da9g8o13tp4';
const FORCE = process.argv.includes('--force');

async function main() {
  const m = await db.merchant.findUnique({
    where: { id: MERCHANT_ID },
    select: { companyName: true, webhookSecret: true, webhookUrl: true },
  });
  if (!m) {
    console.error('Merchant not found');
    process.exit(1);
  }
  console.log(`Merchant: ${m.companyName}`);
  console.log(`Webhook URL: ${m.webhookUrl}`);
  console.log(`Existing secret: ${m.webhookSecret ? '<present>' : '<null>'}`);

  if (m.webhookSecret && !FORCE) {
    console.log('\nSecret already set. Re-run with --force to rotate.');
    await db.$disconnect();
    return;
  }

  const secret = crypto.randomBytes(32).toString('hex');
  // Raw SQL so we don't trip on unmigrated columns the Prisma client now knows about.
  await db.$executeRaw`UPDATE merchants SET "webhookSecret" = ${secret} WHERE id = ${MERCHANT_ID}`;

  console.log('\n=== NEW WEBHOOK SECRET ===');
  console.log(secret);
  console.log('\nShare this ONCE with One Tease. They should store it server-side and use it to verify');
  console.log('the X-StablePay-Signature header on every webhook we send.');
  console.log('\nSignature scheme: hex(hmac_sha256(secret, `${timestamp}.${body}`))');
  console.log('Timestamp header: X-StablePay-Timestamp');
  console.log('Idempotency header: X-StablePay-Idempotency-Key (dedupe on this)');

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
