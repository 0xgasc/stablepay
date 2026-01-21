/**
 * StablePay Pricing Configuration
 *
 * SIMPLE MODEL:
 * - TEST MODE (FREE): Unlimited testnet, limited mainnet for integration testing
 * - LIVE MODE: Pure transaction fees, volume-based tier discounts (automatic)
 * - ENTERPRISE: Custom negotiated rates
 *
 * BILLING MODEL:
 * - Merchants receive 100% of payments upfront
 * - Fees accumulate and are invoiced based on plan billing cycle
 * - Higher tiers get longer billing cycles (monthly vs weekly)
 *
 * NO SUBSCRIPTIONS. Just transaction fees that scale with volume.
 */

// Plan-based configuration with billing cycles
export const PLAN_CONFIG = {
  FREE: {
    name: 'Free',
    description: 'Test mode - unlimited testnet',
    feePercent: 0.005,           // 0.5%
    volumeLimit: null,           // Testnet unlimited
    billingCycleDays: null,      // No billing (testnet only)
    gracePeriodDays: null,
    minInvoiceAmount: null,
  },
  STARTER: {
    name: 'Starter',
    description: 'Up to $10k/month',
    feePercent: 0.01,            // 1.0%
    volumeLimit: 10000,
    billingCycleDays: 7,         // Weekly billing
    gracePeriodDays: 3,
    minInvoiceAmount: 5,         // Don't bill under $5
  },
  GROWTH: {
    name: 'Growth',
    description: 'Up to $50k/month',
    feePercent: 0.008,           // 0.8%
    volumeLimit: 50000,
    billingCycleDays: 14,        // Bi-weekly billing
    gracePeriodDays: 5,
    minInvoiceAmount: 10,
  },
  PRO: {
    name: 'Pro',
    description: 'Up to $250k/month',
    feePercent: 0.005,           // 0.5%
    volumeLimit: 250000,
    billingCycleDays: 30,        // Monthly billing
    gracePeriodDays: 7,
    minInvoiceAmount: 25,
  },
  ENTERPRISE: {
    name: 'Enterprise',
    description: 'Unlimited volume',
    feePercent: 0.003,           // 0.3% (or custom)
    volumeLimit: null,           // Unlimited
    billingCycleDays: 30,        // Monthly (or Net-30)
    gracePeriodDays: 14,
    minInvoiceAmount: 50,
  },
} as const;

export type PlanConfigType = keyof typeof PLAN_CONFIG;

/**
 * Get billing cycle configuration for a plan
 */
export function getBillingConfig(plan: string) {
  const config = PLAN_CONFIG[plan as PlanConfigType];
  if (!config) {
    return PLAN_CONFIG.STARTER; // Default to STARTER
  }
  return config;
}

/**
 * Check if billing is due for a merchant
 */
export function isBillingDue(
  plan: string,
  lastBillingDate: Date,
  feesDue: number
): { due: boolean; daysOverdue: number; inGracePeriod: boolean } {
  const config = getBillingConfig(plan);

  // FREE plan has no billing
  if (!config.billingCycleDays) {
    return { due: false, daysOverdue: 0, inGracePeriod: false };
  }

  // Check if minimum threshold met
  if (config.minInvoiceAmount && feesDue < config.minInvoiceAmount) {
    return { due: false, daysOverdue: 0, inGracePeriod: false };
  }

  const now = new Date();
  const daysSinceLastBilling = Math.floor(
    (now.getTime() - lastBillingDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const due = daysSinceLastBilling >= config.billingCycleDays;
  const daysOverdue = Math.max(0, daysSinceLastBilling - config.billingCycleDays);
  const inGracePeriod = daysOverdue > 0 && daysOverdue <= (config.gracePeriodDays || 0);

  return { due, daysOverdue, inGracePeriod };
}

/**
 * Check if merchant should be suspended for unpaid fees
 */
export function shouldSuspend(
  plan: string,
  lastBillingDate: Date,
  feesDue: number
): boolean {
  const config = getBillingConfig(plan);

  if (!config.billingCycleDays || !config.gracePeriodDays) {
    return false;
  }

  // Must meet minimum threshold
  if (config.minInvoiceAmount && feesDue < config.minInvoiceAmount) {
    return false;
  }

  const { daysOverdue } = isBillingDue(plan, lastBillingDate, feesDue);
  return daysOverdue > config.gracePeriodDays;
}

// Volume-based fee tiers (for automatic tier progression display)
export const VOLUME_TIERS = [
  { name: 'Starter', minVolume: 0, maxVolume: 10000, feePercent: 0.01, plan: 'STARTER' },
  { name: 'Growth', minVolume: 10000, maxVolume: 50000, feePercent: 0.008, plan: 'GROWTH' },
  { name: 'Pro', minVolume: 50000, maxVolume: 250000, feePercent: 0.005, plan: 'PRO' },
  { name: 'Enterprise', minVolume: 250000, maxVolume: Infinity, feePercent: 0.003, plan: 'ENTERPRISE' },
] as const;

// Test mode limits (FREE plan)
export const TEST_MODE_LIMITS = {
  testnet: {
    volumeLimit: null,      // Unlimited
    transactionLimit: null, // Unlimited
  },
  mainnet: {
    volumeLimit: 100,       // $100 to verify integration works
    transactionLimit: 10,   // 10 transactions
  },
};

// Feature availability by account type
export const ACCOUNT_FEATURES = {
  // FREE = Test mode (everyone starts here)
  FREE: {
    name: 'Test Mode',
    allChains: true,       // All chains available for testing
    refunds: true,         // Test the full flow
    webhooks: true,        // Essential for integration
    customBranding: false, // Upgrade incentive
    prioritySupport: false,
    apiRateLimit: 100,     // 100 req/hour
  },
  // STARTER, PRO = Active accounts (legacy enum values, treated same)
  ACTIVE: {
    name: 'Live',
    allChains: true,
    refunds: true,
    webhooks: true,
    customBranding: true,
    prioritySupport: false,
    apiRateLimit: 10000,   // 10,000 req/hour
  },
  // ENTERPRISE = Custom rates
  ENTERPRISE: {
    name: 'Enterprise',
    allChains: true,
    refunds: true,
    webhooks: true,
    customBranding: true,
    prioritySupport: true,
    apiRateLimit: 100000,  // 100,000 req/hour
  },
};

/**
 * Get the current volume tier based on 30-day rolling volume
 */
export function getVolumeTier(monthlyVolume: number): typeof VOLUME_TIERS[number] {
  // Find the tier that matches the current volume
  for (let i = VOLUME_TIERS.length - 1; i >= 0; i--) {
    if (monthlyVolume >= VOLUME_TIERS[i].minVolume) {
      return VOLUME_TIERS[i];
    }
  }
  return VOLUME_TIERS[0]; // Default to Starter
}

/**
 * Calculate transaction fee based on volume tier OR custom enterprise rate
 */
export function getTransactionFeePercent(
  monthlyVolume: number,
  customFeePercent?: number | null
): number {
  // Enterprise custom rate takes precedence
  if (customFeePercent !== null && customFeePercent !== undefined) {
    return customFeePercent;
  }

  // Otherwise, use volume-based tier
  const tier = getVolumeTier(monthlyVolume);
  return tier.feePercent;
}

/**
 * Calculate fee amount for a transaction
 */
export function calculateFee(
  amount: number,
  monthlyVolume: number,
  customFeePercent?: number | null
): number {
  const feePercent = getTransactionFeePercent(monthlyVolume, customFeePercent);
  return amount * feePercent;
}

/**
 * Check if merchant can process a payment (test mode limits)
 */
export function canProcessPayment(
  plan: string,
  currentVolume: number,
  orderAmount: number,
  networkMode?: 'TESTNET' | 'MAINNET',
  currentTransactions?: number
): { allowed: boolean; reason?: string; upgradeRequired?: boolean } {
  // STARTER, PRO, ENTERPRISE = no limits (they're paying customers)
  if (plan !== 'FREE') {
    return { allowed: true };
  }

  // FREE tier = Test Mode with limits
  if (networkMode === 'TESTNET') {
    // Testnet is unlimited for testing
    return { allowed: true };
  }

  // Mainnet limits for FREE tier
  const limits = TEST_MODE_LIMITS.mainnet;
  const newVolume = currentVolume + orderAmount;
  const newTxCount = (currentTransactions || 0) + 1;

  if (newTxCount > limits.transactionLimit) {
    return {
      allowed: false,
      reason: `Test mode limit reached (${limits.transactionLimit} mainnet transactions). Go live to continue accepting payments.`,
      upgradeRequired: true,
    };
  }

  if (newVolume > limits.volumeLimit) {
    return {
      allowed: false,
      reason: `Test mode limit reached ($${limits.volumeLimit} mainnet volume). Go live to continue accepting payments.`,
      upgradeRequired: true,
    };
  }

  return { allowed: true };
}

/**
 * Get account features based on plan
 * Maps legacy STARTER/PRO to ACTIVE
 */
export function getAccountFeatures(plan: string) {
  if (plan === 'FREE') {
    return ACCOUNT_FEATURES.FREE;
  }
  if (plan === 'ENTERPRISE') {
    return ACCOUNT_FEATURES.ENTERPRISE;
  }
  // STARTER, PRO = ACTIVE
  return ACCOUNT_FEATURES.ACTIVE;
}

/**
 * Format fee percentage for display
 */
export function formatFeePercent(feePercent: number): string {
  return `${(feePercent * 100).toFixed(1)}%`;
}

/**
 * Get pricing summary for a merchant
 */
export function getMerchantPricingSummary(
  plan: string,
  monthlyVolume: number,
  customFeePercent?: number | null
) {
  const volumeTier = getVolumeTier(monthlyVolume);
  const effectiveFee = getTransactionFeePercent(monthlyVolume, customFeePercent);
  const features = getAccountFeatures(plan);

  // Calculate volume needed for next tier
  const currentTierIndex = VOLUME_TIERS.findIndex(t => t.name === volumeTier.name);
  const nextTier = VOLUME_TIERS[currentTierIndex + 1];

  return {
    plan,
    planName: features.name,
    volumeTier: volumeTier.name,
    currentFeePercent: effectiveFee,
    currentFeeDisplay: formatFeePercent(effectiveFee),
    monthlyVolume,
    isCustomRate: customFeePercent !== null && customFeePercent !== undefined,
    nextTier: nextTier ? {
      name: nextTier.name,
      volumeNeeded: nextTier.minVolume - monthlyVolume,
      feePercent: nextTier.feePercent,
      feeDisplay: formatFeePercent(nextTier.feePercent),
    } : null,
    features,
  };
}

// ============================================================================
// LEGACY COMPATIBILITY
// Keep PRICING_TIERS for any code that still references it
// ============================================================================

export interface PricingTier {
  name: string;
  monthlyFee: number;
  transactionFeePercent: number;
  monthlyVolumeLimit: number | null;
  transactionLimit: number | null;
  testnetLimits?: {
    volumeLimit: number | null;
    transactionLimit: number | null;
  };
  mainnetLimits?: {
    volumeLimit: number;
    transactionLimit: number;
  };
  features: {
    blockchains: number;
    refunds: boolean;
    webhooks: boolean;
    prioritySupport: boolean;
    customBranding: boolean;
    apiRateLimit: number;
  };
}

export const PRICING_TIERS: Record<string, PricingTier> = {
  FREE: {
    name: 'Test Mode',
    monthlyFee: 0,
    transactionFeePercent: 0.005, // 0.5%
    monthlyVolumeLimit: null,
    transactionLimit: null,
    testnetLimits: {
      volumeLimit: null,
      transactionLimit: null,
    },
    mainnetLimits: {
      volumeLimit: TEST_MODE_LIMITS.mainnet.volumeLimit,
      transactionLimit: TEST_MODE_LIMITS.mainnet.transactionLimit,
    },
    features: {
      blockchains: 10,
      refunds: true,
      webhooks: true,
      prioritySupport: false,
      customBranding: false,
      apiRateLimit: 100,
    },
  },
  STARTER: {
    name: 'Live',
    monthlyFee: 0, // No subscription!
    transactionFeePercent: 0.005, // 0.5% (Starter tier)
    monthlyVolumeLimit: null, // Unlimited
    transactionLimit: null,
    features: {
      blockchains: 10,
      refunds: true,
      webhooks: true,
      prioritySupport: false,
      customBranding: true,
      apiRateLimit: 10000,
    },
  },
  PRO: {
    name: 'Live',
    monthlyFee: 0, // No subscription!
    transactionFeePercent: 0.003, // 0.3% (Scale tier equivalent)
    monthlyVolumeLimit: null,
    transactionLimit: null,
    features: {
      blockchains: 10,
      refunds: true,
      webhooks: true,
      prioritySupport: true,
      customBranding: true,
      apiRateLimit: 10000,
    },
  },
  ENTERPRISE: {
    name: 'Enterprise',
    monthlyFee: 0,
    transactionFeePercent: 0.002, // 0.2% default, but custom rates apply
    monthlyVolumeLimit: null,
    transactionLimit: null,
    features: {
      blockchains: 10,
      refunds: true,
      webhooks: true,
      prioritySupport: true,
      customBranding: true,
      apiRateLimit: 100000,
    },
  },
};

// Legacy function - now just returns transaction fees (no subscription)
export function getMonthlyBill(
  plan: string,
  transactionVolume: number,
  customFeePercent?: number | null
): { monthlyFee: number; transactionFees: number; total: number } {
  const fee = calculateFee(transactionVolume, transactionVolume, customFeePercent);

  return {
    monthlyFee: 0, // No subscription fees!
    transactionFees: fee,
    total: fee,
  };
}
