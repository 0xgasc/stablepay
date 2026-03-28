import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  merchant: {
    id: string;
    email: string;
    companyName: string;
    plan: string;
    isSuspended: boolean;
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
