import crypto from 'crypto';
import { db } from '../config/database';
import { logger } from '../utils/logger';

export type WebhookEventType =
  | 'order.created'
  | 'order.confirmed'
  | 'order.expired'
  | 'refund.requested'
  | 'refund.processed'
  | 'invoice.created'
  | 'invoice.sent'
  | 'invoice.viewed'
  | 'invoice.paid'
  | 'invoice.overdue'
  | 'invoice.cancelled'
  | 'receipt.created'
  | 'receipt.sent';

interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, any>;
}

const MAX_RETRIES = 5;
const RETRY_DELAYS = [60, 300, 900, 3600, 7200]; // 1m, 5m, 15m, 1h, 2h in seconds

class WebhookService {
  /**
   * Generate HMAC signature for webhook payload
   */
  private generateSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Send webhook to merchant
   */
  async sendWebhook(
    merchantId: string,
    event: WebhookEventType,
    data: Record<string, any>
  ): Promise<void> {
    try {
      // Get merchant webhook config
      const merchant = await db.merchant.findUnique({
        where: { id: merchantId },
        select: {
          webhookUrl: true,
          webhookSecret: true,
          webhookEnabled: true,
          webhookEvents: true,
        },
      });

      if (!merchant?.webhookEnabled || !merchant.webhookUrl) {
        logger.debug('Webhook not configured or disabled', { merchantId, event });
        return;
      }

      // Check if merchant subscribes to this event
      if (merchant.webhookEvents.length > 0 && !merchant.webhookEvents.includes(event)) {
        logger.debug('Merchant not subscribed to event', { merchantId, event });
        return;
      }

      const payload: WebhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        data,
      };

      const payloadString = JSON.stringify(payload);
      const signature = this.generateSignature(payloadString, merchant.webhookSecret || '');

      // Create log entry
      const log = await db.webhookLog.create({
        data: {
          merchantId,
          event,
          payload: payload as any,
          url: merchant.webhookUrl,
          attempts: 1,
        },
      });

      // Attempt delivery (fire-and-forget, don't block main flow)
      this.deliverWebhook(log.id, merchant.webhookUrl, payloadString, signature).catch(err => {
        logger.error('Webhook delivery error', err as Error, { logId: log.id, merchantId, event });
      });

    } catch (error) {
      logger.error('Failed to send webhook', error as Error, { merchantId, event });
    }
  }

  /**
   * Attempt to deliver webhook
   */
  private async deliverWebhook(
    logId: string,
    url: string,
    payload: string,
    signature: string
  ): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-StablePay-Signature': signature,
          'X-StablePay-Timestamp': new Date().toISOString(),
        },
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const responseBody = await response.text().catch(() => '');

      if (response.ok) {
        // Success
        await db.webhookLog.update({
          where: { id: logId },
          data: {
            httpStatus: response.status,
            response: responseBody.substring(0, 1000),
            deliveredAt: new Date(),
            nextRetryAt: null,
          },
        });

        logger.info('Webhook delivered successfully', {
          logId,
          url,
          status: response.status,
          event: 'webhook.delivered',
        });

        return true;
      }

      // Non-2xx response - schedule retry
      await this.scheduleRetry(logId, response.status, responseBody);
      return false;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Webhook delivery failed', error as Error, { logId, url });

      await this.scheduleRetry(logId, null, errorMessage);
      return false;
    }
  }

  /**
   * Schedule retry with exponential backoff
   */
  private async scheduleRetry(
    logId: string,
    httpStatus: number | null,
    response: string
  ): Promise<void> {
    const log = await db.webhookLog.findUnique({
      where: { id: logId },
    });

    if (!log) return;

    if (log.attempts >= MAX_RETRIES) {
      // Max retries reached
      await db.webhookLog.update({
        where: { id: logId },
        data: {
          httpStatus,
          response: response.substring(0, 1000),
          nextRetryAt: null,
        },
      });

      logger.warn('Webhook max retries reached', {
        logId,
        attempts: log.attempts,
        event: 'webhook.max_retries',
      });
      return;
    }

    const delay = RETRY_DELAYS[log.attempts - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
    const nextRetry = new Date(Date.now() + delay * 1000);

    await db.webhookLog.update({
      where: { id: logId },
      data: {
        httpStatus,
        response: response.substring(0, 1000),
        attempts: log.attempts + 1,
        nextRetryAt: nextRetry,
      },
    });

    logger.info('Webhook retry scheduled', {
      logId,
      nextRetry: nextRetry.toISOString(),
      attempt: log.attempts + 1,
      event: 'webhook.retry_scheduled',
    });
  }

  /**
   * Process pending webhook retries (call from cron/scheduler)
   */
  async processRetries(): Promise<number> {
    const pendingRetries = await db.webhookLog.findMany({
      where: {
        nextRetryAt: { lte: new Date() },
        deliveredAt: null,
      },
      include: {
        merchant: {
          select: {
            webhookUrl: true,
            webhookSecret: true,
          },
        },
      },
      take: 100,
    });

    let processed = 0;

    for (const log of pendingRetries) {
      if (!log.merchant.webhookUrl) continue;

      const payloadString = JSON.stringify(log.payload);
      const signature = this.generateSignature(
        payloadString,
        log.merchant.webhookSecret || ''
      );

      await this.deliverWebhook(log.id, log.merchant.webhookUrl, payloadString, signature);
      processed++;
    }

    if (processed > 0) {
      logger.info('Processed webhook retries', { count: processed, event: 'webhook.retries_processed' });
    }

    return processed;
  }

  /**
   * Get webhook logs for merchant
   */
  async getLogs(merchantId: string, limit = 50): Promise<any[]> {
    return db.webhookLog.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Generate new webhook secret for merchant
   */
  async regenerateSecret(merchantId: string): Promise<string> {
    const secret = crypto.randomBytes(32).toString('hex');

    await db.merchant.update({
      where: { id: merchantId },
      data: { webhookSecret: secret },
    });

    logger.info('Webhook secret regenerated', { merchantId, event: 'webhook.secret_regenerated' });

    return secret;
  }

  /**
   * Update merchant webhook configuration
   */
  async updateConfig(
    merchantId: string,
    config: {
      webhookUrl?: string;
      webhookEnabled?: boolean;
      webhookEvents?: string[];
    }
  ): Promise<{ webhookUrl: string | null; webhookEnabled: boolean; webhookEvents: string[] }> {
    // Validate URL if provided
    if (config.webhookUrl && !config.webhookUrl.startsWith('https://')) {
      throw new Error('Webhook URL must use HTTPS');
    }

    const updated = await db.merchant.update({
      where: { id: merchantId },
      data: {
        webhookUrl: config.webhookUrl,
        webhookEnabled: config.webhookEnabled,
        webhookEvents: config.webhookEvents,
      },
      select: {
        webhookUrl: true,
        webhookEnabled: true,
        webhookEvents: true,
      },
    });

    logger.info('Webhook config updated', { merchantId, event: 'webhook.config_updated' });

    return updated;
  }

  /**
   * Get merchant webhook configuration
   */
  async getConfig(merchantId: string): Promise<{
    webhookUrl: string | null;
    webhookEnabled: boolean;
    webhookEvents: string[];
  } | null> {
    return db.merchant.findUnique({
      where: { id: merchantId },
      select: {
        webhookUrl: true,
        webhookEnabled: true,
        webhookEvents: true,
      },
    });
  }
}

export const webhookService = new WebhookService();
