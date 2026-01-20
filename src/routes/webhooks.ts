import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { webhookService, WebhookEventType } from '../services/webhookService';
import { logger } from '../utils/logger';

const router = Router();

// Valid webhook events
const VALID_EVENTS: WebhookEventType[] = [
  'order.created',
  'order.confirmed',
  'order.expired',
  'refund.requested',
  'refund.processed',
];

// Middleware to verify merchant auth token
async function requireMerchantAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const merchant = await db.merchant.findFirst({
      where: { loginToken: token },
      select: { id: true, email: true, companyName: true }
    });

    if (!merchant) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    (req as any).merchant = merchant;
    next();
  } catch (error) {
    logger.error('Webhook auth middleware error', error as Error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

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
router.post('/test', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;

    // Get current config
    const config = await webhookService.getConfig(merchant.id);

    if (!config?.webhookUrl) {
      return res.status(400).json({
        error: 'Webhook URL not configured',
        message: 'Please configure a webhook URL first',
      });
    }

    if (!config.webhookEnabled) {
      return res.status(400).json({
        error: 'Webhooks disabled',
        message: 'Please enable webhooks first',
      });
    }

    // Send test webhook
    await webhookService.sendWebhook(merchant.id, 'order.created', {
      orderId: 'test_' + Date.now(),
      amount: 10.00,
      chain: 'BASE_SEPOLIA',
      paymentAddress: '0x0000000000000000000000000000000000000000',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      _isTest: true,
    });

    logger.info('Test webhook sent', {
      merchantId: merchant.id,
      event: 'webhook.test_sent'
    });

    res.json({
      success: true,
      message: 'Test webhook sent. Check your webhook logs for delivery status.',
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
