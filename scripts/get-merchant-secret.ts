// Print a merchant's webhook secret. Read-only, admin-use only.
import { db } from '../src/config/database';

async function main() {
  const target = process.argv[2];
  if (!target) { console.error('usage: get-merchant-secret.ts <merchantId|email|companyName>'); process.exit(1); }

  const m = await db.merchant.findFirst({
    where: { OR: [{ id: target }, { email: target }, { companyName: { contains: target, mode: 'insensitive' } }] },
    select: { id: true, companyName: true, email: true, webhookUrl: true, webhookSecret: true, webhookEnabled: true },
  });
  if (!m) { console.error(`Not found: ${target}`); process.exit(1); }

  console.log(`Merchant: ${m.companyName} (${m.id})`);
  console.log(`Email:    ${m.email}`);
  console.log(`Webhook:  ${m.webhookUrl || '(none)'}`);
  console.log(`Enabled:  ${m.webhookEnabled}`);
  console.log(`Secret:   ${m.webhookSecret || '(none)'}`);
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
