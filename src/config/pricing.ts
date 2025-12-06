export interface PricingTier {
  name: string;
  monthlyFee: number; // USD
  transactionFeePercent: number; // As decimal (0.5% = 0.005)
  monthlyVolumeLimit: number | null; // USD, null = unlimited
  transactionLimit: number | null; // Per month, null = unlimited
  testnetLimits?: {
    // Separate limits for testnet (only applies to FREE tier)
    volumeLimit: number | null; // null = unlimited
    transactionLimit: number | null; // null = unlimited
  };
  mainnetLimits?: {
    // Separate limits for mainnet (only applies to FREE tier)
    volumeLimit: number; // USD
    transactionLimit: number; // Number of transactions
  };
  features: {
    blockchains: number; // Number of chains allowed
    refunds: boolean;
    webhooks: boolean;
    prioritySupport: boolean;
    customBranding: boolean;
    apiRateLimit: number; // Requests per hour
  };
}

export const PRICING_TIERS: Record<string, PricingTier> = {
  FREE: {
    name: 'Free',
    monthlyFee: 0,
    transactionFeePercent: 0.005, // 0.5%
    monthlyVolumeLimit: null, // No combined limit - use testnet/mainnet specific limits
    transactionLimit: null,
    testnetLimits: {
      volumeLimit: null, // Unlimited testnet volume
      transactionLimit: null, // Unlimited testnet transactions
    },
    mainnetLimits: {
      volumeLimit: 100, // $100 mainnet volume
      transactionLimit: 10, // 10 mainnet transactions
    },
    features: {
      blockchains: 1, // Pick one blockchain - upgrade for multi-chain
      refunds: true, // Allow refunds - merchants need to test complete flow
      webhooks: true, // Allow webhooks - essential for integration testing
      prioritySupport: false, // Upgrade for faster support
      customBranding: false, // Upgrade for white-label
      apiRateLimit: 100, // 100 req/hour - sufficient for development/testing
    },
  },
  STARTER: {
    name: 'Starter',
    monthlyFee: 29,
    transactionFeePercent: 0.005, // 0.5%
    monthlyVolumeLimit: 100000, // $100,000/month
    transactionLimit: null,
    features: {
      blockchains: 10, // All 10 chains (5 chains × mainnet+testnet)
      refunds: true,
      webhooks: true,
      prioritySupport: false,
      customBranding: false,
      apiRateLimit: 1000, // 1,000 req/hour
    },
  },
  PRO: {
    name: 'Pro',
    monthlyFee: 99,
    transactionFeePercent: 0.003, // 0.3%
    monthlyVolumeLimit: null, // Unlimited
    transactionLimit: null,
    features: {
      blockchains: 10, // All 10 chains
      refunds: true,
      webhooks: true,
      prioritySupport: true,
      customBranding: true,
      apiRateLimit: 10000, // 10,000 req/hour
    },
  },
  ENTERPRISE: {
    name: 'Enterprise',
    monthlyFee: 0, // Custom pricing
    transactionFeePercent: 0.002, // 0.2% (negotiable)
    monthlyVolumeLimit: null,
    transactionLimit: null,
    features: {
      blockchains: 10, // All 10 chains
      refunds: true,
      webhooks: true,
      prioritySupport: true,
      customBranding: true,
      apiRateLimit: 100000, // 100,000 req/hour
    },
  },
};

export function canProcessPayment(
  plan: string,
  currentMonthlyVolume: number,
  orderAmount: number,
  networkMode?: 'TESTNET' | 'MAINNET',
  currentMonthlyTransactions?: number
): { allowed: boolean; reason?: string; upgradeRequired?: boolean } {
  const tier = PRICING_TIERS[plan];
  if (!tier) {
    return { allowed: false, reason: 'Invalid pricing tier' };
  }

  // Special handling for FREE tier with testnet/mainnet split
  if (plan === 'FREE' && tier.testnetLimits && tier.mainnetLimits) {
    if (networkMode === 'TESTNET') {
      // Testnet is unlimited on FREE tier
      return { allowed: true };
    } else if (networkMode === 'MAINNET') {
      // Check mainnet limits
      const newVolume = currentMonthlyVolume + orderAmount;
      const newTransactionCount = (currentMonthlyTransactions || 0) + 1;

      // Check transaction count limit
      if (newTransactionCount > tier.mainnetLimits.transactionLimit) {
        return {
          allowed: false,
          reason: `Mainnet transaction limit reached (${tier.mainnetLimits.transactionLimit} transactions). Upgrade to STARTER for $100K/month volume.`,
          upgradeRequired: true,
        };
      }

      // Check volume limit
      if (newVolume > tier.mainnetLimits.volumeLimit) {
        return {
          allowed: false,
          reason: `Mainnet volume limit reached ($${tier.mainnetLimits.volumeLimit}). Upgrade to STARTER for $100K/month volume.`,
          upgradeRequired: true,
        };
      }

      return { allowed: true };
    }
  }

  // Standard volume limit check for other tiers
  if (tier.monthlyVolumeLimit !== null) {
    const newVolume = currentMonthlyVolume + orderAmount;
    if (newVolume > tier.monthlyVolumeLimit) {
      return {
        allowed: false,
        reason: `Monthly volume limit exceeded. Upgrade to process this payment. Current: $${currentMonthlyVolume.toFixed(2)}, Limit: $${tier.monthlyVolumeLimit}`,
        upgradeRequired: true,
      };
    }
  }

  return { allowed: true };
}

export function calculateFee(plan: string, amount: number): number {
  const tier = PRICING_TIERS[plan];
  if (!tier) return 0;

  const transactionFee = amount * tier.transactionFeePercent;
  return transactionFee;
}

export function getMonthlyBill(
  plan: string,
  transactionVolume: number
): { monthlyFee: number; transactionFees: number; total: number } {
  const tier = PRICING_TIERS[plan];
  if (!tier) {
    return { monthlyFee: 0, transactionFees: 0, total: 0 };
  }

  const transactionFees = calculateFee(plan, transactionVolume);

  // For STARTER and PRO, charge whichever is greater: monthly fee or transaction fees
  if (plan === 'STARTER' || plan === 'PRO') {
    const total = Math.max(tier.monthlyFee, transactionFees);
    return {
      monthlyFee: tier.monthlyFee,
      transactionFees,
      total,
    };
  }

  // For FREE and ENTERPRISE, just charge transaction fees
  return {
    monthlyFee: tier.monthlyFee,
    transactionFees,
    total: transactionFees,
  };
}
