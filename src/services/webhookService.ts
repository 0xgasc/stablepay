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
   * Generate HMAC signature for webhook payload.
   *
   * Signs `<timestamp>.<body>` (Stripe-style) so the signature is bound to the timestamp header.
   * Replaying the same payload with a shifted timestamp will fail verification, and merchants
   * that enforce a 5-minute timestamp tolerance get full replay protection.
   */
  private generateSignature(payload: string, secret: string, timestamp: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');
  }

  /**
   * Send webhook. When `opts.storeId` is provided AND the store has a webhook URL configured,
   * delivery is scoped to the store (its URL, secret, enabled flag, and events subscription).
   * Otherwise falls back to merchant-level config. Store webhooks are isolated — a store with
   * `webhookEnabled=false` suppresses delivery even if merchant-level is enabled.
   */
  async sendWebhook(
    merchantId: string,
    event: WebhookEventType,
    data: Record<string, any>,
    opts?: { storeId?: string | null }
  ): Promise<void> {
    try {
      const { resolveWebhookTarget } = await import('./storeResolver');
      const target = await resolveWebhookTarget(merchantId, opts?.storeId ?? null);

      if (!target || !target.enabled) {
        logger.debug('Webhook not configured or disabled', { merchantId, storeId: opts?.storeId, event });
        return;
      }

      // Subscription filter
      if (target.events.length > 0 && !target.events.includes(event)) {
        logger.debug('Not subscribed to event', { merchantId, storeId: opts?.storeId, event });
        return;
      }

      const timestamp = new Date().toISOString();
      const payload: WebhookPayload = {
        event,
        timestamp,
        data,
      };

      const payloadString = JSON.stringify(payload);
      const signature = this.generateSignature(payloadString, target.secret, timestamp);

      // Create log entry (storeId column nullable — legacy merchant-level webhooks leave it null)
      const log = await db.webhookLog.create({
        data: {
          merchantId,
          storeId: target.source === 'store' ? (opts?.storeId ?? null) : null,
          event,
          payload: payload as any,
          url: target.url,
          attempts: 1,
        },
      });

      // Attempt delivery (fire-and-forget, don't block main flow)
      this.deliverWebhook(log.id, target.url, payloadString, signature, timestamp, merchantId).catch(err => {
        logger.error('Webhook delivery error', err as Error, { logId: log.id, merchantId, storeId: opts?.storeId, event });
      });

    } catch (error) {
      logger.error('Failed to send webhook', error as Error, { merchantId, storeId: opts?.storeId, event });
    }
  }

  /**
   * Attempt to deliver webhook
   */
  private async deliverWebhook(
    logId: string,
    url: string,
    payload: string,
    signature: string,
    timestamp: string,
    merchantId?: string
  ): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-StablePay-Signature': signature,
          'X-StablePay-Timestamp': timestamp,
          'X-StablePay-Idempotency-Key': logId,
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

        // Track health on merchant
        if (merchantId) {
          db.merchant.update({ where: { id: merchantId }, data: { webhookLastSuccess: new Date() } }).catch(() => {});
        }

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

      // Track failure on merchant
      if (merchantId) {
        db.merchant.update({ where: { id: merchantId }, data: { webhookLastFailure: new Date() } }).catch(() => {});
      }

      try {
        await this.scheduleRetry(logId, null, errorMessage);
      } catch (retryErr) {
        // If scheduleRetry itself fails, at least mark the log so processRetries can pick it up
        logger.error('Failed to schedule webhook retry', retryErr as Error, { logId });
        await db.webhookLog.update({
          where: { id: logId },
          data: { response: errorMessage.substring(0, 1000), nextRetryAt: new Date(Date.now() + 60000) },
        }).catch(() => {});
      }
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
        deliveredAt: null,
        OR: [
          { nextRetryAt: { lte: new Date() } },
          // Pick up stuck webhooks: no retry scheduled, not delivered, under max attempts
          { nextRetryAt: null, attempts: { lt: MAX_RETRIES } },
        ],
      },
      include: {
        merchant: {
          select: {
            webhookUrl: true,
            webhookSecret: true,
          },
        },
        store: {
          select: {
            webhookUrl: true,
            webhookSecret: true,
            webhookEnabled: true,
            isArchived: true,
          },
        },
      },
      take: 100,
    });

    let processed = 0;

    for (const log of pendingRetries) {
      // Resolve target at retry time so rotated store secrets apply to in-flight retries.
      // Store takes precedence if the log was originally store-scoped and the store still has
      // a URL. If the store was archived mid-flight, we fall back to merchant so delivery can
      // still complete (it's safer to deliver to the previous "parent" URL than to abandon).
      let url: string;
      let secret: string;
      if (log.storeId && log.store?.webhookUrl && !log.store.isArchived && log.store.webhookEnabled) {
        url = log.store.webhookUrl;
        secret = log.store.webhookSecret;
      } else if (log.merchant.webhookUrl) {
        url = log.merchant.webhookUrl;
        secret = log.merchant.webhookSecret || '';
      } else {
        continue;
      }

      const payloadString = JSON.stringify(log.payload);
      // Retries use the ORIGINAL payload timestamp so the signature stays valid across
      // attempts. Merchants enforcing a replay window will reject if too old — that's correct
      // behavior for a stuck/dead endpoint.
      const timestamp = (log.payload as any)?.timestamp || log.createdAt.toISOString();
      const signature = this.generateSignature(payloadString, secret, timestamp);

      await this.deliverWebhook(log.id, url, payloadString, signature, timestamp);
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
  ): Promise<{ webhookUrl: string | null; webhookEnabled: boolean; webhookEvents: string[]; webhookSecret?: string; secretGenerated?: boolean }> {
    // Validate URL if provided
    if (config.webhookUrl && !config.webhookUrl.startsWith('https://')) {
      throw new Error('Webhook URL must use HTTPS');
    }

    // Auto-generate a secret the first time a merchant configures a URL, so signature verification
    // is never a silent null. Returned exactly once in the response — the dashboard should surface it
    // prominently with a "copy to clipboard" button and a warning that it won't be shown again.
    // (Learned the hard way — see LEARNINGS.md, 2026-04-17.)
    const existing = await db.merchant.findUnique({
      where: { id: merchantId },
      select: { webhookSecret: true },
    });
    let newSecret: string | undefined;
    if (config.webhookUrl && !existing?.webhookSecret) {
      newSecret = crypto.randomBytes(32).toString('hex');
    }

    const updated = await db.merchant.update({
      where: { id: merchantId },
      data: {
        webhookUrl: config.webhookUrl,
        webhookEnabled: config.webhookEnabled,
        webhookEvents: config.webhookEvents,
        ...(newSecret && { webhookSecret: newSecret }),
      },
      select: {
        webhookUrl: true,
        webhookEnabled: true,
        webhookEvents: true,
      },
    });

    logger.info('Webhook config updated', {
      merchantId,
      secretGenerated: !!newSecret,
      event: 'webhook.config_updated',
    });

    return {
      ...updated,
      ...(newSecret && { webhookSecret: newSecret, secretGenerated: true }),
    };
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
