import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { PRICING_TIERS } from '../config/pricing';
import { logger } from '../utils/logger';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory rate limit store (consider Redis for production multi-instance deployments)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 10 * 60 * 1000);

export interface RateLimitOptions {
  /**
   * Function to extract merchant ID from request
   * Return null for unauthenticated requests
   */
  getMerchantId: (req: Request) => Promise<string | null>;

  /**
   * Whether to apply rate limiting to unauthenticated requests
   * Default: false (only limit authenticated merchants)
   */
  limitAnonymous?: boolean;

  /**
   * Rate limit for anonymous requests (requests per hour)
   * Default: 20
   */
  anonymousLimit?: number;
}

/**
 * Rate limiting middleware that enforces tier-based API limits
 *
 * FREE: 100 req/hour
 * STARTER: 1,000 req/hour
 * PRO: 10,000 req/hour
 * ENTERPRISE: 100,000 req/hour
 *
 * @example
 * router.get('/orders', rateLimit({
 *   getMerchantId: async (req) => req.query.merchantId as string
 * }), async (req, res) => { ... });
 */
export function rateLimit(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const merchantId = await options.getMerchantId(req);

      // Handle unauthenticated requests
      if (!merchantId) {
        if (!options.limitAnonymous) {
          return next();
        }

        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const anonymousLimit = options.anonymousLimit || 20;
        const allowed = await checkRateLimit(`anon:${ip}`, anonymousLimit);

        if (!allowed) {
          logger.warn('Anonymous rate limit exceeded', {
            ip,
            endpoint: req.path,
            method: req.method,
            event: 'ratelimit.exceeded'
          });

          return res.status(429).json({
            error: 'Rate limit exceeded',
            message: 'Too many requests. Please try again later or sign up for higher limits.',
            retryAfter: 3600, // 1 hour in seconds
            upgradeUrl: '/signup.html'
          });
        }

        return next();
      }

      // Get merchant's plan and rate limit
      const merchant = await db.merchant.findUnique({
        where: { id: merchantId },
        select: { plan: true, companyName: true },
      });

      if (!merchant) {
        logger.warn('Rate limit check for non-existent merchant', {
          merchantId,
          endpoint: req.path,
          event: 'ratelimit.invalid_merchant'
        });
        return res.status(404).json({ error: 'Merchant not found' });
      }

      const plan = merchant.plan || 'FREE';
      const tier = PRICING_TIERS[plan];
      const limit = tier.features.apiRateLimit;

      // Check rate limit
      const allowed = await checkRateLimit(`merchant:${merchantId}`, limit);

      if (!allowed) {
        logger.tierLimitExceeded(merchantId, plan, 'apiRateLimit');

        // Add rate limit headers
        res.setHeader('X-RateLimit-Limit', limit.toString());
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', getResetTime(merchantId).toString());

        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: `Your ${tier.name} plan is limited to ${limit} requests per hour. Upgrade for higher limits.`,
          currentPlan: plan,
          currentLimit: limit,
          retryAfter: 3600,
          upgradeRequired: true,
          upgradeUrl: '/pricing.html'
        });
      }

      // Add rate limit info to headers
      const entry = rateLimitStore.get(`merchant:${merchantId}`);
      if (entry) {
        res.setHeader('X-RateLimit-Limit', limit.toString());
        res.setHeader('X-RateLimit-Remaining', (limit - entry.count).toString());
        res.setHeader('X-RateLimit-Reset', entry.resetTime.toString());
      }

      next();
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      logger.error('Rate limit middleware error', err, {
        endpoint: req.path,
        method: req.method
      });

      // Fail open - don't block requests on rate limit errors
      next();
    }
  };
}

/**
 * Check if a key is within its rate limit
 * Returns true if allowed, false if exceeded
 */
async function checkRateLimit(key: string, limit: number): Promise<boolean> {
  const now = Date.now();
  const hourInMs = 60 * 60 * 1000;

  const entry = rateLimitStore.get(key);

  if (!entry) {
    // First request in this hour
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + hourInMs,
    });
    return true;
  }

  // Check if hour has passed
  if (now > entry.resetTime) {
    // Reset counter
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + hourInMs,
    });
    return true;
  }

  // Within the hour - check limit
  if (entry.count >= limit) {
    return false;
  }

  // Increment counter
  entry.count++;
  return true;
}

/**
 * Get the timestamp when rate limit will reset for a merchant
 */
function getResetTime(merchantId: string): number {
  const entry = rateLimitStore.get(`merchant:${merchantId}`);
  return entry?.resetTime || Date.now() + (60 * 60 * 1000);
}

/**
 * Get current rate limit status for a merchant (for dashboard display)
 */
export async function getRateLimitStatus(merchantId: string): Promise<{
  limit: number;
  used: number;
  remaining: number;
  resetTime: number;
  plan: string;
}> {
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: { plan: true },
  });

  const plan = merchant?.plan || 'FREE';
  const tier = PRICING_TIERS[plan];
  const limit = tier.features.apiRateLimit;

  const entry = rateLimitStore.get(`merchant:${merchantId}`);
  const used = entry?.count || 0;
  const resetTime = entry?.resetTime || Date.now() + (60 * 60 * 1000);

  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetTime,
    plan,
  };
}
