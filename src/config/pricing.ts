/**
 * StablePay Pricing Configuration
 *
 * MODEL:
 * - Volume-based transaction fees for EVERYONE (1.0% → 0.8% → 0.5% → 0.3%)
 * - PRO is a feature unlock (refunds, receipts, branding, unlimited links)
 * - PRO unlocks: auto at $5k/mo volume OR $19/mo crypto subscription
 * - ENTERPRISE: custom negotiated rates + dedicated support
 *
 * BILLING:
 * - Merchants receive 100% of payments upfront
 * - Fees accumulate and are invoiced on a 30-day cycle
 * - Grace period before suspension
 */

// ─── Volume-based fee tiers (apply to ALL plans) ─────────────────────────────

export const VOLUME_TIERS = [
  { name: 'Tier 1', minVolume: 0, maxVolume: 10000, feePercent: 0.01 },        // 1.0%
  { name: 'Tier 2', minVolume: 10000, maxVolume: 50000, feePercent: 0.008 },    // 0.8%
  { name: 'Tier 3', minVolume: 50000, maxVolume: 250000, feePercent: 0.005 },   // 0.5%
  { name: 'Tier 4', minVolume: 250000, maxVolume: Infinity, feePercent: 0.003 }, // 0.3%
] as const;

// ─── Plan feature configuration ──────────────────────────────────────────────

export const PRO_AUTO_UNLOCK_VOLUME = 5000; // Auto-unlock PRO at $5k/mo
export const PRO_SUBSCRIPTION_PRICE = 19;   // $19/mo in crypto

export const PLAN_FEATURES = {
  FREE: {
    name: 'Free',
    refunds: false,
    receipts: false,
    customBranding: false,
    prioritySupport: false,
    maxPaymentLinks: 5,
    apiRateLimit: 100,       // req/hour
  },
  PRO: {
    name: 'Pro',
    refunds: true,
    receipts: true,
    customBranding: true,
    prioritySupport: true,
    maxPaymentLinks: null,   // Unlimited
    apiRateLimit: 10000,
  },
  ENTERPRISE: {
    name: 'Enterprise',
    refunds: true,
    receipts: true,
    customBranding: true,
    prioritySupport: true,
    maxPaymentLinks: null,
    apiRateLimit: 100000,
  },
} as const;

// ─── Billing configuration ───────────────────────────────────────────────────

export const BILLING_CONFIG = {
  cycleDays: 30,           // Monthly billing for everyone
  gracePeriodDays: 7,      // 7 days grace before suspension
  minInvoiceAmount: 5,     // Don't bill under $5
} as const;

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Normalize plan name — legacy STARTER/GROWTH map to current plans
 */
export function normalizePlan(plan: string): 'FREE' | 'PRO' | 'ENTERPRISE' {
  if (plan === 'ENTERPRISE') return 'ENTERPRISE';
  if (plan === 'PRO' || plan === 'GROWTH') return 'PRO';
  return 'FREE'; // FREE, STARTER, or anything else
}

/**
 * Check if merchant has PRO access (paid subscription, auto-unlocked, or enterprise)
 */
export function hasPro(plan: string, monthlyVolume: number, proExpiresAt?: Date | null): boolean {
  const normalized = normalizePlan(plan);
  if (normalized === 'PRO' || normalized === 'ENTERPRISE') return true;
  // Auto-unlock at volume threshold
  if (monthlyVolume >= PRO_AUTO_UNLOCK_VOLUME) return true;
  // Active subscription
  if (proExpiresAt && proExpiresAt > new Date()) return true;
  return false;
}

/**
 * Get features for a merchant based on their effective plan
 */
export function getFeatures(plan: string, monthlyVolume: number = 0, proExpiresAt?: Date | null) {
  if (normalizePlan(plan) === 'ENTERPRISE') return PLAN_FEATURES.ENTERPRISE;
  if (hasPro(plan, monthlyVolume, proExpiresAt)) return PLAN_FEATURES.PRO;
  return PLAN_FEATURES.FREE;
}

/**
 * Get the current volume tier based on 30-day rolling volume
 */
export function getVolumeTier(monthlyVolume: number): typeof VOLUME_TIERS[number] {
  for (let i = VOLUME_TIERS.length - 1; i >= 0; i--) {
    if (monthlyVolume >= VOLUME_TIERS[i].minVolume) {
      return VOLUME_TIERS[i];
    }
  }
  return VOLUME_TIERS[0];
}

/**
 * Get the marginal fee rate for the next dollar at this volume level
 */
export function getTransactionFeePercent(
  monthlyVolume: number,
  customFeePercent?: number | null
): number {
  if (customFeePercent !== null && customFeePercent !== undefined) {
    return customFeePercent;
  }
  return getVolumeTier(monthlyVolume).feePercent;
}

/**
 * Calculate fee using PROGRESSIVE BRACKETS (like income tax)
 *
 * First $10k → 1.0%, $10k-$50k → 0.8%, $50k-$250k → 0.5%, $250k+ → 0.3%
 * If a transaction crosses a bracket boundary, the fee is split proportionally.
 *
 * Example: volume is $8k, new order is $5k
 *   $2k at 1.0% ($8k→$10k) = $20
 *   $3k at 0.8% ($10k→$13k) = $24
 *   Total fee = $44 (effective rate 0.88%)
 */
export function calculateFee(
  amount: number,
  monthlyVolume: number,
  customFeePercent?: number | null
): number {
  // Enterprise custom rate — flat, no brackets
  if (customFeePercent !== null && customFeePercent !== undefined) {
    return amount * customFeePercent;
  }

  let remaining = amount;
  let currentVolume = monthlyVolume;
  let totalFee = 0;

  for (const tier of VOLUME_TIERS) {
    if (remaining <= 0) break;
    if (currentVolume >= tier.maxVolume) continue; // Already past this bracket

    // How much room is left in this bracket?
    const bracketRoom = tier.maxVolume - Math.max(currentVolume, tier.minVolume);
    const amountInBracket = Math.min(remaining, bracketRoom);

    totalFee += amountInBracket * tier.feePercent;
    remaining -= amountInBracket;
    currentVolume += amountInBracket;
  }

  return totalFee;
}

/**
 * Calculate effective fee rate for display purposes
 */
export function getEffectiveFeeRate(
  amount: number,
  monthlyVolume: number,
  customFeePercent?: number | null
): number {
  if (amount <= 0) return getTransactionFeePercent(monthlyVolume, customFeePercent);
  const fee = calculateFee(amount, monthlyVolume, customFeePercent);
  return fee / amount;
}

/**
 * Format fee percentage for display
 */
export function formatFeePercent(feePercent: number): string {
  return `${(feePercent * 100).toFixed(1)}%`;
}

/**
 * Check if billing is due for a merchant
 */
export function isBillingDue(
  lastBillingDate: Date,
  feesDue: number
): { due: boolean; daysOverdue: number; inGracePeriod: boolean } {
  if (feesDue < BILLING_CONFIG.minInvoiceAmount) {
    return { due: false, daysOverdue: 0, inGracePeriod: false };
  }

  const now = new Date();
  const daysSince = Math.floor((now.getTime() - lastBillingDate.getTime()) / (1000 * 60 * 60 * 24));
  const due = daysSince >= BILLING_CONFIG.cycleDays;
  const daysOverdue = Math.max(0, daysSince - BILLING_CONFIG.cycleDays);
  const inGracePeriod = daysOverdue > 0 && daysOverdue <= BILLING_CONFIG.gracePeriodDays;

  return { due, daysOverdue, inGracePeriod };
}

/**
 * Check if merchant should be suspended for unpaid fees
 */
export function shouldSuspend(lastBillingDate: Date, feesDue: number): boolean {
  const { daysOverdue } = isBillingDue(lastBillingDate, feesDue);
  return daysOverdue > BILLING_CONFIG.gracePeriodDays;
}

/**
 * Get pricing summary for a merchant
 */
export function getMerchantPricingSummary(
  plan: string,
  monthlyVolume: number,
  customFeePercent?: number | null,
  proExpiresAt?: Date | null
) {
  const volumeTier = getVolumeTier(monthlyVolume);
  const effectiveFee = getTransactionFeePercent(monthlyVolume, customFeePercent);
  const features = getFeatures(plan, monthlyVolume, proExpiresAt);
  const isPro = hasPro(plan, monthlyVolume, proExpiresAt);

  const currentTierIndex = VOLUME_TIERS.findIndex(t => t.name === volumeTier.name);
  const nextTier = VOLUME_TIERS[currentTierIndex + 1];

  // Calculate total fees using progressive brackets
  const totalBracketFees = calculateFee(monthlyVolume, 0, customFeePercent);
  const effectiveRate = monthlyVolume > 0 ? totalBracketFees / monthlyVolume : effectiveFee;

  return {
    plan: normalizePlan(plan),
    planName: features.name,
    isPro,
    volumeTier: volumeTier.name,
    currentMarginalRate: effectiveFee,
    currentMarginalDisplay: formatFeePercent(effectiveFee),
    effectiveFeePercent: effectiveRate,
    effectiveFeeDisplay: formatFeePercent(effectiveRate),
    monthlyVolume,
    isCustomRate: customFeePercent !== null && customFeePercent !== undefined,
    bracketModel: 'progressive', // Like income tax — each bracket applies only to volume in that range
    nextTier: nextTier ? {
      name: nextTier.name,
      volumeNeeded: nextTier.minVolume - monthlyVolume,
      feePercent: nextTier.feePercent,
      feeDisplay: formatFeePercent(nextTier.feePercent),
    } : null,
    features,
    proAutoUnlockAt: PRO_AUTO_UNLOCK_VOLUME,
    proSubscriptionPrice: PRO_SUBSCRIPTION_PRICE,
  };
}

// ─── Legacy compatibility ────────────────────────────────────────────────────
// Old code references these — keep them working

export interface PricingTier {
  name: string;
  monthlyFee: number;
  transactionFeePercent: number;
  monthlyVolumeLimit: number | null;
  transactionLimit: number | null;
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
    name: 'Free',
    monthlyFee: 0,
    transactionFeePercent: 0.01,
    monthlyVolumeLimit: null,
    transactionLimit: null,
    features: {
      blockchains: 7,
      refunds: false,
      webhooks: true,
      prioritySupport: false,
      customBranding: false,
      apiRateLimit: 100,
    },
  },
  PRO: {
    name: 'Pro',
    monthlyFee: 19,
    transactionFeePercent: 0.01, // Same volume-based fees
    monthlyVolumeLimit: null,
    transactionLimit: null,
    features: {
      blockchains: 7,
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
    transactionFeePercent: 0.003,
    monthlyVolumeLimit: null,
    transactionLimit: null,
    features: {
      blockchains: 7,
      refunds: true,
      webhooks: true,
      prioritySupport: true,
      customBranding: true,
      apiRateLimit: 100000,
    },
  },
  // Legacy aliases
  STARTER: {
    name: 'Free',
    monthlyFee: 0,
    transactionFeePercent: 0.01,
    monthlyVolumeLimit: null,
    transactionLimit: null,
    features: {
      blockchains: 7,
      refunds: false,
      webhooks: true,
      prioritySupport: false,
      customBranding: false,
      apiRateLimit: 100,
    },
  },
  GROWTH: {
    name: 'Pro',
    monthlyFee: 19,
    transactionFeePercent: 0.01,
    monthlyVolumeLimit: null,
    transactionLimit: null,
    features: {
      blockchains: 7,
      refunds: true,
      webhooks: true,
      prioritySupport: true,
      customBranding: true,
      apiRateLimit: 10000,
    },
  },
};

// Legacy functions
export function getBillingConfig(_plan: string) {
  return {
    name: 'Standard',
    billingCycleDays: BILLING_CONFIG.cycleDays,
    gracePeriodDays: BILLING_CONFIG.gracePeriodDays,
    minInvoiceAmount: BILLING_CONFIG.minInvoiceAmount,
  };
}

export function getAccountFeatures(plan: string) {
  return getFeatures(plan);
}

export function getMonthlyBill(
  _plan: string,
  transactionVolume: number,
  customFeePercent?: number | null
): { monthlyFee: number; transactionFees: number; total: number } {
  const fee = calculateFee(transactionVolume, transactionVolume, customFeePercent);
  return { monthlyFee: 0, transactionFees: fee, total: fee };
}

export function canProcessPayment(
  _plan: string,
  _currentVolume: number,
  _orderAmount: number,
): { allowed: boolean; reason?: string; upgradeRequired?: boolean } {
  return { allowed: true }; // No volume limits — everyone can process
}
