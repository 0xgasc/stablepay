import { db } from '../src/config/database';
import crypto from 'crypto';

(async () => {
  const ROTATE = process.argv.includes('--rotate');
  const m = await db.merchant.findUnique({ where: { email: 'gasolomonc@gmail.com' }, select: { id: true, companyName: true, loginToken: true, tokenExpiresAt: true, webhookSecret: true, webhookUrl: true } });
  if (!m) throw new Error('Not found');

  let token = m.loginToken;
  let exp = m.tokenExpiresAt;
  if (ROTATE || !token || (exp && exp < new Date())) {
    token = `sp_live_${crypto.randomBytes(24).toString('base64url')}`;
    exp = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
    await db.merchant.update({ where: { id: m.id }, data: { loginToken: token, tokenExpiresAt: exp } });
    console.log('Token (re)generated.');
  }

  console.log('\n=== OFFSET credentials ===');
  console.log('Merchant ID:        ', m.id);
  console.log('Company:            ', m.companyName);
  console.log('API token (Bearer): ', token);
  console.log('Token expires:      ', exp?.toISOString());
  console.log('Webhook secret:     ', m.webhookSecret || '(none set)');
  console.log('Webhook URL:        ', m.webhookUrl || '(none set)');
  await db.$disconnect();
})();
