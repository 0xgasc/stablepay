export interface PricingTier {
  name: string;
  monthlyFee: number; // USD
  transactionFeePercent: number; // As decimal (0.5% = 0.005)
  monthlyVolumeLimit: number | null; // USD, null = unlimited
  transactionLimit: number | null; // Per month, null = unlimited
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
    monthlyVolumeLimit: 1000, // $1,000/month
    transactionLimit: null, // Unlimited transactions within volume
    features: {
      blockchains: 1, // Pick one blockchain
      refunds: false,
      webhooks: false,
      prioritySupport: false,
      customBranding: false,
      apiRateLimit: 100, // 100 req/hour
    },
  },
  STARTER: {
    name: 'Starter',
    monthlyFee: 29,
    transactionFeePercent: 0.005, // 0.5%
    monthlyVolumeLimit: 100000, // $100,000/month
    transactionLimit: null,
    features: {
      blockchains: 6, // All blockchains
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
      blockchains: 6,
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
      blockchains: 6,
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
  orderAmount: number
): { allowed: boolean; reason?: string } {
  const tier = PRICING_TIERS[plan];
  if (!tier) {
    return { allowed: false, reason: 'Invalid pricing tier' };
  }

  // Check volume limit
  if (tier.monthlyVolumeLimit !== null) {
    const newVolume = currentMonthlyVolume + orderAmount;
    if (newVolume > tier.monthlyVolumeLimit) {
      return {
        allowed: false,
        reason: `Monthly volume limit exceeded. Upgrade to process this payment. Current: $${currentMonthlyVolume.toFixed(2)}, Limit: $${tier.monthlyVolumeLimit}`,
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
