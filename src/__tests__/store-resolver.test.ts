/**
 * Smoke tests for storeResolver helpers. These are pure-enough that we mock db access —
 * we're validating the fallback order (store → merchant → chain config) not the DB.
 *
 * End-to-end store behavior is verified in scripts/test-stores-e2e.ts against a live DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CHAIN_CONFIGS } from '../config/chains';

vi.mock('../config/database', () => ({
  db: {
    storeWallet: { findFirst: vi.fn() },
    merchantWallet: { findFirst: vi.fn() },
    store: { findUnique: vi.fn() },
    merchant: { findUnique: vi.fn() },
  },
}));

import { db } from '../config/database';
import { resolvePaymentAddress, resolveWebhookTarget, resolveBranding } from '../services/storeResolver';

describe('resolvePaymentAddress', () => {
  beforeEach(() => {
    vi.mocked(db.storeWallet.findFirst).mockReset();
    vi.mocked(db.merchantWallet.findFirst).mockReset();
  });

  it('uses store override when present', async () => {
    vi.mocked(db.storeWallet.findFirst).mockResolvedValue({ address: '0xSTORE' } as any);
    const r = await resolvePaymentAddress('m1', 's1', 'BASE_MAINNET');
    expect(r).toEqual({ address: '0xSTORE', source: 'store' });
    expect(db.merchantWallet.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to merchant wallet when no store override', async () => {
    vi.mocked(db.storeWallet.findFirst).mockResolvedValue(null);
    vi.mocked(db.merchantWallet.findFirst).mockResolvedValue({ address: '0xMERCH' } as any);
    const r = await resolvePaymentAddress('m1', 's1', 'BASE_MAINNET');
    expect(r).toEqual({ address: '0xMERCH', source: 'merchant' });
  });

  it('falls back to chain config when no wallets', async () => {
    vi.mocked(db.storeWallet.findFirst).mockResolvedValue(null);
    vi.mocked(db.merchantWallet.findFirst).mockResolvedValue(null);
    const cfgAddr = CHAIN_CONFIGS.BASE_MAINNET.paymentAddress;
    if (!cfgAddr) return;
    const r = await resolvePaymentAddress('m1', null, 'BASE_MAINNET');
    expect(r.source).toBe('chain_config');
  });

  it('throws when no wallet and no chain-config fallback', async () => {
    vi.mocked(db.storeWallet.findFirst).mockResolvedValue(null);
    vi.mocked(db.merchantWallet.findFirst).mockResolvedValue(null);
    const original = CHAIN_CONFIGS.BASE_MAINNET.paymentAddress;
    (CHAIN_CONFIGS.BASE_MAINNET as any).paymentAddress = '';
    try {
      await expect(resolvePaymentAddress('m1', null, 'BASE_MAINNET')).rejects.toThrow();
    } finally {
      (CHAIN_CONFIGS.BASE_MAINNET as any).paymentAddress = original;
    }
  });

  it('skips store lookup when storeId is null', async () => {
    vi.mocked(db.merchantWallet.findFirst).mockResolvedValue({ address: '0xMERCH' } as any);
    const r = await resolvePaymentAddress('m1', null, 'BASE_MAINNET');
    expect(db.storeWallet.findFirst).not.toHaveBeenCalled();
    expect(r.source).toBe('merchant');
  });
});

describe('resolveWebhookTarget', () => {
  beforeEach(() => {
    vi.mocked(db.store.findUnique).mockReset();
    vi.mocked(db.merchant.findUnique).mockReset();
  });

  it('returns store config when store has webhook URL', async () => {
    vi.mocked(db.store.findUnique).mockResolvedValue({
      merchantId: 'm1',
      isArchived: false,
      webhookUrl: 'https://store.example.com/hook',
      webhookSecret: 'STORE_SECRET',
      webhookEnabled: true,
      webhookEvents: ['order.confirmed'],
    } as any);
    const t = await resolveWebhookTarget('m1', 's1');
    expect(t).toEqual(expect.objectContaining({
      url: 'https://store.example.com/hook',
      secret: 'STORE_SECRET',
      enabled: true,
      source: 'store',
    }));
  });

  it('falls back to merchant when store has null webhookUrl', async () => {
    vi.mocked(db.store.findUnique).mockResolvedValue({
      merchantId: 'm1', isArchived: false, webhookUrl: null, webhookSecret: 's',
      webhookEnabled: false, webhookEvents: [],
    } as any);
    vi.mocked(db.merchant.findUnique).mockResolvedValue({
      webhookUrl: 'https://m.example.com/hook',
      webhookSecret: 'MERCH_SECRET',
      webhookEnabled: true,
      webhookEvents: [],
    } as any);
    const t = await resolveWebhookTarget('m1', 's1');
    expect(t?.source).toBe('merchant');
    expect(t?.secret).toBe('MERCH_SECRET');
  });

  it('skips store when it belongs to a different merchant', async () => {
    vi.mocked(db.store.findUnique).mockResolvedValue({
      merchantId: 'OTHER', isArchived: false, webhookUrl: 'https://x/hook',
      webhookSecret: 'x', webhookEnabled: true, webhookEvents: [],
    } as any);
    vi.mocked(db.merchant.findUnique).mockResolvedValue({
      webhookUrl: 'https://m.example.com/hook', webhookSecret: 'OK',
      webhookEnabled: true, webhookEvents: [],
    } as any);
    const t = await resolveWebhookTarget('m1', 'sWrong');
    expect(t?.source).toBe('merchant');
  });

  it('returns null when nothing configured', async () => {
    vi.mocked(db.merchant.findUnique).mockResolvedValue({
      webhookUrl: null, webhookSecret: null, webhookEnabled: false, webhookEvents: [],
    } as any);
    const t = await resolveWebhookTarget('m1', null);
    expect(t).toBeNull();
  });
});

describe('resolveBranding', () => {
  beforeEach(() => {
    vi.mocked(db.store.findUnique).mockReset();
    vi.mocked(db.merchant.findUnique).mockReset();
  });

  it('fully replaces merchant branding when store is set', async () => {
    vi.mocked(db.store.findUnique).mockResolvedValue({
      merchantId: 'm1', name: 'Store', displayName: 'Flirty',
      logoUrl: 'https://x/store.png', headerColor: '#FF2B6E',
      headerTextColor: null, website: 'https://flirty.com',
      backButtonText: null, widgetConfig: null,
      successUrl: null, cancelUrl: null,
    } as any);
    const b = await resolveBranding('m1', 's1');
    expect(b.displayName).toBe('Flirty');
    expect(b.logoUrl).toBe('https://x/store.png');
    expect(b.headerColor).toBe('#FF2B6E');
    expect(b.source).toBe('store');
    // Merchant should NOT be consulted when store resolution succeeds
    expect(db.merchant.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to merchant when no storeId', async () => {
    vi.mocked(db.merchant.findUnique).mockResolvedValue({
      companyName: 'MerchantCo', website: 'https://merch.com',
      widgetConfig: { displayName: 'Merchant', logoUrl: 'https://m.com/l.png' },
      successUrl: null, cancelUrl: null,
    } as any);
    const b = await resolveBranding('m1', null);
    expect(b.displayName).toBe('Merchant');
    expect(b.source).toBe('merchant');
  });
});
