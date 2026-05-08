/**
 * Merchant alerter — auto-emails merchants about platform-detected issues with their
 * integration so the human operator (you) doesn't need to be awake when something
 * breaks. Handles webhook delivery failures specifically: if a merchant has had
 * ALERT_THRESHOLD consecutive same-class failures in the last LOOKBACK window and we
 * haven't already alerted them about that exact class within COOLDOWN, send an email
 * with a diagnosis.
 *
 * Designed to be idempotent and safe to run on a cron — re-running within the
 * cooldown window is a no-op.
 *
 * Hooks into the existing logger / Resend setup. CC's the platform admin so you can
 * see what merchants are being told without tracking it manually.
 */
import { db } from '../config/database';
import { logger } from '../utils/logger';

const ALERT_THRESHOLD = 5; // N consecutive failures before alerting
const LOOKBACK_HOURS = 6;  // Window for "consecutive failures"
const COOLDOWN_HOURS = 12; // Don't re-alert same merchant for same class within this window

/**
 * Classify a webhook failure into a coarse error class so we group related failures
 * for dedup + send tailored remediation copy.
 */
function classifyError(httpStatus: number | null, response: string | null): {
  alertClass: string;
  subjectFragment: string;
  diagnosis: string;
  fixHint: string;
} {
  const text = (response || '').toLowerCase();

  // TLS / SSL — cert mismatch, expired, untrusted CA
  if (
    text.includes("hostname/ip does not match certificate") ||
    text.includes("subjectaltname") ||
    text.includes("self-signed") ||
    text.includes("cert has expired") ||
    text.includes("tls handshake") ||
    text.includes("err_tls_cert_altname_invalid")
  ) {
    return {
      alertClass: 'webhook_tls',
      subjectFragment: 'TLS / SSL certificate issue',
      diagnosis: 'Your webhook endpoint is presenting a TLS certificate that does not match the hostname we are calling. This usually means the cert is for a different subdomain, expired, or self-signed.',
      fixHint: 'Check your cert covers the exact hostname we are calling (it is shown in your StablePay dashboard webhook config). If you migrated to a new hostname, update the URL in your StablePay dashboard or contact us to update it.',
    };
  }

  // Connection failures — DNS, refused, reset, no route
  if (
    text.includes("econnrefused") ||
    text.includes("enotfound") ||
    text.includes("econnreset") ||
    text.includes("ehostunreach") ||
    text.includes("no route to host") ||
    text.includes("getaddrinfo")
  ) {
    return {
      alertClass: 'webhook_connection',
      subjectFragment: 'Webhook endpoint unreachable',
      diagnosis: 'We could not connect to your webhook endpoint at all. This means DNS is not resolving, the server is down, or a firewall is blocking us.',
      fixHint: 'Verify your endpoint is up by hitting it from a browser or curl. If it is up but blocked, allowlist outbound connections from the StablePay IP range.',
    };
  }

  // Timeout
  if (text.includes("timeout") || text.includes("etimedout") || text.includes("timed out")) {
    return {
      alertClass: 'webhook_timeout',
      subjectFragment: 'Webhook endpoint timing out',
      diagnosis: 'Your webhook endpoint is accepting our connection but not responding within our timeout window (10 seconds).',
      fixHint: 'Either speed up the endpoint to respond in under 10 seconds, or have it accept the request and process asynchronously (return 200 immediately, then do work in a background job).',
    };
  }

  // 5xx server errors — endpoint exists but is broken
  if (httpStatus && httpStatus >= 500 && httpStatus < 600) {
    return {
      alertClass: 'webhook_5xx',
      subjectFragment: `Webhook endpoint returning ${httpStatus}`,
      diagnosis: `Your webhook endpoint is returning HTTP ${httpStatus}. Your server is reachable but throwing an error when processing our request.`,
      fixHint: 'Check your application logs for the error. Common causes: missing env vars in deploy, signature verification failing on your end, downstream DB / service that the handler depends on being down.',
    };
  }

  // 4xx — usually auth / signature problems
  if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
    return {
      alertClass: 'webhook_4xx',
      subjectFragment: `Webhook endpoint rejecting requests (${httpStatus})`,
      diagnosis: `Your webhook endpoint is returning HTTP ${httpStatus}. This usually means our signature is being rejected or the request body is not what your handler expects.`,
      fixHint: 'Verify your signature verification logic matches our scheme: HMAC-SHA256 of "<X-StablePay-Timestamp>.<raw body>" using your webhook secret as the key. Compare against the X-StablePay-Signature header.',
    };
  }

  return {
    alertClass: 'webhook_other',
    subjectFragment: 'Webhook delivery failures',
    diagnosis: 'We are seeing repeated delivery failures to your webhook endpoint without a clear pattern.',
    fixHint: 'Check the latest webhook logs in your StablePay dashboard for the specific error response from your server.',
  };
}

interface WebhookFailureGroup {
  merchantId: string;
  alertClass: string;
  classification: ReturnType<typeof classifyError>;
  count: number;
  representativeError: string;
}

/**
 * Find merchants with persistent webhook failures grouped by error class.
 * Looks at the last LOOKBACK_HOURS hours of failed deliveries per merchant.
 */
async function findFailingMerchants(): Promise<WebhookFailureGroup[]> {
  const lookback = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  // Get all undelivered webhooks in the lookback window with their merchant
  const failures = await db.webhookLog.findMany({
    where: {
      createdAt: { gte: lookback },
      deliveredAt: null,
      attempts: { gt: 0 },
    },
    select: {
      merchantId: true,
      httpStatus: true,
      response: true,
      attempts: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Group by (merchantId, alertClass)
  const groups = new Map<string, WebhookFailureGroup>();
  for (const f of failures) {
    const cls = classifyError(f.httpStatus, f.response);
    const key = `${f.merchantId}:${cls.alertClass}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      groups.set(key, {
        merchantId: f.merchantId,
        alertClass: cls.alertClass,
        classification: cls,
        count: 1,
        representativeError: (f.response || '').substring(0, 500),
      });
    }
  }

  // Filter to groups above threshold
  return Array.from(groups.values()).filter((g) => g.count >= ALERT_THRESHOLD);
}

/**
 * Has this merchant already been alerted about this class within the cooldown?
 */
async function isInCooldown(merchantId: string, alertClass: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000);
  const recent = await db.merchantAlert.findFirst({
    where: { merchantId, alertClass, createdAt: { gte: cutoff } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  return recent !== null;
}

async function sendAlertEmail(
  merchantEmail: string,
  contactName: string | null,
  companyName: string,
  group: WebhookFailureGroup,
): Promise<{ subject: string; html: string }> {
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = (process.env.FROM_EMAIL || 'StablePay <donotreply@wetakestables.shop>').trim();
  const ccAdmin = process.env.ADMIN_EMAIL;

  const greeting = contactName ? `Hi ${contactName},` : `Hi ${companyName} team,`;
  const subject = `[StablePay] ${group.classification.subjectFragment} — action needed`;

  const html = `
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
  <h2 style="margin: 0 0 16px 0; font-size: 20px;">Webhook delivery issue</h2>
  <p>${greeting}</p>
  <p>We've detected <strong>${group.count} consecutive webhook delivery failures</strong> to your endpoint in the last ${LOOKBACK_HOURS} hours, all matching the same error pattern.</p>

  <h3 style="margin: 24px 0 8px 0; font-size: 16px;">What's happening</h3>
  <p>${group.classification.diagnosis}</p>

  <h3 style="margin: 24px 0 8px 0; font-size: 16px;">How to fix</h3>
  <p>${group.classification.fixHint}</p>

  <h3 style="margin: 24px 0 8px 0; font-size: 16px;">Sample error from your server</h3>
  <pre style="background: #f1f5f9; padding: 12px; border-left: 3px solid #ef4444; font-size: 12px; white-space: pre-wrap; word-break: break-word;">${escapeHtml(group.representativeError) || '(no body returned)'}</pre>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="font-size: 13px; color: #64748b;">
    Until this is resolved, we are queuing your webhooks and retrying with backoff. Once your endpoint recovers, queued events will deliver automatically.
  </p>
  <p style="font-size: 13px; color: #64748b;">
    Reply to this email if you need help debugging — we'll respond when the team is online.
  </p>
  <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">
    StablePay · <a href="https://wetakestables.shop" style="color: #0ea5e9;">wetakestables.shop</a>
  </p>
</div>
`.trim();

  await resend.emails.send({
    from: fromEmail,
    to: merchantEmail,
    cc: ccAdmin ? [ccAdmin] : undefined,
    subject,
    html,
  });

  return { subject, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Main entry — process all current webhook failures, send alerts where appropriate.
 * Returns counts so caller can log / report.
 */
export async function runMerchantAlerter(): Promise<{
  groups: number;
  sent: number;
  cooldown: number;
  errors: number;
}> {
  const groups = await findFailingMerchants();
  let sent = 0, cooldown = 0, errors = 0;

  for (const group of groups) {
    try {
      if (await isInCooldown(group.merchantId, group.alertClass)) {
        cooldown++;
        continue;
      }

      const merchant = await db.merchant.findUnique({
        where: { id: group.merchantId },
        select: { email: true, contactName: true, companyName: true, isActive: true, isSuspended: true },
      });
      if (!merchant || !merchant.email || merchant.isSuspended || !merchant.isActive) {
        // No-op for inactive/suspended/no-email merchants
        continue;
      }

      const { subject, html } = await sendAlertEmail(
        merchant.email,
        merchant.contactName,
        merchant.companyName,
        group,
      );

      await db.merchantAlert.create({
        data: {
          merchantId: group.merchantId,
          alertClass: group.alertClass,
          errorPattern: group.representativeError.substring(0, 500),
          affectedCount: group.count,
          emailSentTo: merchant.email,
          subject,
          body: html,
        },
      });

      sent++;
      logger.info('Merchant alert sent', {
        event: 'merchant_alert.sent',
        merchantId: group.merchantId,
        alertClass: group.alertClass,
        affectedCount: group.count,
      });
    } catch (err) {
      errors++;
      logger.error('Merchant alert send failed', err as Error, {
        event: 'merchant_alert.error',
        merchantId: group.merchantId,
        alertClass: group.alertClass,
      });
    }
  }

  return { groups: groups.length, sent, cooldown, errors };
}
