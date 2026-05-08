/**
 * Cron-triggered routes. Vercel hits these on a schedule (configured in vercel.json
 * under "crons"). All routes require the CRON_SECRET header to prevent random
 * external callers from triggering them.
 *
 * Vercel automatically attaches the secret as `Authorization: Bearer <CRON_SECRET>`
 * when it invokes a cron job, so we accept either header form.
 */
import { Router } from 'express';
import { runMerchantAlerter } from '../services/merchantAlerter';
import { logger } from '../utils/logger';

const router = Router();

function verifyCronAuth(req: any): boolean {
  const expected = (process.env.CRON_SECRET || '').trim();
  if (!expected) {
    // No secret configured — refuse rather than execute open. Operator must set
    // CRON_SECRET on Vercel before crons can fire.
    return false;
  }
  const header = req.headers['authorization'] || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const direct = req.headers['x-cron-secret'] || '';
  return bearer === expected || direct === expected;
}

/**
 * Hourly job — find merchants with persistent webhook failures and email them.
 * Idempotent: re-running within the per-merchant per-class cooldown is a no-op.
 */
router.get('/merchant-alerts', async (req, res) => {
  if (!verifyCronAuth(req)) {
    logger.warn('cron.merchant_alerts unauthorized', { event: 'cron.unauthorized', path: req.path });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runMerchantAlerter();
    logger.info('cron.merchant_alerts ran', { event: 'cron.merchant_alerts', ...result });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('cron.merchant_alerts failed', err as Error, { event: 'cron.merchant_alerts_error' });
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
