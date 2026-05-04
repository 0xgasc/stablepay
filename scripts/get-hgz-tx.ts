import { db } from '../src/config/database';
(async () => {
  const o = await db.order.findFirst({ where: { id: { endsWith: 'hgznv2z2' } } });
  console.log(JSON.stringify(o, (_k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  await db.$disconnect();
})();
