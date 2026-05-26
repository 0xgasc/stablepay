import { db } from '../src/config/database';
import bcrypt from 'bcryptjs';

(async () => {
  const newPassword = process.argv[2];
  if (!newPassword) { console.error('Usage: tsx rotate-admin-password.ts <new-password>'); process.exit(1); }
  const hash = await bcrypt.hash(newPassword, 12);
  const before = await db.systemConfig.findUnique({ where: { key: 'admin_password' } });
  console.log('Before:', before ? `exists (${before.value.startsWith('$2') ? 'bcrypt' : 'plaintext'})` : 'not set');
  await db.systemConfig.upsert({
    where: { key: 'admin_password' },
    update: { value: hash },
    create: { key: 'admin_password', value: hash },
  });
  const after = await db.systemConfig.findUnique({ where: { key: 'admin_password' } });
  console.log('After:', after?.value.substring(0, 10) + '... (bcrypt)');
  await db.$disconnect();
})();
