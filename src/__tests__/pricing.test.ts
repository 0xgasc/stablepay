import { describe, it, expect } from 'vitest';
import {
  getVolumeTier,
  getTransactionFeePercent,
  calculateFee,
  normalizePlan,
  hasPro,
  getFeatures,
  isBillingDue,
  shouldSuspend,
  formatFeePercent,
  VOLUME_TIERS,
  PRO_AUTO_UNLOCK_VOLUME,
} from '../config/pricing';

describe('Volume Tiers', () => {
  it('returns Tier 1 for $0 volume', () => {
    expect(getVolumeTier(0).feePercent).toBe(0.01);
  });

  it('returns Tier 1 for $9,999 volume', () => {
    expect(getVolumeTier(9999).feePercent).toBe(0.01);
  });

  it('returns Tier 2 at exactly $10,000', () => {
    expect(getVolumeTier(10000).feePercent).toBe(0.008);
  });

  it('returns Tier 3 at $50,000', () => {
    expect(getVolumeTier(50000).feePercent).toBe(0.005);
  });

  it('returns Tier 4 at $250,000', () => {
    expect(getVolumeTier(250000).feePercent).toBe(0.003);
  });

  it('returns Tier 4 for very high volume', () => {
    expect(getVolumeTier(10000000).feePercent).toBe(0.003);
  });
});

describe('Fee Calculation', () => {
  it('calculates 1% fee for $100 at $0 volume', () => {
    expect(calculateFee(100, 0)).toBe(1.0);
  });

  it('calculates 0.8% fee at $10k volume', () => {
    expect(calculateFee(100, 10000)).toBeCloseTo(0.8);
  });

  it('calculates 0.5% fee at $50k volume', () => {
    expect(calculateFee(100, 50000)).toBeCloseTo(0.5);
  });

  it('calculates 0.3% fee at $250k volume', () => {
    expect(calculateFee(100, 250000)).toBeCloseTo(0.3);
  });

  it('uses custom enterprise rate when provided', () => {
    expect(getTransactionFeePercent(0, 0.002)).toBe(0.002);
    expect(calculateFee(1000, 0, 0.002)).toBe(2.0);
  });

  it('ignores custom rate when null', () => {
    expect(getTransactionFeePercent(0, null)).toBe(0.01);
  });

  it('handles zero amount', () => {
    expect(calculateFee(0, 0)).toBe(0);
  });
});

describe('Plan Normalization', () => {
  it('maps FREE to FREE', () => {
    expect(normalizePlan('FREE')).toBe('FREE');
  });

  it('maps STARTER (legacy) to FREE', () => {
    expect(normalizePlan('STARTER')).toBe('FREE');
  });

  it('maps GROWTH (legacy) to PRO', () => {
    expect(normalizePlan('GROWTH')).toBe('PRO');
  });

  it('maps PRO to PRO', () => {
    expect(normalizePlan('PRO')).toBe('PRO');
  });

  it('maps ENTERPRISE to ENTERPRISE', () => {
    expect(normalizePlan('ENTERPRISE')).toBe('ENTERPRISE');
  });

  it('maps unknown plans to FREE', () => {
    expect(normalizePlan('UNKNOWN')).toBe('FREE');
    expect(normalizePlan('')).toBe('FREE');
  });
});

describe('PRO Access', () => {
  it('PRO plan always has PRO access', () => {
    expect(hasPro('PRO', 0)).toBe(true);
  });

  it('ENTERPRISE always has PRO access', () => {
    expect(hasPro('ENTERPRISE', 0)).toBe(true);
  });

  it('FREE with low volume has no PRO access', () => {
    expect(hasPro('FREE', 100)).toBe(false);
  });

  it('FREE auto-unlocks PRO at $5k volume', () => {
    expect(hasPro('FREE', PRO_AUTO_UNLOCK_VOLUME)).toBe(true);
  });

  it('FREE with active subscription has PRO access', () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    expect(hasPro('FREE', 0, future)).toBe(true);
  });

  it('FREE with expired subscription has no PRO access', () => {
    const past = new Date(Date.now() - 1000);
    expect(hasPro('FREE', 0, past)).toBe(false);
  });
});

describe('Feature Gating', () => {
  it('FREE plan cannot access refunds', () => {
    expect(getFeatures('FREE').refunds).toBe(false);
  });

  it('FREE plan has 5 payment link limit', () => {
    expect(getFeatures('FREE').maxPaymentLinks).toBe(5);
  });

  it('PRO plan can access refunds', () => {
    expect(getFeatures('PRO').refunds).toBe(true);
  });

  it('PRO plan has unlimited payment links', () => {
    expect(getFeatures('PRO').maxPaymentLinks).toBeNull();
  });

  it('FREE with $5k volume gets PRO features', () => {
    expect(getFeatures('FREE', 5000).refunds).toBe(true);
  });

  it('GROWTH (legacy) gets PRO features', () => {
    expect(getFeatures('GROWTH').refunds).toBe(true);
  });
});

describe('Billing', () => {
  it('billing not due when fees under minimum', () => {
    const { due } = isBillingDue(new Date(), 1); // $1 < $5 min
    expect(due).toBe(false);
  });

  it('billing not due within 30-day cycle', () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    const { due } = isBillingDue(recent, 100);
    expect(due).toBe(false);
  });

  it('billing due after 30 days', () => {
    const old = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // 35 days ago
    const { due, daysOverdue, inGracePeriod } = isBillingDue(old, 100);
    expect(due).toBe(true);
    expect(daysOverdue).toBe(5);
    expect(inGracePeriod).toBe(true); // Within 7-day grace
  });

  it('should suspend after grace period', () => {
    const veryOld = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000); // 45 days ago
    expect(shouldSuspend(veryOld, 100)).toBe(true);
  });

  it('should not suspend within grace period', () => {
    const old = new Date(Date.now() - 33 * 24 * 60 * 60 * 1000); // 33 days ago
    expect(shouldSuspend(old, 100)).toBe(false);
  });
});

describe('Format', () => {
  it('formats fee percent correctly', () => {
    expect(formatFeePercent(0.01)).toBe('1.0%');
    expect(formatFeePercent(0.008)).toBe('0.8%');
    expect(formatFeePercent(0.005)).toBe('0.5%');
    expect(formatFeePercent(0.003)).toBe('0.3%');
  });
});
