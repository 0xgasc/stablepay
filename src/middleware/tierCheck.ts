import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { PRICING_TIERS } from '../config/pricing';

export interface TierCheckOptions {
  feature: 'refunds' | 'webhooks' | 'customBranding' | 'prioritySupport';
  getMerchantId: (req: Request) => Promise<string | null>;
}

/**
 * Middleware to check if merchant's tier allows access to a specific feature
 * Returns 403 with upgrade prompt if feature not available on current tier
 */
export function requireTierFeature(options: TierCheckOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const merchantId = await options.getMerchantId(req);

      if (!merchantId) {
        return res.status(401).json({
          error: 'Authentication required',
          message: 'Please log in to access this feature'
        });
      }

      const merchant = await db.merchant.findUnique({
        where: { id: merchantId },
        select: {
          id: true,
          plan: true,
          companyName: true,
          email: true
        }
      });

      if (!merchant) {
        return res.status(404).json({
          error: 'Merchant not found'
        });
      }

      const plan = merchant.plan || 'FREE';
      const tier = PRICING_TIERS[plan];

      if (!tier) {
        return res.status(500).json({
          error: 'Invalid pricing tier configuration'
        });
      }

      // Check if feature is available on current tier
      const featureAvailable = tier.features[options.feature];

      if (!featureAvailable) {
        const requiredPlans = Object.entries(PRICING_TIERS)
          .filter(([_, t]) => t.features[options.feature])
          .map(([planName, _]) => planName);

        return res.status(403).json({
          error: 'Feature not available',
          message: `${options.feature} is not available on ${tier.name} plan. Upgrade to access this feature.`,
          upgradeRequired: true,
          currentPlan: plan,
          requiredFeature: options.feature,
          availableOnPlans: requiredPlans,
          upgradeUrl: '/pricing.html'
        });
      }

      // Feature available, add merchant info to request for downstream use
      (req as any).merchant = merchant;
      (req as any).tier = tier;

      next();
    } catch (error) {
      console.error('Tier check middleware error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to verify tier permissions'
      });
    }
  };
}

/**
 * Middleware to check if merchant can use multi-chain (FREE tier limited to 1)
 */
export async function checkMultiChainAccess(
  merchantId: string,
  requestedChain: string
): Promise<{ allowed: boolean; reason?: string; upgradeRequired?: boolean }> {
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: {
      plan: true,
      wallets: {
        select: { chain: true, isActive: true }
      }
    }
  });

  if (!merchant) {
    return { allowed: false, reason: 'Merchant not found' };
  }

  const plan = merchant.plan || 'FREE';
  const tier = PRICING_TIERS[plan];

  if (!tier) {
    return { allowed: false, reason: 'Invalid tier' };
  }

  // If unlimited blockchains, allow
  if (tier.features.blockchains === 6) {
    return { allowed: true };
  }

  // For FREE tier (1 blockchain limit)
  const activeWallets = merchant.wallets.filter(w => w.isActive);
  const activeChains = new Set(activeWallets.map(w => w.chain));

  // If no active wallets yet, allow first blockchain
  if (activeChains.size === 0) {
    return { allowed: true };
  }

  // If requesting same blockchain as existing, allow
  if (activeChains.has(requestedChain as any)) {
    return { allowed: true };
  }

  // If trying to add second blockchain on FREE tier
  if (activeChains.size >= tier.features.blockchains) {
    return {
      allowed: false,
      reason: `Your ${tier.name} plan is limited to ${tier.features.blockchains} blockchain. Upgrade to STARTER for multi-chain support.`,
      upgradeRequired: true
    };
  }

  return { allowed: true };
}

/**
 * Get merchant plan tier information
 */
export async function getMerchantTier(merchantId: string) {
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: {
      plan: true,
      monthlyVolumeUsed: true,
      monthlyTransactions: true,
      billingCycleStart: true
    }
  });

  if (!merchant) {
    return null;
  }

  const plan = merchant.plan || 'FREE';
  const tier = PRICING_TIERS[plan];

  return {
    plan,
    tier,
    usage: {
      volume: parseFloat(merchant.monthlyVolumeUsed.toString()),
      transactions: merchant.monthlyTransactions,
      billingCycleStart: merchant.billingCycleStart
    }
  };
}
