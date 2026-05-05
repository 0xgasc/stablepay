import { describe, it, expect } from 'vitest';
import { calculateFee, getEffectiveFeeRate, getTransactionFeePercent, VOLUME_TIERS } from '../config/pricing';

describe('Progressive Fee Brackets', () => {
  describe('calculateFee — bracket splitting', () => {
    it('applies 2.0% for small amounts within Tier 1', () => {
      const fee = calculateFee(100, 0);
      expect(fee).toBeCloseTo(2.0, 4); // $100 × 2.0% = $2.00
    });

    it('applies 2.0% for full Tier 1', () => {
      const fee = calculateFee(10000, 0);
      expect(fee).toBeCloseTo(200, 4); // $10k × 2.0% = $200
    });

    it('splits across Tier 1 and Tier 2', () => {
      // $15k at $0: $10k×2.0% + $5k×1.5% = $200 + $75 = $275
      const fee = calculateFee(15000, 0);
      expect(fee).toBeCloseTo(275, 4);
    });

    it('handles order starting mid-bracket', () => {
      // $5k at $8k volume: $2k×2.0% + $3k×1.5% = $40 + $45 = $85
      const fee = calculateFee(5000, 8000);
      expect(fee).toBeCloseTo(85, 4);
    });

    it('applies correct rate when already in Tier 2', () => {
      // $10k at $20k volume (fully in Tier 2)
      const fee = calculateFee(10000, 20000);
      expect(fee).toBeCloseTo(150, 4); // $10k × 1.5% = $150
    });

    it('splits across Tier 2 and Tier 3', () => {
      // $20k at $40k volume: $10k×1.5% + $10k×1.2% = $150 + $120 = $270
      const fee = calculateFee(20000, 40000);
      expect(fee).toBeCloseTo(270, 4);
    });

    it('splits across all 4 tiers', () => {
      // $300k at $0: $10k×2.0% + $40k×1.5% + $200k×1.2% + $50k×1.0%
      // = $200 + $600 + $2400 + $500 = $3700
      const fee = calculateFee(300000, 0);
      expect(fee).toBeCloseTo(3700, 4);
    });

    it('applies Tier 4 when fully above $250k', () => {
      const fee = calculateFee(50000, 300000);
      expect(fee).toBeCloseTo(500, 4); // $50k × 1.0% = $500
    });

    it('handles zero amount', () => {
      expect(calculateFee(0, 50000)).toBe(0);
    });

    it('handles micro amounts', () => {
      const fee = calculateFee(0.005, 0);
      expect(fee).toBeCloseTo(0.0001, 6); // $0.005 × 2.0%
    });

    it('uses custom rate when provided (flat, not bracketed)', () => {
      const fee = calculateFee(10000, 0, 0.002); // Custom 0.2%
      expect(fee).toBeCloseTo(20, 4);
    });

    it('Day 1 program: flat 1% across any volume', () => {
      expect(calculateFee(10000, 0, null, true)).toBeCloseTo(100, 4);     // $10k × 1%
      expect(calculateFee(60000, 0, null, true)).toBeCloseTo(600, 4);     // No bracket math
      expect(calculateFee(300000, 0, null, true)).toBeCloseTo(3000, 4);
    });
  });

  describe('getEffectiveFeeRate', () => {
    it('returns marginal rate for zero amount', () => {
      const rate = getEffectiveFeeRate(0, 5000);
      expect(rate).toBe(0.020); // Tier 1 marginal
    });

    it('returns blended rate for cross-bracket amount', () => {
      // $15k at $0: fee = $275, effective = 275/15000 ≈ 0.01833
      const rate = getEffectiveFeeRate(15000, 0);
      expect(rate).toBeCloseTo(0.01833, 4);
    });

    it('returns exact tier rate within a single bracket', () => {
      const rate = getEffectiveFeeRate(5000, 20000); // Fully in Tier 2
      expect(rate).toBe(0.015);
    });

    it('Day 1 effective rate is always 1%', () => {
      expect(getEffectiveFeeRate(15000, 0, null, true)).toBe(0.01);
      expect(getEffectiveFeeRate(0, 0, null, true)).toBe(0.01);
    });
  });

  describe('$60k example from pricing page', () => {
    it('calculates correctly: $10k×2.0% + $40k×1.5% + $10k×1.2% = $920', () => {
      const fee = calculateFee(60000, 0);
      expect(fee).toBeCloseTo(920, 4);
    });

    it('effective rate is ~1.53%', () => {
      const rate = getEffectiveFeeRate(60000, 0);
      expect(rate).toBeCloseTo(0.01533, 4);
    });
  });
});
