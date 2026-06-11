/**
 * Forensic analysis of expired Base orders in last 7 days.
 * Goal: identify if 115 expirations are (a) test traffic, (b) one broken merchant, (c) UX failure.
 */
import dotenv from 'dotenv';
dotenv.config();
import { db } from '../src/config/database';

async function main() {
  const week = new Date(Date.now() - 7 * 86_400_000);

  const orders = await db.order.findMany({
    where: { chain: 'BASE_MAINNET' as any, status: 'EXPIRED', createdAt: { gte: week } },
    select: {
      id: true, token: true, amount: true, nativeToken: true,
      createdAt: true, expiresAt: true, merchantId: true,
      externalId: true, metadata: true, paymentAddress: true,
      merchant: { select: { companyName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`\n=== ${orders.length} expired Base orders (last 7d) ===\n`);

  // Group by merchant
  const byMerchant = new Map<string, typeof orders>();
  for (const o of orders) {
    const key = `${o.merchant?.email ?? o.merchantId} (${o.merchant?.companyName ?? '?'})`;
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key)!.push(o);
  }
  console.log('BY MERCHANT:');
  for (const [m, list] of [...byMerchant.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${list.length.toString().padStart(3)}  ${m}`);
  }

  // Group by token
  const byToken = new Map<string, number>();
  for (const o of orders) {
    const t = o.nativeToken ? `NATIVE-${o.nativeToken}` : o.token;
    byToken.set(t, (byToken.get(t) ?? 0) + 1);
  }
  console.log('\nBY TOKEN:');
  for (const [t, n] of [...byToken.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${t}`);
  }

  // Group by amount bucket
  const buckets = { '0-5': 0, '5-20': 0, '20-50': 0, '50-100': 0, '100+': 0 };
  for (const o of orders) {
    const amt = Number(o.amount);
    if (amt <= 5) buckets['0-5']++;
    else if (amt <= 20) buckets['5-20']++;
    else if (amt <= 50) buckets['20-50']++;
    else if (amt <= 100) buckets['50-100']++;
    else buckets['100+']++;
  }
  console.log('\nBY AMOUNT BUCKET:');
  for (const [b, n] of Object.entries(buckets)) console.log(`  ${n.toString().padStart(3)}  $${b}`);

  // Group by hour-of-day pattern (UTC)
  const hours: Record<number, number> = {};
  for (const o of orders) {
    const h = o.createdAt.getUTCHours();
    hours[h] = (hours[h] ?? 0) + 1;
  }
  console.log('\nBY HOUR (UTC):');
  for (let h = 0; h < 24; h++) {
    const n = hours[h] ?? 0;
    if (n > 0) console.log(`  ${String(h).padStart(2, '0')}:00  ${'█'.repeat(n)} ${n}`);
  }

  // Sample externalId patterns (UnlockRiver uses OTT prefix)
  const extIds = orders.filter(o => o.externalId).map(o => o.externalId!);
  console.log(`\nORDERS WITH externalId: ${extIds.length}/${orders.length}`);
  if (extIds.length > 0) {
    const prefixes = new Map<string, number>();
    for (const id of extIds) {
      const prefix = id.slice(0, 6);
      prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
    }
    console.log('externalId prefixes:');
    for (const [p, n] of prefixes) console.log(`  ${n.toString().padStart(3)}  ${p}*`);
  }

  // Time-to-expiry: did they expire naturally (15+ min) or get expired manually?
  const lifespans = orders.map(o => (o.expiresAt.getTime() - o.createdAt.getTime()) / 1000);
  const avgLifespan = lifespans.reduce((s, n) => s + n, 0) / lifespans.length;
  console.log(`\nAvg created→expiresAt: ${Math.round(avgLifespan)}s (15min = 900s, 30min = 1800s)`);

  // Sample 5 most recent
  console.log('\nMOST RECENT 5:');
  for (const o of orders.slice(0, 5)) {
    console.log(`  ${o.id} | $${o.amount} ${o.nativeToken ?? o.token} | ${o.merchant?.email} | ${o.createdAt.toISOString()} | ext: ${o.externalId ?? '—'}`);
  }

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
