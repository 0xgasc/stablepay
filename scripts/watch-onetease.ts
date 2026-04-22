/**
 * Live event stream for One Tease testing sessions.
 * Polls the DB every 10s and prints ONE line per new event to stdout so it
 * can be consumed by a monitor/tail/grep chain.
 *
 * Emits events for:
 *   - new order created (PENDING)
 *   - order status transitions (PENDING → CONFIRMED/EXPIRED/CANCELLED)
 *   - webhook delivery outcome (200 / 4xx / 5xx / no-response)
 *
 * Each line is prefixed so you can filter — example filters for Monitor:
 *   grep -E --line-buffered "ORDER|WEBHOOK"
 */
import { db } from '../src/config/database';

const ONETEASE = 'cmnem8xia00008da9g8o13tp4';
const POLL_MS = 10_000;

let sinceOrderCreated = new Date(Date.now() - 2 * 60_000);       // catch anything from last 2 min on boot
let sinceOrderUpdated = new Date(Date.now() - 2 * 60_000);
let sinceWebhook      = new Date(Date.now() - 2 * 60_000);

function line(kind: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  // stdout line-buffered by Node by default; explicit newline for monitors that read line-by-line
  process.stdout.write(`${ts} ${kind} ${msg}\n`);
}

async function tick() {
  try {
    const newOrders = await db.$queryRaw<any[]>`
      SELECT id, "externalId", chain, token, amount, status, "customerWallet", "createdAt"
      FROM orders
      WHERE "merchantId" = ${ONETEASE} AND "createdAt" > ${sinceOrderCreated}
      ORDER BY "createdAt" ASC
    `;
    for (const o of newOrders) {
      line('ORDER_NEW', `${o.id.slice(-8)} ext=${o.externalId || '-'} $${Number(o.amount)} ${o.token} ${o.chain} from=${(o.customerWallet || '').slice(0, 10)}`);
      sinceOrderCreated = new Date(o.createdAt);
    }

    const updatedOrders = await db.$queryRaw<any[]>`
      SELECT id, "externalId", status, "updatedAt"
      FROM orders
      WHERE "merchantId" = ${ONETEASE}
        AND "updatedAt" > ${sinceOrderUpdated}
        AND "createdAt" < "updatedAt"
      ORDER BY "updatedAt" ASC
    `;
    for (const o of updatedOrders) {
      const marker = o.status === 'CONFIRMED' ? '✓' : o.status === 'EXPIRED' ? '✗' : '•';
      line(`ORDER_${o.status}`, `${marker} ${o.id.slice(-8)} ext=${o.externalId || '-'}`);
      sinceOrderUpdated = new Date(o.updatedAt);
    }

    const hooks = await db.webhookLog.findMany({
      where: { merchantId: ONETEASE, createdAt: { gt: sinceWebhook } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, event: true, httpStatus: true, attempts: true, response: true,
        deliveredAt: true, createdAt: true, payload: true,
      },
    });
    for (const h of hooks) {
      const orderId = ((h.payload as any)?.data?.orderId || '').slice(-8);
      const delivered = h.deliveredAt ? 'DELIVERED' : (h.httpStatus ? `FAIL_${h.httpStatus}` : 'NO_RESP');
      const tail = h.httpStatus && h.httpStatus >= 400 && h.response
        ? ` resp="${(h.response || '').substring(0, 80).replace(/\n/g, ' ')}"`
        : '';
      line(`WEBHOOK_${delivered}`, `${h.event} order=${orderId} attempt=${h.attempts}${tail}`);
      sinceWebhook = new Date(h.createdAt);
    }
  } catch (err: any) {
    line('ERROR', String(err?.message || err).slice(0, 200));
  }
}

line('READY', 'watching One Tease — polling every 10s');
void tick();
setInterval(tick, POLL_MS);

// Keep alive; signals stop it cleanly
process.on('SIGINT',  () => { line('STOP', 'SIGINT');  process.exit(0); });
process.on('SIGTERM', () => { line('STOP', 'SIGTERM'); process.exit(0); });
