import { Request } from 'express';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  SECURITY = 'SECURITY'
}

interface LogContext {
  merchantId?: string;
  orderId?: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  endpoint?: string;
  method?: string;
  [key: string]: any;
}

class Logger {
  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error) {
    const logEntry = {
      timestamp: this.formatTimestamp(),
      level,
      message,
      ...context,
      ...(error && {
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        }
      })
    };

    // In production, send to logging service (Datadog, Sentry, etc.)
    // For now, structured console logging
    const logString = JSON.stringify(logEntry);

    switch (level) {
      case LogLevel.ERROR:
      case LogLevel.SECURITY:
        console.error(logString);
        break;
      case LogLevel.WARN:
        console.warn(logString);
        break;
      default:
        console.log(logString);
    }
  }

  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === 'development') {
      this.log(LogLevel.DEBUG, message, context);
    }
  }

  info(message: string, context?: LogContext) {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext) {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error, context?: LogContext) {
    this.log(LogLevel.ERROR, message, context, error);
    // Mirror to Sentry when configured, BUT demote known-transient infra errors to
    // warning level so Sentry doesn't keep paging on the same Supabase pool / RPC
    // hiccups that auto-recover. The retry queue handles them. Real bugs still page.
    try {
      const { reportError, reportMessage } = require('./sentry');
      const errMsg = (error?.message || '') + ' ' + ((error as any)?.cause?.message || '');
      const isTransientInfra =
        // Prisma DB-can't-reach (Supabase recycling, Railway proxy hiccup)
        /Can't reach database server|Timed out fetching a new connection from the connection pool|connection pool|connection (closed|reset|terminated)/i.test(errMsg) ||
        // Webhook fetch transport errors (merchant endpoint dropped, our timeout, network)
        error?.name === 'AbortError' ||
        /SocketError|other side closed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|fetch failed/i.test(errMsg);
      if (isTransientInfra) {
        // Send as warning, not error — visible in Sentry but won't trigger the high-priority alert path
        reportMessage('warning', message, { ...context, transient: true, errorClass: error?.name, errorMessage: errMsg.slice(0, 200) });
      } else if (error) {
        reportError(error, { message, ...context });
      } else {
        reportMessage('error', message, context);
      }
    } catch { /* sentry not configured / not installed — fine */ }
  }

  security(message: string, context?: LogContext) {
    this.log(LogLevel.SECURITY, message, context);
    try {
      const { reportMessage } = require('./sentry');
      reportMessage('warning', `[security] ${message}`, context);
    } catch { /* swallow */ }
  }

  // Convenience methods for common operations
  orderCreated(orderId: string, merchantId: string | null | undefined, amount: number, chain: string) {
    this.info('Order created', {
      orderId,
      merchantId: merchantId || undefined,
      amount,
      chain,
      event: 'order.created'
    });
  }

  orderConfirmed(orderId: string, txHash: string, amount: number) {
    this.info('Order confirmed', {
      orderId,
      txHash,
      amount,
      event: 'order.confirmed'
    });
  }

  refundCreated(refundId: string, orderId: string, amount: number, reason: string) {
    this.info('Refund created', {
      refundId,
      orderId,
      amount,
      reason,
      event: 'refund.created'
    });
  }

  tierLimitExceeded(merchantId: string, plan: string, feature: string) {
    this.warn('Tier limit exceeded', {
      merchantId,
      plan,
      feature,
      event: 'tier.limit_exceeded'
    });
  }

  tierUpgrade(merchantId: string, fromPlan: string, toPlan: string) {
    this.info('Tier upgraded', {
      merchantId,
      fromPlan,
      toPlan,
      event: 'tier.upgraded'
    });
  }

  unauthorizedAccess(endpoint: string, ip: string, reason: string) {
    this.security('Unauthorized access attempt', {
      endpoint,
      ip,
      reason,
      event: 'security.unauthorized'
    });
  }

  suspiciousActivity(merchantId: string, activity: string, details: any) {
    this.security('Suspicious activity detected', {
      merchantId,
      activity,
      details,
      event: 'security.suspicious'
    });
  }

  extractRequestContext(req: Request): LogContext {
    return {
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent'),
      endpoint: req.path,
      method: req.method,
      merchantId: (req as any).merchant?.id
    };
  }
}

export const logger = new Logger();
