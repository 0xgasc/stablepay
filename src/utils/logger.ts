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
  }

  security(message: string, context?: LogContext) {
    this.log(LogLevel.SECURITY, message, context);
  }

  // Convenience methods for common operations
  orderCreated(orderId: string, merchantId: string | null, amount: number, chain: string) {
    this.info('Order created', {
      orderId,
      merchantId,
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
