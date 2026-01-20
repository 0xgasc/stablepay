// Vercel cron job for processing webhook retries
// Schedule: */5 * * * * (every 5 minutes)

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

const MAX_RETRIES = 5;
const RETRY_DELAYS = [60, 300, 900, 3600, 7200]; // 1m, 5m, 15m, 1h, 2h in seconds

function generateSignature(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

async function deliverWebhook(log, webhookUrl, webhookSecret) {
  const payloadString = JSON.stringify(log.payload);
  const signature = generateSignature(payloadString, webhookSecret || '');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-StablePay-Signature': signature,
        'X-StablePay-Timestamp': new Date().toISOString(),
      },
      body: payloadString,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseBody = await response.text().catch(() => '');

    if (response.ok) {
      // Success
      await prisma.webhookLog.update({
        where: { id: log.id },
        data: {
          httpStatus: response.status,
          response: responseBody.substring(0, 1000),
          deliveredAt: new Date(),
          nextRetryAt: null,
        },
      });
      return true;
    }

    // Non-2xx response - schedule retry
    await scheduleRetry(log, response.status, responseBody);
    return false;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await scheduleRetry(log, null, errorMessage);
    return false;
  }
}

async function scheduleRetry(log, httpStatus, response) {
  if (log.attempts >= MAX_RETRIES) {
    // Max retries reached
    await prisma.webhookLog.update({
      where: { id: log.id },
      data: {
        httpStatus,
        response: response.substring(0, 1000),
        nextRetryAt: null,
      },
    });
    return;
  }

  const delay = RETRY_DELAYS[log.attempts - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
  const nextRetry = new Date(Date.now() + delay * 1000);

  await prisma.webhookLog.update({
    where: { id: log.id },
    data: {
      httpStatus,
      response: response.substring(0, 1000),
      attempts: log.attempts + 1,
      nextRetryAt: nextRetry,
    },
  });
}

async function processWebhookRetries() {
  const pendingRetries = await prisma.webhookLog.findMany({
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
  let succeeded = 0;

  for (const log of pendingRetries) {
    if (!log.merchant.webhookUrl) continue;

    const success = await deliverWebhook(log, log.merchant.webhookUrl, log.merchant.webhookSecret);
    processed++;
    if (success) succeeded++;
  }

  return { processed, succeeded };
}

module.exports = async function handler(req, res) {
  // Verify cron secret for security
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await processWebhookRetries();

    res.status(200).json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Webhook cron error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    await prisma.$disconnect();
  }
};
