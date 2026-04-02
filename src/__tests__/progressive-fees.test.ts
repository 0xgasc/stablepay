import { describe, it, expect } from 'vitest';
import { calculateFee, getEffectiveFeeRate, getTransactionFeePercent, VOLUME_TIERS } from '../config/pricing';

describe('Progressive Fee Brackets', () => {
  describe('calculateFee — bracket splitting', () => {
    it('applies 1% for small amounts within Tier 1', () => {
      const fee = calculateFee(100, 0); // $100 at $0 volume
      expect(fee).toBeCloseTo(1.0, 4); // $100 × 1% = $1
    });

    it('applies 1% for full Tier 1', () => {
      const fee = calculateFee(10000, 0); // $10k at $0 volume
      expect(fee).toBeCloseTo(100, 4); // $10k × 1% = $100
    });

    it('splits across Tier 1 and Tier 2', () => {
      // $15k at $0 volume: $10k×1% + $5k×0.8% = $100 + $40 = $140
      const fee = calculateFee(15000, 0);
      expect(fee).toBeCloseTo(140, 4);
    });

    it('handles order starting mid-bracket', () => {
      // $5k at $8k volume: $2k×1% (filling Tier 1) + $3k×0.8% = $20 + $24 = $44
      const fee = calculateFee(5000, 8000);
      expect(fee).toBeCloseTo(44, 4);
    });

    it('applies correct rate when already in Tier 2', () => {
      // $10k at $20k volume (fully in Tier 2)
      const fee = calculateFee(10000, 20000);
      expect(fee).toBeCloseTo(80, 4); // $10k × 0.8% = $80
    });

    it('splits across Tier 2 and Tier 3', () => {
      // $20k at $40k volume: $10k×0.8% + $10k×0.5% = $80 + $50 = $130
      const fee = calculateFee(20000, 40000);
      expect(fee).toBeCloseTo(130, 4);
    });

    it('splits across all 4 tiers', () => {
      // $300k at $0: $10k×1% + $40k×0.8% + $200k×0.5% + $50k×0.3%
      // = $100 + $320 + $1000 + $150 = $1570
      const fee = calculateFee(300000, 0);
      expect(fee).toBeCloseTo(1570, 4);
    });

    it('applies Tier 4 when fully above $250k', () => {
      const fee = calculateFee(50000, 300000); // $50k at $300k volume
      expect(fee).toBeCloseTo(150, 4); // $50k × 0.3% = $150
    });

    it('handles zero amount', () => {
      expect(calculateFee(0, 50000)).toBe(0);
    });

    it('handles micro amounts', () => {
      const fee = calculateFee(0.005, 0);
      expect(fee).toBeCloseTo(0.00005, 6); // $0.005 × 1% = $0.00005
    });

    it('uses custom rate when provided (flat, not bracketed)', () => {
      const fee = calculateFee(10000, 0, 0.002); // Custom 0.2%
      expect(fee).toBeCloseTo(20, 4); // $10k × 0.2% = $20
    });
  });

  describe('getEffectiveFeeRate', () => {
    it('returns marginal rate for zero amount', () => {
      const rate = getEffectiveFeeRate(0, 5000);
      expect(rate).toBe(0.01); // Tier 1 marginal
    });

    it('returns blended rate for cross-bracket amount', () => {
      // $15k at $0: fee = $140, effective = 140/15000 = 0.00933
      const rate = getEffectiveFeeRate(15000, 0);
      expect(rate).toBeCloseTo(0.00933, 4);
    });

    it('returns exact tier rate within a single bracket', () => {
      const rate = getEffectiveFeeRate(5000, 20000); // Fully in Tier 2
      expect(rate).toBe(0.008);
    });
  });

  describe('$60k example from pricing page', () => {
    it('calculates correctly: $10k×1% + $40k×0.8% + $10k×0.5% = $470', () => {
      const fee = calculateFee(60000, 0);
      expect(fee).toBeCloseTo(470, 4);
    });

    it('effective rate is 0.783%', () => {
      const rate = getEffectiveFeeRate(60000, 0);
      expect(rate).toBeCloseTo(0.00783, 4);
    });
  });
});
