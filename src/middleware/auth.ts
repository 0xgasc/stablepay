import { Request, Response, NextFunction } from 'express';
import { Decimal } from '@prisma/client/runtime/library';
import { db } from '../config/database';
import { logger } from '../utils/logger';
import { hasPro } from '../config/pricing';

export interface AuthenticatedRequest extends Request {
  merchant: {
    id: string;
    email: string;
    companyName: string;
    plan: string;
    isSuspended: boolean;
    monthlyVolumeUsed?: Decimal;
    proExpiresAt?: Date | null;
  };
}

/**
 * Middleware: require a valid merchant Bearer token.
 * Also supports ?token=X query param for backward compat (dashboard).
 * Attaches req.merchant on success.
 */
export async function requireMerchantAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // Extract token from Authorization header or query param
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const queryToken = req.query.token as string | undefined;
    const token = bearerToken || queryToken;

    if (!token) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const merchant = await db.merchant.findFirst({
      where: { loginToken: token },
      select: {
        id: true,
        email: true,
        companyName: true,
        plan: true,
        isSuspended: true,
        tokenExpiresAt: true,
        monthlyVolumeUsed: true,
        proExpiresAt: true,
      },
    });

    if (!merchant) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (merchant.tokenExpiresAt && new Date() > merchant.tokenExpiresAt) {
      return res.status(401).json({ error: 'Token expired' });
    }

    if (merchant.isSuspended) {
      return res.status(403).json({ error: 'Account suspended' });
    }

    (req as AuthenticatedRequest).merchant = merchant;
    next();
  } catch (error) {
    logger.error('Auth middleware error', error as Error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Middleware: require PRO plan access.
 * Must be used AFTER requireMerchantAuth.
 * Checks plan, volume auto-unlock, and subscription.
 */
export function requirePro(feature: string = 'This feature') {
  return (req: Request, res: Response, next: NextFunction) => {
    const merchant = (req as AuthenticatedRequest).merchant;
    if (!merchant) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const volume = Number(merchant.monthlyVolumeUsed || 0);
    const isPro = hasPro(merchant.plan, volume, merchant.proExpiresAt || null);

    if (!isPro) {
      return res.status(403).json({
        error: `${feature} requires PRO`,
        message: `${feature} is available on the PRO plan. Upgrade for $19/mo or reach $5k monthly volume to unlock automatically.`,
        upgradeRequired: true,
        currentPlan: merchant.plan,
        currentVolume: volume,
        proAutoUnlockAt: 5000,
      });
    }

    next();
  };
}
