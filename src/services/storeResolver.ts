/**
 * Resolution helpers for the multi-store data model.
 *
 * A merchant can operate multiple stores (brands). Each store may override per-chain wallet
 * routing, webhook config, and branding. These helpers centralize the resolution logic so
 * every order/webhook/branding code path uses the same fallback order.
 *
 * Precedence rules (locked product decisions — see plan):
 *   - Payment address:  store wallet  →  merchant wallet  →  chain-config fallback
 *   - Webhook target:   store config (incl. enabled)  →  merchant config
 *   - Branding:         FULL replacement when storeId set (no per-field inheritance).
 *                       If order has no storeId, use merchant.
 *
 * All helpers accept `storeId?: string | null`. Null / undefined degrades to merchant
 * behavior — so callers on pre-multi-store code paths (and orders migrated without a
 * storeId) keep working.
 */
import { db } from '../config/database';
import { CHAIN_CONFIGS } from '../config/chains';
import type { Chain } from '../types';

export interface PaymentAddressResolution {
  address: string;
  source: 'store' | 'merchant' | 'chain_config';
}

export async function resolvePaymentAddress(
  merchantId: string | null | undefined,
  storeId: string | null | undefined,
  chain: Chain
): Promise<PaymentAddressResolution> {
  // 1. Store-level override
  if (storeId) {
    const storeWallet = await db.storeWallet.findFirst({
      where: { storeId, chain, isActive: true },
      select: { address: true },
    });
    if (storeWallet?.address) {
      return { address: storeWallet.address, source: 'store' };
    }
  }
  // 2. Merchant default
  if (merchantId) {
    const merchantWallet = await db.merchantWallet.findFirst({
      where: { merchantId, chain, isActive: true },
      select: { address: true },
    });
    if (merchantWallet?.address) {
      return { address: merchantWallet.address, source: 'merchant' };
    }
  }
  // 3. Chain-config platform fallback (only for DEMO / platform orders)
  const cfgAddress = CHAIN_CONFIGS[chain]?.paymentAddress;
  if (cfgAddress) {
    return { address: cfgAddress, source: 'chain_config' };
  }
  throw new Error(`No payment address configured for ${chain} (merchantId=${merchantId ?? 'null'}, storeId=${storeId ?? 'null'})`);
}

export interface WebhookTarget {
  url: string;
  secret: string;
  enabled: boolean;
  events: string[];
  source: 'store' | 'merchant';
}

/**
 * Resolve the webhook target for a given merchant/store pair.
 *
 * Store is authoritative when both `storeId` is provided AND the store has `webhookUrl` set.
 * That means a store with `webhookUrl=null` falls back to merchant (unconfigured, not disabled).
 * To explicitly disable delivery for a store that has a URL, set `webhookEnabled=false` on the store.
 *
 * Returns null if neither merchant nor store has a webhook URL configured.
 */
export async function resolveWebhookTarget(
  merchantId: string,
  storeId?: string | null
): Promise<WebhookTarget | null> {
  if (storeId) {
    const store = await db.store.findUnique({
      where: { id: storeId },
      select: { webhookUrl: true, webhookSecret: true, webhookEnabled: true, webhookEvents: true, merchantId: true, isArchived: true },
    });
    if (store && store.merchantId === merchantId && !store.isArchived && store.webhookUrl) {
      return {
        url: store.webhookUrl,
        secret: store.webhookSecret,
        enabled: store.webhookEnabled,
        events: store.webhookEvents,
        source: 'store',
      };
    }
  }
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: { webhookUrl: true, webhookSecret: true, webhookEnabled: true, webhookEvents: true },
  });
  if (!merchant?.webhookUrl) return null;
  return {
    url: merchant.webhookUrl,
    secret: merchant.webhookSecret || '',
    enabled: merchant.webhookEnabled,
    events: merchant.webhookEvents,
    source: 'merchant',
  };
}

export interface BrandingResolution {
  displayName: string | null;
  logoUrl: string | null;
  headerColor: string | null;
  headerTextColor: string | null;
  website: string | null;
  backButtonText: string | null;
  widgetConfig: any | null;
  successUrl: string | null;
  cancelUrl: string | null;
  source: 'store' | 'merchant';
}

/**
 * Resolve checkout branding (logo, colors, display name, etc.).
 *
 * Store fully REPLACES merchant — when an order has a storeId, the checkout page uses ONLY the
 * store's branding. Unset store fields stay null (do not inherit from merchant). This is the
 * locked product decision to prevent accidental cross-brand leakage.
 */
export async function resolveBranding(
  merchantId: string,
  storeId?: string | null
): Promise<BrandingResolution> {
  if (storeId) {
    const store = await db.store.findUnique({
      where: { id: storeId },
      select: {
        displayName: true, logoUrl: true, headerColor: true, headerTextColor: true,
        website: true, backButtonText: true, widgetConfig: true,
        successUrl: true, cancelUrl: true, merchantId: true, name: true,
      },
    });
    if (store && store.merchantId === merchantId) {
      return {
        displayName: store.displayName || store.name,
        logoUrl: store.logoUrl,
        headerColor: store.headerColor,
        headerTextColor: store.headerTextColor,
        website: store.website,
        backButtonText: store.backButtonText,
        widgetConfig: store.widgetConfig ?? null,
        successUrl: store.successUrl,
        cancelUrl: store.cancelUrl,
        source: 'store',
      };
    }
  }
  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: {
      companyName: true, website: true, widgetConfig: true,
      successUrl: true, cancelUrl: true,
    },
  });
  const cfg = (merchant?.widgetConfig as any) || {};
  return {
    displayName: cfg.displayName || merchant?.companyName || null,
    logoUrl: cfg.logoUrl || null,
    headerColor: cfg.headerColor || null,
    headerTextColor: cfg.headerTextColor || null,
    website: merchant?.website || null,
    backButtonText: cfg.backButtonText || null,
    widgetConfig: merchant?.widgetConfig ?? null,
    successUrl: merchant?.successUrl || null,
    cancelUrl: merchant?.cancelUrl || null,
    source: 'merchant',
  };
}
