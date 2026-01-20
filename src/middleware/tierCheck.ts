import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { getAccountFeatures, getVolumeTier, getTransactionFeePercent, VOLUME_TIERS } from '../config/pricing';

export interface TierCheckOptions {
  feature: 'refunds' | 'webhooks' | 'customBranding' | 'prioritySupport';
  getMerchantId: (req: Request) => Promise<string | null>;
}

/**
 * Middleware to check if merchant's account allows access to a specific feature
 * All features available to all paying customers (STARTER, PRO, ENTERPRISE)
 * FREE tier has limited features for testing
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
      const features = getAccountFeatures(plan);

      // Check if feature is available
      const featureAvailable = (features as any)[options.feature];

      if (!featureAvailable) {
        return res.status(403).json({
          error: 'Feature not available',
          message: `${options.feature} is not available in Test Mode. Switch to mainnet to access this feature.`,
          upgradeRequired: true,
          currentPlan: plan,
          requiredFeature: options.feature,
          upgradeUrl: '/pricing.html'
        });
      }

      // Feature available, add merchant info to request
      (req as any).merchant = merchant;
      (req as any).features = features;

      next();
    } catch (error) {
      console.error('Tier check middleware error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to verify permissions'
      });
    }
  };
}

/**
 * All chains are available to all tiers
 */
export async function checkMultiChainAccess(
  merchantId: string,
  requestedChain: string
): Promise<{ allowed: boolean; reason?: string; upgradeRequired?: boolean }> {
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: { plan: true }
  });

  if (!merchant) {
    return { allowed: false, reason: 'Merchant not found' };
  }

  // All chains available to all tiers in the new model
  return { allowed: true };
}

/**
 * Get merchant pricing information including current fee rate
 */
export async function getMerchantTier(merchantId: string) {
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: {
      plan: true,
      monthlyVolumeUsed: true,
      monthlyTransactions: true,
      mainnetVolumeUsed: true,
      mainnetTransactions: true,
      billingCycleStart: true,
      customFeePercent: true
    }
  });

  if (!merchant) {
    return null;
  }

  const plan = merchant.plan || 'FREE';
  const monthlyVolume = parseFloat(merchant.monthlyVolumeUsed.toString());
  const volumeTier = getVolumeTier(monthlyVolume);
  const customFee = merchant.customFeePercent ? parseFloat(merchant.customFeePercent.toString()) : null;
  const currentFeePercent = getTransactionFeePercent(monthlyVolume, customFee);

  return {
    plan,
    volumeTier: volumeTier.name,
    currentFeePercent,
    isCustomRate: customFee !== null,
    usage: {
      volume: monthlyVolume,
      transactions: merchant.monthlyTransactions,
      mainnetVolume: parseFloat(merchant.mainnetVolumeUsed.toString()),
      mainnetTransactions: merchant.mainnetTransactions,
      billingCycleStart: merchant.billingCycleStart
    },
    nextTier: VOLUME_TIERS.find(t => t.minVolume > monthlyVolume) || null
  };
}
