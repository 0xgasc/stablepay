import { describe, it, expect } from 'vitest';
import {
  CHAIN_STABLES,
  SOLANA_TOKEN_MINTS,
  TRON_TOKEN_CONTRACTS,
  CHAIN_TOKEN_DECIMALS,
  getTokenDecimals,
  amountWithinTolerance,
  amountAcceptable,
  rankByAmountCloseness,
} from '../services/blockchainService';

// Current spec: symmetric ±1% tolerance (wallet rounding), raised from the original 0.1%
// on 2026-06-09 because real wallets/exchanges rounded payments out of the window.
describe('scanner amount tolerance (±1% symmetric)', () => {
  it('accepts exact match', () => {
    expect(amountWithinTolerance(100, 100)).toBe(true);
  });

  it('accepts within +1%', () => {
    expect(amountWithinTolerance(100.9, 100)).toBe(true);
  });

  it('accepts within -1%', () => {
    expect(amountWithinTolerance(99.1, 100)).toBe(true);
  });

  it('rejects overpayment > 1%', () => {
    expect(amountWithinTolerance(101.5, 100)).toBe(false);
  });

  it('rejects underpayment > 1%', () => {
    expect(amountWithinTolerance(98.5, 100)).toBe(false);
  });

  it('rejects zero-amount orders', () => {
    expect(amountWithinTolerance(100, 0)).toBe(false);
  });

  it('rejects negative order amounts', () => {
    expect(amountWithinTolerance(100, -50)).toBe(false);
  });
});

// Underpay rule (2026-06-10): beyond the symmetric tolerance, accept a shortfall of up to
// min($1.00, 3% of order) — exchanges deduct withdrawal fees from the sent amount. Every
// fee-rule acceptance is flagged `underpaid:true` so abuse stays visible.
describe('exchange-fee underpay acceptance', () => {
  it('accepts the live case that motivated the rule: 4.90 sent for a 4.99 order', () => {
    const r = amountAcceptable(4.9, 4.99);
    expect(r.ok).toBe(true);
    expect(r.underpaid).toBe(true);
    expect(r.shortfall).toBeCloseTo(0.09, 6);
  });

  it('within ±1% is ok and NOT flagged underpaid', () => {
    const r = amountAcceptable(99.5, 100);
    expect(r.ok).toBe(true);
    expect(r.underpaid).toBe(false);
  });

  it('3% cap binds on small orders: 4.80 for 4.99 (0.19 > 3% of 4.99) rejected', () => {
    expect(amountAcceptable(4.8, 4.99).ok).toBe(false);
  });

  it('$1 cap binds on large orders: $1 short on $500 accepted (not flagged — within 1% rounding band)', () => {
    const r = amountAcceptable(499.0, 500);
    expect(r.ok).toBe(true);
    expect(r.underpaid).toBe(false); // 0.2% — rounding-scale, no fee-rule flag
  });

  it('$1.01 short on $500 rejected (absolute cap)', () => {
    expect(amountAcceptable(498.99, 500).ok).toBe(false);
  });

  it('crossover (~$33.33): below it 3% binds, above it $1 binds', () => {
    // $30 order: 3% = $0.90 < $1 → 0.90 accepted, 0.95 rejected
    expect(amountAcceptable(29.10, 30).ok).toBe(true);
    expect(amountAcceptable(29.05, 30).ok).toBe(false);
    // $50 order: min($1, $1.50) = $1 → 1.00 accepted, 1.10 rejected
    expect(amountAcceptable(49.0, 50).ok).toBe(true);
    expect(amountAcceptable(48.9, 50).ok).toBe(false);
  });

  it('OVERpayment gets no extended allowance — strictly 1%', () => {
    expect(amountAcceptable(101.5, 100).ok).toBe(false);
    expect(amountAcceptable(100.9, 100).ok).toBe(true);
  });

  it('zero/negative order amounts rejected', () => {
    expect(amountAcceptable(5, 0).ok).toBe(false);
    expect(amountAcceptable(5, -1).ok).toBe(false);
  });
});

// Candidate selection: cent-jitter gives concurrent same-price orders unique amounts; the
// matcher must bind the transfer to the CLOSEST amount, breaking exact ties by token match.
describe('candidate ranking (closest amount, exact-token tiebreak)', () => {
  const tx = 9.9871; // what arrived on-chain
  const o = (id: string, amount: number, token = 'USDC') => ({ id, amount, token });
  const rank = (orders: ReturnType<typeof o>[], sentTok = 'USDC') =>
    rankByAmountCloseness(orders, x => Math.abs(tx - x.amount), x => x.token === sentTok);

  it('binds to the jittered order that matches, not a same-price sibling', () => {
    const winner = rank([o('a', 9.9902), o('b', 9.9871), o('c', 9.99)])[0];
    expect(winner.id).toBe('b');
  });

  it('on an exact closeness tie, exact token beats cross-stable', () => {
    const winner = rank([o('usdt', 9.9871, 'USDT'), o('usdc', 9.9871, 'USDC')], 'USDC')[0];
    expect(winner.id).toBe('usdc');
  });

  it('cross-stable still wins when its amount is closer', () => {
    const winner = rank([o('usdc-far', 9.93, 'USDC'), o('usdt-close', 9.9871, 'USDT')], 'USDT')[0];
    expect(winner.id).toBe('usdt-close');
  });

  it('preserves input order for full ties (stable sort → newest-first from the query)', () => {
    const winner = rank([o('newest', 9.99), o('older', 9.99)])[0];
    expect(winner.id).toBe('newest');
  });

  it('does not mutate the input array', () => {
    const input = [o('a', 9.99), o('b', 9.9871)];
    const copy = [...input];
    rank(input);
    expect(input).toEqual(copy);
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
