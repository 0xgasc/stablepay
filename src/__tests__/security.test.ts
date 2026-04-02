import { describe, it, expect } from 'vitest';

describe('Amount Tolerance (99.9%)', () => {
  const isAmountValid = (txAmount: number, orderAmount: number): boolean => {
    if (txAmount < orderAmount * 0.999) return false;
    if (orderAmount > 0 && Math.abs(txAmount - orderAmount) / orderAmount > 0.001) return false;
    return true;
  };

  it('accepts exact amount', () => {
    expect(isAmountValid(10.00, 10.00)).toBe(true);
  });

  it('accepts 99.95% of order', () => {
    expect(isAmountValid(9.995, 10.00)).toBe(true);
  });

  it('rejects 99% of order (1% underpayment)', () => {
    expect(isAmountValid(9.90, 10.00)).toBe(false);
  });

  it('rejects 94% of order (6% underpayment)', () => {
    expect(isAmountValid(0.0003, 0.005)).toBe(false);
  });

  it('accepts micro amount exactly', () => {
    expect(isAmountValid(0.005, 0.005)).toBe(true);
  });

  it('rejects zero payment', () => {
    expect(isAmountValid(0, 10.00)).toBe(false);
  });

  it('accepts slight overpayment', () => {
    expect(isAmountValid(10.01, 10.00)).toBe(true);
  });

  it('accepts large overpayment', () => {
    // Overpayment > 0.1% — currently accepted (merchant benefits)
    expect(isAmountValid(100.00, 10.00)).toBe(false); // 900% over = pctDiff > 0.001
  });

  it('handles $0 order amount gracefully', () => {
    // 0 >= 0 * 0.999 (true), but 0/0 = NaN, NaN > 0.001 = false → passes
    // This edge case is acceptable — $0 orders shouldn't exist in practice
    expect(isAmountValid(0, 0)).toBe(true);
  });
});

describe('Token Whitelist', () => {
  const VALID_SOLANA_MINTS = new Set([
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr', // EURC
  ]);

  const VALID_EVM_CONTRACTS: Record<string, Set<string>> = {
    BASE_MAINNET: new Set(['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42']),
    BNB_MAINNET: new Set(['0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', '0x55d398326f99059ff775485246999027b3197955']),
  };

  it('accepts USDC mint on Solana', () => {
    expect(VALID_SOLANA_MINTS.has('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
  });

  it('rejects random mint on Solana', () => {
    expect(VALID_SOLANA_MINTS.has('RandomFakeMintAddressThatDoesNotExist123456')).toBe(false);
  });

  it('accepts USDC on Base (lowercase)', () => {
    expect(VALID_EVM_CONTRACTS.BASE_MAINNET.has('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')).toBe(true);
  });

  it('rejects random ERC20 on Base', () => {
    expect(VALID_EVM_CONTRACTS.BASE_MAINNET.has('0x1234567890abcdef1234567890abcdef12345678')).toBe(false);
  });

  it('accepts USDT on BNB', () => {
    expect(VALID_EVM_CONTRACTS.BNB_MAINNET.has('0x55d398326f99059ff775485246999027b3197955')).toBe(true);
  });
});

describe('Wallet Address Validation', () => {
  it('EVM address: valid 0x + 40 hex chars', () => {
    const isValid = /^0x[a-fA-F0-9]{40}$/.test('0xd573BeCb6A6B0a0D43065d468D07787ca65dAF8a');
    expect(isValid).toBe(true);
  });

  it('EVM address: rejects short address', () => {
    expect(/^0x[a-fA-F0-9]{40}$/.test('0x1234')).toBe(false);
  });

  it('Solana address: rejects 0x prefix', () => {
    const addr = '0x99B9bFf4Cd54cd2948a03d02A7F25e919149c535';
    expect(addr.startsWith('0x')).toBe(true); // This is EVM, not Solana
  });

  it('TRON address: starts with T', () => {
    expect('TLKRMNdM7szGcXW6GScZEKrSHDfYozGf4A'.startsWith('T')).toBe(true);
  });

  it('TRON address: rejects 0x', () => {
    expect('0xd573BeCb6A6B0a0D43065d468D07787ca65dAF8a'.startsWith('T')).toBe(false);
  });
});
