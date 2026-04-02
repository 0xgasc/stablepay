import { describe, it, expect } from 'vitest';
import { calculateFee, getEffectiveFeeRate, getTransactionFeePercent, VOLUME_TIERS } from '../config/pricing';

describe('Progressive Fee Brackets', () => {
  describe('calculateFee — bracket splitting', () => {
    it('applies 2.5% for small amounts within Tier 1', () => {
      const fee = calculateFee(100, 0);
      expect(fee).toBeCloseTo(2.5, 4); // $100 × 2.5% = $2.50
    });

    it('applies 2.5% for full Tier 1', () => {
      const fee = calculateFee(10000, 0);
      expect(fee).toBeCloseTo(250, 4); // $10k × 2.5% = $250
    });

    it('splits across Tier 1 and Tier 2', () => {
      // $15k at $0: $10k×2.5% + $5k×2.0% = $250 + $100 = $350
      const fee = calculateFee(15000, 0);
      expect(fee).toBeCloseTo(350, 4);
    });

    it('handles order starting mid-bracket', () => {
      // $5k at $8k volume: $2k×2.5% + $3k×2.0% = $50 + $60 = $110
      const fee = calculateFee(5000, 8000);
      expect(fee).toBeCloseTo(110, 4);
    });

    it('applies correct rate when already in Tier 2', () => {
      // $10k at $20k volume (fully in Tier 2)
      const fee = calculateFee(10000, 20000);
      expect(fee).toBeCloseTo(200, 4); // $10k × 2.0% = $200
    });

    it('splits across Tier 2 and Tier 3', () => {
      // $20k at $40k volume: $10k×2.0% + $10k×1.5% = $200 + $150 = $350
      const fee = calculateFee(20000, 40000);
      expect(fee).toBeCloseTo(350, 4);
    });

    it('splits across all 4 tiers', () => {
      // $300k at $0: $10k×2.5% + $40k×2.0% + $200k×1.5% + $50k×1.0%
      // = $250 + $800 + $3000 + $500 = $4550
      const fee = calculateFee(300000, 0);
      expect(fee).toBeCloseTo(4550, 4);
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
      expect(fee).toBeCloseTo(0.000125, 6); // $0.005 × 2.5%
    });

    it('uses custom rate when provided (flat, not bracketed)', () => {
      const fee = calculateFee(10000, 0, 0.002); // Custom 0.2%
      expect(fee).toBeCloseTo(20, 4);
    });
  });

  describe('getEffectiveFeeRate', () => {
    it('returns marginal rate for zero amount', () => {
      const rate = getEffectiveFeeRate(0, 5000);
      expect(rate).toBe(0.025); // Tier 1 marginal
    });

    it('returns blended rate for cross-bracket amount', () => {
      // $15k at $0: fee = $350, effective = 350/15000 = 0.02333
      const rate = getEffectiveFeeRate(15000, 0);
      expect(rate).toBeCloseTo(0.02333, 4);
    });

    it('returns exact tier rate within a single bracket', () => {
      const rate = getEffectiveFeeRate(5000, 20000); // Fully in Tier 2
      expect(rate).toBe(0.02);
    });
  });

  describe('$60k example from pricing page', () => {
    it('calculates correctly: $10k×2.5% + $40k×2.0% + $10k×1.5% = $1200', () => {
      const fee = calculateFee(60000, 0);
      expect(fee).toBeCloseTo(1200, 4);
    });

    it('effective rate is 2.0%', () => {
      const rate = getEffectiveFeeRate(60000, 0);
      expect(rate).toBeCloseTo(0.02, 4);
    });
  });
});
