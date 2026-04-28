/**
 * Sentry init. Opt-in via SENTRY_DSN env var — when unset, every public function below
 * becomes a no-op so dev environments don't need any Sentry config.
 *
 * Why we have this: logger.error currently writes to Railway/Vercel logs that nobody reads.
 * The UnlockRiver and One Tease incidents both produced log lines we never noticed until a
 * customer complained. Sentry alerts on the first occurrence of every distinct error, so the
 * gap between "something broke" and "we know about it" closes from days to seconds.
 */
import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry(serviceName: 'web' | 'scanner') {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return; // opt-in: silent no-op when DSN not configured
  if (initialized) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'production',
    serverName: serviceName,
    // Lightweight defaults — no profiling, no perf, no PII. Errors only.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  initialized = true;
  console.log(`[sentry] enabled for ${serviceName}`);
}

export function reportError(error: Error, context?: Record<string, any>) {
  if (!initialized) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch { /* never let telemetry break the request path */ }
}

export function reportMessage(level: 'warning' | 'error', message: string, context?: Record<string, any>) {
  if (!initialized) return;
  try {
    Sentry.captureMessage(message, { level, extra: context });
  } catch { /* swallow */ }
}
