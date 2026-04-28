import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { webhookService, WebhookEventType } from '../services/webhookService';
import { logger } from '../utils/logger';
import { requireMerchantAuth } from '../middleware/auth';

const router = Router();

// Valid webhook events
const VALID_EVENTS: WebhookEventType[] = [
  'order.created',
  'order.confirmed',
  'order.expired',
  'refund.requested',
  'refund.processed',
  'invoice.created',
  'invoice.sent',
  'invoice.viewed',
  'invoice.paid',
  'invoice.overdue',
  'invoice.cancelled',
  'receipt.created',
  'receipt.sent',
];

// Validation schemas
const updateConfigSchema = z.object({
  webhookUrl: z.string().url().startsWith('https://').optional().nullable(),
  webhookEnabled: z.boolean().optional(),
  webhookEvents: z.array(z.enum([
    'order.created',
    'order.confirmed',
    'order.expired',
    'refund.requested',
    'refund.processed',
  ])).optional(),
});

// GET /api/webhooks - Get webhook configuration
router.get('/', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const config = await webhookService.getConfig(merchant.id);

    if (!config) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    res.json({
      webhookUrl: config.webhookUrl,
      webhookEnabled: config.webhookEnabled,
      webhookEvents: config.webhookEvents,
      availableEvents: VALID_EVENTS,
    });
  } catch (error) {
    logger.error('Get webhook config error', error as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/webhooks - Update webhook configuration
router.put('/', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const data = updateConfigSchema.parse(req.body);

    const updated = await webhookService.updateConfig(merchant.id, {
      webhookUrl: data.webhookUrl ?? undefined,
      webhookEnabled: data.webhookEnabled,
      webhookEvents: data.webhookEvents,
    });

    logger.info('Webhook config updated', {
      merchantId: merchant.id,
      webhookEnabled: updated.webhookEnabled,
      event: 'webhook.config_updated'
    });

    res.json({
      success: true,
      ...updated,
      availableEvents: VALID_EVENTS,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    if (error instanceof Error && error.message.includes('HTTPS')) {
      return res.status(400).json({ error: error.message });
    }
    logger.error('Update webhook config error', error as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/webhooks/secret - Regenerate webhook secret
router.post('/secret', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const secret = await webhookService.regenerateSecret(merchant.id);

    logger.security('Webhook secret regenerated', {
      merchantId: merchant.id,
      event: 'webhook.secret_regenerated'
    });

    res.json({
      success: true,
      secret,
      message: 'Store this secret securely. It will not be shown again.',
    });
  } catch (error) {
    logger.error('Regenerate webhook secret error', error as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/webhooks/logs - Get webhook delivery logs
// GET /api/webhooks/health — summary view for the merchant dashboard.
// Returns 24h delivery stats + 5 most recent failures (with response body) + queue depth,
// so a merchant can self-diagnose "is my endpoint accepting our webhooks" without me
// running scripts against the DB.
router.get('/health', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [recent, recentFails, queue] = await Promise.all([
      db.webhookLog.findMany({
        where: { merchantId: merchant.id, createdAt: { gte: dayAgo } },
        select: { deliveredAt: true, httpStatus: true, attempts: true },
      }),
      db.webhookLog.findMany({
        where: { merchantId: merchant.id, deliveredAt: null, httpStatus: { gte: 400 } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, event: true, httpStatus: true, attempts: true, response: true, createdAt: true, nextRetryAt: true },
      }),
      db.webhookLog.count({
        where: { merchantId: merchant.id, deliveredAt: null, nextRetryAt: { not: null } },
      }),
    ]);

    const total = recent.length;
    const delivered = recent.filter(r => r.deliveredAt).length;
    const successPct = total === 0 ? null : Math.round((delivered / total) * 100);
    const lastFailHttpStatus = recent.find(r => !r.deliveredAt && r.httpStatus)?.httpStatus || null;

    res.json({
      window: '24h',
      total,
      delivered,
      failed: total - delivered,
      successPct,
      queueDepth: queue,
      recentFailures: recentFails.map(r => ({
        id: r.id,
        event: r.event,
        httpStatus: r.httpStatus,
        attempts: r.attempts,
        response: (r.response || '').substring(0, 280),
        createdAt: r.createdAt.toISOString(),
        nextRetryAt: r.nextRetryAt?.toISOString() || null,
      })),
      hint: total === 0 ? 'No webhook traffic in 24h.'
        : successPct === 100 ? 'All clear.'
        : successPct! >= 95 ? 'Mostly healthy — occasional failures may be transient.'
        : lastFailHttpStatus === 401 ? 'Your endpoint is rejecting our signature. Check the verify function uses HMAC of `${timestamp}.${body}` (see /docs/API.md).'
        : lastFailHttpStatus === 404 ? 'Your endpoint is returning 404 — the route may not be registered on your server.'
        : (lastFailHttpStatus && lastFailHttpStatus >= 500) ? 'Your endpoint is 5xx-ing — backend is erroring on our payload.'
        : 'Some failures detected. Inspect recentFailures.',
    });
  } catch (error) {
    logger.error('Webhook health summary error', error as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/logs', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const logs = await webhookService.getLogs(merchant.id, limit);

    res.json({
      logs: logs.map(log => ({
        id: log.id,
        event: log.event,
        url: log.url,
        httpStatus: log.httpStatus,
        attempts: log.attempts,
        deliveredAt: log.deliveredAt?.toISOString(),
        nextRetryAt: log.nextRetryAt?.toISOString(),
        createdAt: log.createdAt.toISOString(),
        // Don't expose full payload/response in list view
      })),
      count: logs.length,
    });
  } catch (error) {
    logger.error('Get webhook logs error', error as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/webhooks/logs/:logId - Get single webhook log with full details
router.get('/logs/:logId', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const { logId } = req.params;

    const log = await db.webhookLog.findFirst({
      where: {
        id: logId,
        merchantId: merchant.id,
      },
    });

    if (!log) {
      return res.status(404).json({ error: 'Webhook log not found' });
    }

    res.json({
      id: log.id,
      event: log.event,
      payload: log.payload,
      url: log.url,
      httpStatus: log.httpStatus,
      response: log.response,
      attempts: log.attempts,
      deliveredAt: log.deliveredAt?.toISOString(),
      nextRetryAt: log.nextRetryAt?.toISOString(),
      createdAt: log.createdAt.toISOString(),
    });
  } catch (error) {
    logger.error('Get webhook log error', error as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/webhooks/test - Send test webhook
// Fire a synthetic webhook to the merchant's endpoint and return the actual delivery result
// inline (HTTP status, response body, signature header, latency) so the merchant can debug
// their verify function without running real money through. Bypasses event-subscription filtering
// so the test always fires regardless of which events they're subscribed to.
router.post('/test', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const eventType = (req.body?.event as string) || 'order.confirmed'; // default — most common verify target

    const m = await db.merchant.findUnique({
      where: { id: merchant.id },
      select: { webhookUrl: true, webhookSecret: true },
    });
    if (!m?.webhookUrl) return res.status(400).json({ error: 'Webhook URL not configured' });

    const timestamp = new Date().toISOString();
    const orderId = 'test_' + Date.now();
    const payload = {
      event: eventType,
      timestamp,
      data: {
        orderId,
        externalId: 'test-' + Math.random().toString(36).slice(2, 10),
        amount: 1.00,
        token: 'USDC',
        chain: 'BASE_MAINNET',
        status: 'CONFIRMED',
        txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        explorerLink: null,
        customerEmail: 'test@stablepay.dev',
        customerWallet: null,
        paymentAddress: '0x0000000000000000000000000000000000000000',
        paymentMethod: null,
        feePercent: 0.01,
        feeAmount: 0.01,
        netAmount: 0.99,
        metadata: { _isTest: true },
        confirmedAt: timestamp,
      },
    };
    const body = JSON.stringify(payload);
    const secret = m.webhookSecret || '';
    const signature = require('crypto')
      .createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    const idempotencyKey = 'test-' + require('crypto').randomBytes(8).toString('hex');

    const t0 = Date.now();
    let httpStatus: number | null = null;
    let responseBody = '';
    let networkError: string | null = null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      const resp = await fetch(m.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-StablePay-Signature': signature,
          'X-StablePay-Timestamp': timestamp,
          'X-StablePay-Idempotency-Key': idempotencyKey,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      httpStatus = resp.status;
      responseBody = await resp.text().catch(() => '');
    } catch (err: any) {
      networkError = String(err?.message || err).slice(0, 200);
    }
    const latencyMs = Date.now() - t0;

    const ok = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
    logger.info('Webhook test fired', {
      merchantId: merchant.id, eventType, httpStatus, latencyMs, ok,
      event: 'webhook.test_fired',
    });

    res.json({
      success: ok,
      url: m.webhookUrl,
      eventType,
      sent: {
        timestamp,
        signature,
        idempotencyKey,
        bodyPreview: body.slice(0, 600),
      },
      received: {
        httpStatus,
        latencyMs,
        responseBody: responseBody.slice(0, 1000),
        networkError,
      },
      diagnosis: networkError
        ? `Could not reach your endpoint: ${networkError}. Check the URL is reachable and HTTPS-valid.`
        : httpStatus === 200 || httpStatus === 201 || httpStatus === 204
        ? '✓ Endpoint accepted the webhook.'
        : httpStatus === 401 || httpStatus === 403
        ? `Your endpoint rejected the signature (HTTP ${httpStatus}). Check your verify function uses HMAC of "<timestamp>.<body>", and that you're using the secret shown in this dashboard.`
        : httpStatus === 404
        ? 'Your endpoint returned 404 — the route may not be registered on your server.'
        : httpStatus && httpStatus >= 500
        ? `Your endpoint is 5xx-ing (${httpStatus}). Server-side error processing the payload.`
        : `Unexpected response: HTTP ${httpStatus}.`,
    });
  } catch (error) {
    logger.error('Send test webhook error', error as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/webhooks/logs/:logId/retry - Manually retry a failed webhook
router.post('/logs/:logId/retry', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const { logId } = req.params;

    const log = await db.webhookLog.findFirst({
      where: {
        id: logId,
        merchantId: merchant.id,
        deliveredAt: null, // Only retry undelivered
      },
      include: {
        merchant: {
          select: {
            webhookUrl: true,
            webhookSecret: true,
          },
        },
      },
    });

    if (!log) {
      return res.status(404).json({
        error: 'Webhook log not found or already delivered',
      });
    }

    // Reset retry attempt and trigger immediate retry
    await db.webhookLog.update({
      where: { id: logId },
      data: {
        nextRetryAt: new Date(), // Set to now for immediate processing
      },
    });

    // Process retries (this will pick up the one we just updated)
    await webhookService.processRetries();

    logger.info('Manual webhook retry triggered', {
      logId,
      merchantId: merchant.id,
      event: 'webhook.manual_retry'
    });

    res.json({
      success: true,
      message: 'Retry triggered. Check webhook logs for updated status.',
    });
  } catch (error) {
    logger.error('Manual webhook retry error', error as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as webhooksRouter };
