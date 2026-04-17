import { describe, it, expect } from 'vitest';
import {
  CHAIN_STABLES,
  SOLANA_TOKEN_MINTS,
  TRON_TOKEN_CONTRACTS,
  CHAIN_TOKEN_DECIMALS,
  getTokenDecimals,
  amountWithinTolerance,
} from '../services/blockchainService';

describe('scanner amount tolerance', () => {
  it('accepts exact match', () => {
    expect(amountWithinTolerance(100, 100)).toBe(true);
  });

  it('accepts within +0.1%', () => {
    expect(amountWithinTolerance(100.05, 100)).toBe(true);
  });

  it('accepts within -0.1%', () => {
    expect(amountWithinTolerance(99.95, 100)).toBe(true);
  });

  it('rejects overpayment > 0.1%', () => {
    expect(amountWithinTolerance(100.5, 100)).toBe(false);
  });

  it('rejects underpayment > 0.1%', () => {
    expect(amountWithinTolerance(99.5, 100)).toBe(false);
  });

  it('rejects zero-amount orders', () => {
    expect(amountWithinTolerance(100, 0)).toBe(false);
  });

  it('rejects negative order amounts', () => {
    expect(amountWithinTolerance(100, -50)).toBe(false);
  });
});

describe('token decimals by chain', () => {
  it('BNB USDC is 18 decimals', () => {
    expect(getTokenDecimals('BNB_MAINNET', 'USDC')).toBe(18);
  });

  it('BNB USDT is 18 decimals', () => {
    expect(getTokenDecimals('BNB_MAINNET', 'USDT')).toBe(18);
  });

  it('Base USDC defaults to 6', () => {
    expect(getTokenDecimals('BASE_MAINNET', 'USDC')).toBe(6);
  });

  it('Ethereum USDT defaults to 6', () => {
    expect(getTokenDecimals('ETHEREUM_MAINNET', 'USDT')).toBe(6);
  });

  it('unknown chain/token defaults to 6', () => {
    expect(getTokenDecimals('UNKNOWN_CHAIN', 'MYSTERY')).toBe(6);
  });
});

describe('token contract mapping invariants', () => {
  it('every supported chain has USDC', () => {
    const chains = ['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'BNB_MAINNET'];
    for (const chain of chains) {
      expect(CHAIN_STABLES[chain]?.USDC).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  it('Solana mints are base58 and distinct', () => {
    const mints = Object.values(SOLANA_TOKEN_MINTS);
    expect(new Set(mints).size).toBe(mints.length);
    for (const m of mints) {
      expect(m.length).toBeGreaterThanOrEqual(32);
    }
  });

  it('TRON contracts present for USDC + USDT', () => {
    expect(TRON_TOKEN_CONTRACTS.USDC).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(TRON_TOKEN_CONTRACTS.USDT).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  });

  it('CHAIN_TOKEN_DECIMALS only overrides BNB', () => {
    // Any new chain with non-6 decimals must be added explicitly — regression guard.
    const chains = Object.keys(CHAIN_TOKEN_DECIMALS);
    expect(chains).toEqual(['BNB_MAINNET']);
  });
});
