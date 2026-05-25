/**
 * Send announcement email to all active merchants about native token support.
 *
 * SAFETY:
 *   - Dry-run mode by default (--send to actually send)
 *   - Skips suspended merchants, inactive merchants, and unverified emails
 *   - Sends ONE email per merchant
 *
 * Usage:
 *   npx ts-node scripts/email-merchants-native-tokens.ts                  # dry-run, shows recipients
 *   npx ts-node scripts/email-merchants-native-tokens.ts --send           # actually send
 *   npx ts-node scripts/email-merchants-native-tokens.ts --send --only=info@oneteasetech.com   # send to one
 */

import dotenv from 'dotenv';
dotenv.config();
import { db } from '../src/config/database';
import { Resend } from 'resend';

const SEND   = process.argv.includes('--send');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1] : null;

const FROM_EMAIL  = process.env.FROM_EMAIL || 'StablePay <hello@wetakestables.shop>';
const RESEND_KEY  = process.env.RESEND_API_KEY;

const SUBJECT = 'Now accepting ETH, SOL, BNB at checkout — auto-converted to USDC';

function htmlBody(contactName: string): string {
  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1f2937;">
  <div style="border-left: 4px solid #10b981; padding-left: 16px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; margin: 0 0 4px 0;">A free upgrade for your checkout</h1>
    <p style="margin: 0; color: #6b7280; font-size: 14px;">No action required.</p>
  </div>

  <p>Hi ${contactName || 'there'},</p>

  <p>We just shipped a feature that should improve your checkout conversion: <strong>customers can now pay with ETH, SOL, BNB, MATIC, or ARB</strong> directly. We auto-swap to USDC (or your preferred stablecoin) on the same chain, and your wallet receives the stablecoin you've always received.</p>

  <p><strong>What stays the same:</strong></p>
  <ul style="line-height: 1.6;">
    <li>You still receive USDC (or whatever stablecoin you've configured)</li>
    <li>Your existing webhook payloads, dashboards, and integration code work without changes</li>
    <li>Your fee rate is unchanged</li>
  </ul>

  <p><strong>What's new:</strong></p>
  <ul style="line-height: 1.6;">
    <li>Customers without USDC in their wallet can now still pay you</li>
    <li>A small conversion fee (1.5%, $0.50 minimum, $1.00 on Ethereum mainnet) is added to <em>their</em> total — you receive your full order amount</li>
    <li>Your merchant dashboard now has a toggle to enable/disable native tokens per wallet (it's on by default — toggle off if you'd rather not)</li>
  </ul>

  <p><strong>Opting out:</strong> If you'd prefer to only accept stablecoins, go to your <a href="https://wetakestables.shop/dashboard" style="color: #2563eb;">Dashboard → Wallets</a>, click any wallet, and turn off "Accept native tokens". That's it.</p>

  <p>Questions? Just reply to this email.</p>

  <p style="color: #6b7280; font-size: 13px; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
    StablePay — stablecoin payments for ambitious teams<br>
    <a href="https://wetakestables.shop" style="color: #6b7280;">wetakestables.shop</a>
  </p>
</body></html>`.trim();
}

async function main() {
  if (SEND && !RESEND_KEY) { console.error('RESEND_API_KEY not set — cannot send'); process.exit(1); }
  const resend = RESEND_KEY ? new Resend(RESEND_KEY) : null;

  const merchants = await db.merchant.findMany({
    where: {
      isActive: true,
      isSuspended: false,
      emailVerified: true,
      ...(ONLY ? { email: ONLY } : {}),
    },
    select: { id: true, email: true, contactName: true, companyName: true },
  });

  console.log(`\n=== Merchant Native Token Announcement ${SEND ? '[LIVE]' : '[DRY RUN]'} ===`);
  console.log(`Recipients: ${merchants.length}\n`);
  for (const m of merchants) {
    console.log(`  ${m.email.padEnd(40)} ${m.companyName} (${m.contactName})`);
  }

  if (!SEND) {
    console.log('\nDry run. Re-run with --send to actually send.');
    await db.$disconnect();
    return;
  }

  console.log(`\nSending...`);
  let sent = 0, failed = 0;
  for (const m of merchants) {
    try {
      const { error } = await resend!.emails.send({
        from: FROM_EMAIL, to: m.email, subject: SUBJECT, html: htmlBody(m.contactName),
      });
      if (error) { console.error(`  ✗ ${m.email} — ${error.message}`); failed++; }
      else        { console.log(`  ✓ ${m.email}`); sent++; }
      await new Promise(r => setTimeout(r, 250)); // 4 req/sec rate limit
    } catch (e: any) { console.error(`  ✗ ${m.email} — ${e.message}`); failed++; }
  }

  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}`);
  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
