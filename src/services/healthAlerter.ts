/**
 * Background health-monitor loop. Runs on the Railway scanner (long-lived process).
 *
 * Polls runHealthCheck() every 5 min. Pages ops via email ONLY when:
 *   - A component first transitions from ok → warning|down (so you get told the moment
 *     something breaks, not after it's been broken for an hour).
 *   - A component is still down/warning at the 30-min mark and has been every check since
 *     (paging again to remind, in case the first email was missed).
 *   - A component recovers (ok again) — confirmation page so you don't have to manually
 *     re-check.
 *
 * Anything that flickers (down for one tick, ok the next) is treated as transient and
 * suppressed. This is what makes it different from the watcher script — the watcher
 * narrates EVERY tick because a human operator wants real-time signal during testing;
 * the alerter pages humans who'd rather sleep through a single 30-second blip.
 */
import { runHealthCheck, type Status, type HealthReport } from './healthCheck';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 5 * 60_000;
const REPAGE_AFTER_MS = 30 * 60_000;

interface ComponentState {
  status: Status;
  since: number;       // when we first saw this status
  lastPagedAt: number; // 0 if never
}

const componentState = new Map<string, ComponentState>();

async function sendAlertEmail(subject: string, body: string) {
  const to = (process.env.OPS_ALERT_EMAIL || process.env.ADMIN_EMAIL || '').trim();
  if (!to) {
    logger.warn('Health alert suppressed — no OPS_ALERT_EMAIL or ADMIN_EMAIL configured', { subject });
    return;
  }
  if (!process.env.RESEND_API_KEY) {
    logger.warn('Health alert suppressed — RESEND_API_KEY not set', { subject });
    return;
  }
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = (process.env.FROM_EMAIL || 'StablePay <ops@wetakestables.shop>').trim();
    await resend.emails.send({
      from: fromEmail, to, subject,
      html: `<pre style="font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap;">${escapeHtml(body)}</pre>`,
    });
    logger.security('Health alert sent', { subject, to, event: 'health.alert_sent' });
  } catch (err) {
    logger.error('Failed to send health alert email', err as Error, { subject });
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
}

function formatReport(report: HealthReport): string {
  const lines: string[] = [`Overall: ${report.status.toUpperCase()}  (checked ${report.checkedAt}, ${report.durationMs}ms)`];
  for (const [name, c] of Object.entries(report.components)) {
    const tag = c.status === 'ok' ? '✓' : c.status === 'warning' ? '⚠' : '✗';
    lines.push(`  ${tag} ${name.padEnd(18)} ${c.status.padEnd(7)} ${c.message || ''}`);
    if (c.details && Object.keys(c.details).length > 0) {
      lines.push(`     ${JSON.stringify(c.details).slice(0, 300)}`);
    }
  }
  return lines.join('\n');
}

export async function runHealthCycle() {
  let report: HealthReport;
  try {
    report = await runHealthCheck();
  } catch (err: any) {
    logger.error('Health check itself crashed', err as Error);
    return;
  }

  const now = Date.now();
  for (const [name, component] of Object.entries(report.components)) {
    const prev = componentState.get(name);
    const isHealthy = component.status === 'ok';
    const wasHealthy = !prev || prev.status === 'ok';

    if (isHealthy && wasHealthy) {
      // Steady-state healthy — do nothing.
      continue;
    }

    if (isHealthy && !wasHealthy) {
      // Recovery. Page once, clear state.
      const downForMin = Math.round((now - prev!.since) / 60_000);
      componentState.delete(name);
      await sendAlertEmail(
        `[stablepay] ${name} recovered after ${downForMin} min`,
        `Component "${name}" is back to OK.\n\n${formatReport(report)}`,
      );
      continue;
    }

    if (!isHealthy && wasHealthy) {
      // Just broke. Page immediately.
      componentState.set(name, { status: component.status, since: now, lastPagedAt: now });
      await sendAlertEmail(
        `[stablepay] ${name} is ${component.status.toUpperCase()}: ${component.message || '(no message)'}`,
        `Component "${name}" first flagged at ${new Date(now).toISOString()}.\n\n${formatReport(report)}`,
      );
      continue;
    }

    // Still broken since last check. Update status if it changed (warning → down etc.)
    // and re-page if we've been down >30 min since last page.
    const updated = { ...prev!, status: component.status };
    if (now - updated.lastPagedAt >= REPAGE_AFTER_MS) {
      const downForMin = Math.round((now - updated.since) / 60_000);
      updated.lastPagedAt = now;
      await sendAlertEmail(
        `[stablepay] ${name} STILL ${component.status.toUpperCase()} after ${downForMin} min`,
        `Component "${name}" has been ${component.status} for ${downForMin} min.\n\n${formatReport(report)}`,
      );
    }
    componentState.set(name, updated);
  }
}

export function startHealthAlerter() {
  console.log(`[health] alerter starting — polling every ${POLL_INTERVAL_MS / 60_000}min`);
  // Run immediately on boot so a deploy-time outage gets paged.
  runHealthCycle().catch(err => logger.error('health cycle error', err as Error));
  setInterval(() => {
    runHealthCycle().catch(err => logger.error('health cycle error', err as Error));
  }, POLL_INTERVAL_MS);
}
