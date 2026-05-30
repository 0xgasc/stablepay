import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { rateLimit } from '../middleware/rateLimit';
import { requireMerchantAuth } from '../middleware/auth';
import { idempotency } from '../middleware/idempotency';
import { logger } from '../utils/logger';
import { webhookService } from '../services/webhookService';
import { getTokenBalance } from '../services/balanceService';

const router = Router();

// CORS headers for embed endpoints (allow cross-origin)
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Validation schema for checkout
const checkoutSchema = z.object({
  merchantId: z.string().min(1),
  storeId: z.string().optional(),  // Scope order to a merchant's sub-brand for webhook/branding isolation
  amount: z.number().positive(),
  chain: z.string().min(1).optional(),  // Optional: omit to let customer pick from merchant's active chains
  token: z.enum(['USDC', 'USDT', 'EURC', 'ETH', 'SOL', 'BNB', 'MATIC', 'ARB']).default('USDC'),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerName: z.string().optional(),
  customerWallet: z.string().optional(),  // Customer's wallet for precise FROM matching
  paymentMethod: z.enum(['WALLET_CONNECT', 'MANUAL_SEND']).optional(),
  source: z.enum(['EMBED_WIDGET', 'CHECKOUT_LINK', 'DASHBOARD', 'API', 'INVOICE']).optional(),
  productName: z.string().optional(),
  externalId: z.string().optional(),   // Merchant's own order/reference ID
  metadata: z.record(z.any()).optional(),
  returnUrl: z.string().url().optional(),  // Where to send customer after success/cancel
  linkId: z.string().optional(),  // PaymentLink id, used to enforce link's chain restrictions
});

/**
/**
 * Public branding for a store — used by the checkout page when an order has a storeId.
 * Returns only display fields (no webhook secret, no merchant-level fields).
 */
router.get('/store/:storeId', async (req, res) => {
  try {
    const store = await db.store.findUnique({
      where: { id: req.params.storeId },
      select: {
        id: true,
        name: true,
        displayName: true,
        logoUrl: true,
        headerColor: true,
        headerTextColor: true,
        website: true,
        backButtonText: true,
        widgetConfig: true,
        isArchived: true,
      },
    });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    if (store.isArchived) return res.status(410).json({ error: 'Store archived' });
    const { isArchived, ...publicFields } = store;
    res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    res.json(publicFields);
  } catch (error) {
    logger.error('Get store branding error', error as Error);
    res.status(500).json({ error: 'Failed to fetch store' });
  }
});

/*
 * Get available chains for a merchant
 * Used by widget to show chain selector
 */
/**
 * Server-side balance lookup. The browser used to query Solana / EVM RPCs directly,
 * which was unreliable from public networks (rate-limits, CORS, etc.) and would silently
 * return 0 — causing the checkout to falsely block as "Insufficient". We proxy through
 * here so balance checks use our resilient RPC layer + cache.
 *
 * Public — no auth (matches the rest of /api/embed/*). Owner addresses are derived from
 * the user's wallet, tokens are public contracts. No write paths.
 */
router.get('/balance', async (req, res) => {
  try {
    const chain = String(req.query.chain || '').trim();
    const owner = String(req.query.owner || '').trim();
    const token = String(req.query.token || '').trim();
    if (!chain || !owner || !token) {
      return res.status(400).json({ error: 'chain, owner, and token are required' });
    }
    if (owner.length > 128 || token.length > 128) {
      return res.status(400).json({ error: 'owner/token too long' });
    }
    const result = await getTokenBalance(chain, owner, token);
    res.json(result);
  } catch (err) {
    // Never block payment on balance failures — the customer should still be allowed to try.
    logger.warn('Balance lookup failed', { error: (err as Error).message, chain: req.query.chain });
    res.status(503).json({ error: 'Balance check unavailable', balance: null });
  }
});

/**
 * Public platform stats — cheap aggregate counts for the marketing site's social-proof
 * section. No PII, no per-merchant data. Cached 5 min server-side so the landing page can
 * embed this without worrying about DB cost.
 */
let _statsCache: { value: any; expiresAt: number } | null = null;
router.get('/stats', async (_req, res) => {
  try {
    if (_statsCache && _statsCache.expiresAt > Date.now()) {
      return res.json(_statsCache.value);
    }
    const [merchantCount, confirmedOrders, chains] = await Promise.all([
      db.merchant.count({ where: { isActive: true, isSuspended: false } }),
      db.order.count({ where: { status: 'CONFIRMED' } }),
      // 7 chains supported on mainnet (BASE, ETH, POLYGON, ARB, BNB, SOL, TRON)
      Promise.resolve(7),
    ]);
    const value = {
      merchants: merchantCount,
      confirmedPayments: confirmedOrders,
      chains,
      stablecoins: 3, // USDC, USDT, EURC
    };
    _statsCache = { value, expiresAt: Date.now() + 5 * 60 * 1000 };
    res.json(value);
  } catch (err) {
    logger.warn('Public stats failed', { error: (err as Error).message });
    res.status(503).json({ merchants: null, confirmedPayments: null, chains: 7, stablecoins: 3 });
  }
});

router.get('/chains', async (req, res) => {
  try {
    const { merchantId, storeId } = req.query;

    if (!merchantId) {
      return res.status(400).json({ error: 'merchantId is required' });
    }

    // Get merchant + wallets in one query
    const merchant = await db.merchant.findUnique({
      where: { id: merchantId as string },
      select: {
        id: true, isActive: true, isSuspended: true, companyName: true, plan: true, widgetConfig: true, website: true,
        wallets: {
          where: { isActive: true },
          orderBy: { priority: 'asc' },
          select: { chain: true, address: true, supportedTokens: true, acceptNativeTokens: true, preferredStablecoin: true }
        }
      }
    });

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    if (merchant.isSuspended) {
      return res.status(503).json({ error: 'Merchant temporarily unavailable' });
    }

    // Gate hideFooter to GROWTH+ plans
    const widgetConfig = (merchant.widgetConfig as any) || {};
    const canHideFooter = ['GROWTH', 'SCALE', 'ENTERPRISE'].includes(merchant.plan);
    if (!canHideFooter) delete widgetConfig.hideFooter;

    // Store-scoped: overlay store wallet overrides on merchant defaults. Store overrides replace
    // the merchant wallet for that chain; chains without store overrides inherit merchant wallets.
    let finalWallets = merchant.wallets;
    let storeBranding: any = null;
    if (storeId) {
      const store = await db.store.findUnique({
        where: { id: storeId as string },
        select: {
          id: true, merchantId: true, isArchived: true, displayName: true, name: true,
          logoUrl: true, headerColor: true, headerTextColor: true, website: true,
          backButtonText: true, widgetConfig: true,
          wallets: {
            where: { isActive: true },
            orderBy: { priority: 'asc' },
            select: { chain: true, address: true, supportedTokens: true },
          },
        },
      });
      if (store && store.merchantId === merchantId && !store.isArchived) {
        const byChain = new Map(merchant.wallets.map(w => [w.chain, w]));
        for (const sw of (store as any).wallets || []) byChain.set(sw.chain, sw);
        finalWallets = Array.from(byChain.values());
        // Store branding fully REPLACES merchant branding
        storeBranding = {
          displayName: store.displayName || store.name,
          logoUrl: store.logoUrl,
          headerColor: store.headerColor,
          headerTextColor: store.headerTextColor,
          backButtonText: store.backButtonText,
          ...(store.widgetConfig as any || {}),
        };
      }
    }

    // Default ordering: SOLANA_MAINNET first (cheap + fast), then preserve priority order.
    // Customer can still pick any other chain — this just changes which appears first.
    const orderedWallets = [...finalWallets].sort((a, b) => {
      if (a.chain === 'SOLANA_MAINNET' && b.chain !== 'SOLANA_MAINNET') return -1;
      if (b.chain === 'SOLANA_MAINNET' && a.chain !== 'SOLANA_MAINNET') return 1;
      return 0;
    });

    // NATIVE_PAYMENTS_DISABLED=true is a hard kill-switch (overrides everything): the native
    // swap path is being repaired, so we present every wallet as NOT accepting native — the UI
    // hides the "native crypto" option entirely. Remove the env var to re-enable.
    // FORCE_NATIVE_FOR_ALL=true (when not disabled) makes every wallet appear native-accepting.
    const nativeDisabled = String(process.env.NATIVE_PAYMENTS_DISABLED || '').toLowerCase() === 'true';
    const nativeForAll = String(process.env.FORCE_NATIVE_FOR_ALL || '').toLowerCase() === 'true';
    const wallets = nativeDisabled
      ? orderedWallets.map(w => ({ ...w, acceptNativeTokens: false }))
      : nativeForAll
      ? orderedWallets.map(w => ({ ...w, acceptNativeTokens: true }))
      : orderedWallets;

    res.json({
      merchantId,
      storeId: storeId || null,
      merchantName: storeBranding?.displayName || merchant.companyName,
      merchantWebsite: (storeId ? (await db.store.findUnique({ where: { id: storeId as string }, select: { website: true } }))?.website : null) || merchant.website || null,
      chains: orderedWallets.map(w => w.chain),
      wallets,
      widgetConfig: storeBranding || widgetConfig,
    });
  } catch (error) {
    console.error('Get embed chains error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Create order from embed widget
 * Called when customer initiates payment
 */
router.post('/checkout', rateLimit({
  getMerchantId: async (req) => req.body.merchantId || null,
  limitAnonymous: true,
  anonymousLimit: 100
}), idempotency(), async (req, res) => {
  try {
    const data = checkoutSchema.parse(req.body);
    const chainAgnostic = !data.chain;

    // Verify merchant — if chain-agnostic, fetch ALL active wallets for placeholder
    const merchant = await db.merchant.findUnique({
      where: { id: data.merchantId },
      include: {
        wallets: {
          where: chainAgnostic
            ? { isActive: true }
            : { chain: data.chain as any, isActive: true },
          orderBy: { priority: 'asc' },
          take: chainAgnostic ? undefined : 1,
        }
      }
    });

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    if (merchant.isSuspended) {
      return res.status(503).json({
        error: 'Payment unavailable',
        message: 'This merchant is temporarily unavailable'
      });
    }

    // Validate store (if scoped) — must belong to merchant, not be archived.
    let resolvedStoreId: string | null = null;
    if (data.storeId) {
      const store = await db.store.findUnique({
        where: { id: data.storeId },
        select: { merchantId: true, isArchived: true },
      });
      if (!store || store.merchantId !== data.merchantId) {
        return res.status(404).json({ error: 'Store not found' });
      }
      if (store.isArchived) {
        return res.status(400).json({ error: 'Store is archived' });
      }
      resolvedStoreId = data.storeId;
    }

    // ─── Idempotency on (merchantId, externalId) ─────────────────────────
    // Real bug: our checkout page sometimes posts a SECOND /api/embed/checkout when
    // a customer arrives via merchant redirect without orderId in the URL. The result
    // was duplicate orders, the second one missing externalId, and the merchant's
    // backend not being able to reconcile. Now: if the same merchant + externalId
    // already maps to a PENDING order, return THAT order instead of creating a new one.
    if (data.externalId) {
      const existing = await db.order.findFirst({
        where: {
          merchantId: data.merchantId,
          externalId: data.externalId,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true, amount: true, chain: true, token: true,
          paymentAddress: true, expiresAt: true, status: true, externalId: true,
        },
      });
      if (existing) {
        logger.info('Returning existing PENDING order for (merchantId, externalId)', {
          merchantId: data.merchantId,
          externalId: data.externalId,
          orderId: existing.id,
          event: 'order.dedupe_hit',
        });
        return res.json({
          success: true,
          order: {
            id: existing.id,
            externalId: existing.externalId,
            amount: Number(existing.amount),
            token: existing.token,
            chain: existing.chain,
            paymentAddress: existing.paymentAddress,
            expiresAt: existing.expiresAt.toISOString(),
          },
          deduped: true,
        });
      }
    }

    // For chain-agnostic orders, prefer SOLANA_MAINNET as the placeholder chain when available.
    // Solana is cheap + fast, so it's the best default if the customer doesn't explicitly pick.
    // The customer can still switch to any merchant-supported chain via PATCH /order/:id/chain.
    const wallet = chainAgnostic
      ? (merchant.wallets.find(w => w.chain === 'SOLANA_MAINNET') ?? merchant.wallets[0])
      : merchant.wallets[0];
    if (!wallet) {
      return res.status(400).json({
        error: 'No wallet configured',
        message: chainAgnostic
          ? 'Merchant has no active wallets configured'
          : `Merchant has no wallet for ${data.chain}`
      });
    }

    // Enforce token only when chain is locked (chain-agnostic orders re-validate at chain selection)
    // Native tokens (ETH/SOL/BNB/MATIC/ARB) bypass this check — they're validated in the native token path below
    const NATIVE_TOKEN_SET = new Set(['ETH', 'SOL', 'BNB', 'MATIC', 'ARB']);
    if (!chainAgnostic && !NATIVE_TOKEN_SET.has(data.token)) {
      const supportedTokens = (wallet.supportedTokens && wallet.supportedTokens.length > 0)
        ? wallet.supportedTokens
        : ['USDC'];
      if (!supportedTokens.includes(data.token)) {
        return res.status(400).json({
          error: 'Token not supported',
          message: `Merchant does not accept ${data.token} on ${data.chain}. Supported: ${supportedTokens.join(', ')}`
        });
      }
    }

    // Enforce payment link chain restriction (if linkId provided + chain locked)
    if (data.linkId && data.chain) {
      const link = await db.paymentLink.findUnique({
        where: { id: data.linkId },
        select: { chains: true, isActive: true, token: true },
      });
      if (link && link.isActive) {
        if (link.chains.length > 0 && !link.chains.includes(data.chain)) {
          return res.status(400).json({
            error: 'Chain not allowed',
            message: `This payment link only accepts: ${link.chains.join(', ')}`
          });
        }
        if (link.token !== data.token) {
          return res.status(400).json({
            error: 'Token mismatch',
            message: `This payment link only accepts ${link.token}`
          });
        }
      }
    }

    // Create order
    // Cancel any existing pending orders for this merchant + customer wallet combo
    if (data.customerWallet) {
      await db.order.updateMany({
        where: {
          merchantId: data.merchantId,
          customerWallet: data.customerWallet,
          status: 'PENDING',
        },
        data: { status: 'CANCELLED' },
      });
    }

    // For chain-agnostic orders: store first wallet as placeholder + flag in metadata
    // The customer picks the chain on /checkout, then PATCHes the order via /order/:id/chain
    const baseMetadata = data.metadata || {};
    const finalMetadata: any = { ...baseMetadata };
    if (data.returnUrl) finalMetadata._returnUrl = data.returnUrl;
    if (chainAgnostic) finalMetadata._chainAgnostic = true;

    // Resolve final payment address: honor store wallet override if present.
    const resolvedChain = (data.chain || wallet.chain) as any;
    let paymentAddress = wallet.address;
    if (resolvedStoreId && !chainAgnostic) {
      const { resolvePaymentAddress } = await import('../services/storeResolver');
      const resolution = await resolvePaymentAddress(data.merchantId, resolvedStoreId, resolvedChain);
      paymentAddress = resolution.address;
    }

    // ─── Native token path (ETH/SOL/BNB/MATIC/ARB) ──────────────────────────
    const { NATIVE_TOKENS, getPriceUsd, calcConversionFee, createNativeReceiveWallet } = await import('../services/swapService');
    const isNative = NATIVE_TOKENS.has(data.token);
    let nativePriceSnapshot: number | undefined;
    let conversionFeeAmount: number | undefined;
    let nativeSendAmount: number | undefined;
    let orderExpiry = 30 * 60 * 1000; // 30 min default

    if (isNative) {
      // Hard kill-switch while the native swap path is being repaired.
      if (String(process.env.NATIVE_PAYMENTS_DISABLED || '').toLowerCase() === 'true') {
        return res.status(400).json({ error: 'Native token payments are temporarily unavailable', message: 'Please pay with a stablecoin (USDC/USDT).' });
      }
      if (!data.chain) {
        return res.status(400).json({ error: 'chain is required for native token orders' });
      }
      const walletConfig = wallet as any;
      // FORCE_NATIVE_FOR_ALL=true bypasses the per-wallet opt-in during the testing phase
      // so every merchant offers native by default. Flip to false to restore opt-in.
      const nativeForAll = String(process.env.FORCE_NATIVE_FOR_ALL || '').toLowerCase() === 'true';
      if (!nativeForAll && !walletConfig.acceptNativeTokens) {
        return res.status(400).json({
          error: 'Native tokens not enabled',
          message: 'This merchant does not accept ETH/SOL/BNB on this chain. Please use USDC.',
        });
      }
      nativePriceSnapshot = await getPriceUsd(data.token);
      conversionFeeAmount = calcConversionFee(data.amount, data.chain);
      nativeSendAmount    = (data.amount + conversionFeeAmount) / nativePriceSnapshot;
      finalMetadata._nativeSendAmount   = nativeSendAmount;
      finalMetadata._nativePriceSnapshot = nativePriceSnapshot;
      orderExpiry = 15 * 60 * 1000; // 15 min — price snapshot goes stale
    }

    const order = await db.order.create({
      data: {
        merchantId: data.merchantId,
        storeId: resolvedStoreId,
        amount: data.amount,
        token: isNative ? 'USDC' : data.token, // order amount always tracks USD/stablecoin value
        chain: resolvedChain,
        customerEmail: data.customerEmail || null,
        customerName: data.customerName || data.productName || null,
        paymentAddress,
        customerWallet: data.customerWallet || null,
        paymentMethod: data.paymentMethod || null,
        source: data.source || 'EMBED_WIDGET',
        externalId: data.externalId || null,
        metadata: Object.keys(finalMetadata).length > 0 ? finalMetadata : undefined,
        nativeToken:          isNative ? data.token : undefined,
        nativePriceSnapshot:  nativePriceSnapshot,
        conversionFeeAmount:  conversionFeeAmount,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + orderExpiry),
      }
    });

    // For native token orders: create a fresh receive wallet + set it as the payment address
    let finalPaymentAddress = order.paymentAddress;
    if (isNative) {
      const receiveAddress = await createNativeReceiveWallet(order.id, String(resolvedChain));
      await db.order.update({ where: { id: order.id }, data: { paymentAddress: receiveAddress } });
      finalPaymentAddress = receiveAddress;
    }

    // Rewind scanner for this chain — payment may have landed before order was created
    // (deferred order creation means tx often arrives before we start watching)
    if (data.chain && ['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'BNB_MAINNET'].includes(data.chain)) {
      try {
        const chainConfig = await db.chainConfig.findUnique({ where: { chain: data.chain as any } });
        if (chainConfig && chainConfig.lastScannedBlock) {
          // Go back 150 blocks (~5 min on Base) to catch recent payments
          const rewindTo = BigInt(chainConfig.lastScannedBlock.toString()) - BigInt(150);
          await db.chainConfig.update({
            where: { chain: data.chain as any },
            data: { lastScannedBlock: rewindTo > 0n ? rewindTo : 0n },
          });
        }
      } catch { /* non-critical */ }
    }

    logger.info('Embed order created', {
      orderId: order.id,
      merchantId: data.merchantId,
      amount: data.amount,
      chain: data.chain,
      externalId: data.externalId,
      source: 'embed_widget'
    });

    // Send webhook
    webhookService.sendWebhook(data.merchantId, 'order.created', {
      orderId: order.id,
      externalId: data.externalId || null,
      amount: data.amount,
      token: data.token,
      chain: data.chain,
      paymentAddress: wallet.address,
      customerEmail: data.customerEmail || null,
      source: data.source || 'EMBED_WIDGET',
      productName: data.productName,
      metadata: data.metadata,
    }).catch(err => {
      logger.error('Failed to send order.created webhook', err as Error, { orderId: order.id });
    });

    res.status(201).json({
      success: true,
      order: {
        id: order.id,
        externalId: order.externalId || null,
        amount: Number(order.amount),
        token: order.token,
        chain: order.chain,
        paymentAddress: finalPaymentAddress,
        expiresAt: order.expiresAt.toISOString(),
        nativeSendAmount: nativeSendAmount ?? null,
        nativeToken: isNative ? data.token : null,
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      console.error('Embed checkout error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
});

/**
 * Get order status (for polling)
 */
router.get('/order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        // Include the latest transaction regardless of status so we can surface
        // confirmation progress to the frontend (e.g. "3 of 6 confirmations") while
        // the customer waits — slow chains like ETH otherwise look indistinguishable
        // from "didn't pay yet" for ~90s.
        transactions: {
          take: 1,
          orderBy: { createdAt: 'desc' }
        },
        merchant: {
          select: { companyName: true, plan: true, widgetConfig: true, website: true }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Plan-gate hideFooter (only GROWTH+ can hide it)
    const widgetConfig = (order.merchant?.widgetConfig as any) || {};
    if (order.merchant && !['GROWTH', 'SCALE', 'ENTERPRISE'].includes(order.merchant.plan)) {
      delete widgetConfig.hideFooter;
    }

    const tx = order.transactions[0] || null;
    const txHash = tx?.txHash || null;
    // Pull the chain's requiredConfirms so the frontend can show progress.
    let requiredConfirms: number | null = null;
    try {
      const { CHAIN_CONFIGS } = await import('../config/chains');
      requiredConfirms = (CHAIN_CONFIGS as any)[order.chain]?.requiredConfirms ?? null;
    } catch { /* fall through */ }
    const explorerUrls: Record<string, string> = {
      BASE_MAINNET: 'https://basescan.org/tx/',
      ETHEREUM_MAINNET: 'https://etherscan.io/tx/',
      POLYGON_MAINNET: 'https://polygonscan.com/tx/',
      ARBITRUM_MAINNET: 'https://arbiscan.io/tx/',
      BNB_MAINNET: 'https://bscscan.com/tx/',
      SOLANA_MAINNET: 'https://solscan.io/tx/',
      TRON_MAINNET: 'https://tronscan.org/#/transaction/',
      BASE_SEPOLIA: 'https://sepolia.basescan.org/tx/',
      ETHEREUM_SEPOLIA: 'https://sepolia.etherscan.io/tx/',
    };

    const md = (order.metadata as any) || {};
    const isChainAgnostic = md._chainAgnostic === true;

    // For chain-agnostic orders, fetch all merchant's active wallets so frontend can show selector
    let availableChains: any[] = [];
    if (isChainAgnostic && order.merchantId) {
      const wallets = await db.merchantWallet.findMany({
        where: { merchantId: order.merchantId, isActive: true },
        orderBy: { priority: 'asc' },
        select: { chain: true, address: true, supportedTokens: true, acceptNativeTokens: true, preferredStablecoin: true },
      });
      const nativeDisabled = String(process.env.NATIVE_PAYMENTS_DISABLED || '').toLowerCase() === 'true';
      const nativeForAll = String(process.env.FORCE_NATIVE_FOR_ALL || '').toLowerCase() === 'true';
      availableChains = nativeDisabled
        ? wallets.map(w => ({ ...w, acceptNativeTokens: false }))
        : nativeForAll
        ? wallets.map(w => ({ ...w, acceptNativeTokens: true }))
        : wallets;
    }

    // Resolve branding — store branding fully replaces merchant when order has storeId.
    let brandedName = order.merchant?.companyName || null;
    let brandedWebsite = order.merchant?.website || null;
    let brandedWidgetConfig: any = widgetConfig;
    if (order.storeId && order.merchantId) {
      const { resolveBranding } = await import('../services/storeResolver');
      const b = await resolveBranding(order.merchantId, order.storeId);
      if (b.source === 'store') {
        brandedName = b.displayName ?? brandedName;
        brandedWebsite = b.website;
        brandedWidgetConfig = b.widgetConfig || {
          displayName: b.displayName,
          logoUrl: b.logoUrl,
          headerColor: b.headerColor,
          headerTextColor: b.headerTextColor,
          backButtonText: b.backButtonText,
        };
      }
    }

    res.json({
      id: order.id,
      status: order.status,
      amount: Number(order.amount),
      token: order.token,
      chain: order.chain,
      chainAgnostic: isChainAgnostic,
      availableChains, // populated only when chainAgnostic is true
      paymentAddress: order.paymentAddress,
      merchantId: order.merchantId,
      storeId: order.storeId || null,
      merchantName: brandedName,
      merchantWebsite: brandedWebsite,
      widgetConfig: brandedWidgetConfig,
      productName: order.customerName, // productName is stored in customerName when set via embed
      customerEmail: order.customerEmail,
      returnUrl: md._returnUrl || null,
      txHash,
      explorerLink: txHash && explorerUrls[order.chain] ? explorerUrls[order.chain] + txHash : null,
      // Progress fields — populated as soon as we detect the transaction on-chain, well before
      // it has enough confirmations to mark the order CONFIRMED. Frontend uses these to render
      // "Confirmation X of Y" while the customer waits.
      txDetected: !!tx,
      confirmations: tx?.confirmations ?? 0,
      requiredConfirms,
      confirmedAt: tx?.blockTimestamp?.toISOString() || null,
      expiresAt: order.expiresAt.toISOString(),
      wrongTokenDetected: md.wrongTokenDetected || null,
    });
  } catch (error) {
    console.error('Get embed order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Set chain + token on a chain-agnostic order (created without `chain`)
 * Updates the order's chain, token, and paymentAddress to the merchant's wallet for that chain
 * Only allowed for PENDING orders flagged as chainAgnostic
 */
router.post('/order/:orderId/chain', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { chain, token, amount: amountOverride } = req.body;
    if (!chain) return res.status(400).json({ error: 'chain required' });

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { status: true, merchantId: true, storeId: true, metadata: true, amount: true, token: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'PENDING') return res.status(400).json({ error: `Order status is ${order.status}` });
    if (!order.merchantId) return res.status(400).json({ error: 'Order has no merchant' });

    const md = (order.metadata as any) || {};
    if (md._chainAgnostic !== true) {
      return res.status(400).json({ error: 'Order chain is already locked' });
    }

    // Resolve wallet: store override → merchant default. Validate token against whichever wins.
    let walletAddress: string | null = null;
    let supportedTokens: string[] = ['USDC'];
    if (order.storeId) {
      const sw = await db.storeWallet.findFirst({ where: { storeId: order.storeId, chain, isActive: true } });
      if (sw) {
        walletAddress = sw.address;
        supportedTokens = sw.supportedTokens?.length ? sw.supportedTokens : ['USDC'];
      }
    }
    if (!walletAddress) {
      const wallet = await db.merchantWallet.findFirst({
        where: { merchantId: order.merchantId, chain, isActive: true },
      });
      if (wallet) {
        walletAddress = wallet.address;
        supportedTokens = wallet.supportedTokens?.length ? wallet.supportedTokens : ['USDC'];
      }
    }
    if (!walletAddress) {
      return res.status(400).json({ error: `No active wallet for ${chain}` });
    }

    // Validate token — native tokens (ETH/SOL/BNB/MATIC/ARB) skip supportedTokens check
    const requestedToken = token || order.token || 'USDC';
    const { NATIVE_TOKENS: NATIVE_SET, getPriceUsd, calcConversionFee, createNativeReceiveWallet } = await import('../services/swapService');
    const isNativeChainLock = NATIVE_SET.has(requestedToken);

    if (!isNativeChainLock && !supportedTokens.includes(requestedToken)) {
      return res.status(400).json({
        error: 'Token not supported',
        message: `Does not accept ${requestedToken} on ${chain}. Supported: ${supportedTokens.join(', ')}`
      });
    }
    if (isNativeChainLock) {
      // Hard kill-switch while the native swap path is being repaired.
      if (String(process.env.NATIVE_PAYMENTS_DISABLED || '').toLowerCase() === 'true') {
        return res.status(400).json({ error: 'Native token payments are temporarily unavailable', message: 'Please pay with a stablecoin (USDC/USDT).' });
      }
      const nativeForAll = String(process.env.FORCE_NATIVE_FOR_ALL || '').toLowerCase() === 'true';
      const walletRecord = await db.merchantWallet.findFirst({ where: { merchantId: order.merchantId, chain, isActive: true } });
      if (!nativeForAll && !walletRecord?.acceptNativeTokens) {
        return res.status(400).json({ error: 'Native tokens not enabled', message: 'This merchant does not accept ETH/SOL/BNB on this chain.' });
      }
    }

    // Determine final amount: if EURC and amountOverride provided, use the converted amount.
    // Stash the original USD amount in metadata so we don't lose it for accounting.
    let finalAmount: any = order.amount;
    const newMetadata: any = { ...md };
    delete newMetadata._chainAgnostic;

    if (requestedToken === 'EURC' && amountOverride && Number(amountOverride) > 0) {
      const orig = Number(order.amount);
      newMetadata._originalUsdAmount = orig;
      finalAmount = amountOverride.toString();
    }

    // ── Native token chain-lock: create receive wallet + price snapshot ──
    let nativeSendAmount: number | undefined;
    let finalPaymentAddress = walletAddress;
    const orderExpiry = isNativeChainLock ? 15 * 60 * 1000 : undefined;

    if (isNativeChainLock) {
      const usdAmt = Number(order.amount);
      const priceSnapshot = await getPriceUsd(requestedToken);
      const conversionFee = calcConversionFee(usdAmt, chain);
      nativeSendAmount = (usdAmt + conversionFee) / priceSnapshot;
      newMetadata._nativeSendAmount = nativeSendAmount;
      newMetadata._nativePriceSnapshot = priceSnapshot;

      await db.order.update({
        where: { id: orderId },
        data: {
          chain: chain as any,
          token: 'USDC',
          amount: finalAmount,
          paymentAddress: walletAddress,
          nativeToken: requestedToken,
          nativePriceSnapshot: priceSnapshot,
          conversionFeeAmount: conversionFee,
          metadata: newMetadata,
          expiresAt: orderExpiry ? new Date(Date.now() + orderExpiry) : undefined,
        },
      });

      const receiveAddress = await createNativeReceiveWallet(orderId, chain);
      await db.order.update({ where: { id: orderId }, data: { paymentAddress: receiveAddress } });
      finalPaymentAddress = receiveAddress;

      const newExpiry = orderExpiry ? new Date(Date.now() + orderExpiry).toISOString() : undefined;
      return res.json({ success: true, chain, token: requestedToken, amount: Number(finalAmount), paymentAddress: finalPaymentAddress, nativeSendAmount, nativeToken: requestedToken, expiresAt: newExpiry });
    }

    await db.order.update({
      where: { id: orderId },
      data: {
        chain: chain as any,
        token: requestedToken,
        amount: finalAmount,
        paymentAddress: walletAddress,
        metadata: Object.keys(newMetadata).length > 0 ? newMetadata : undefined,
      },
    });

    res.json({ success: true, chain, token: requestedToken, amount: Number(finalAmount), paymentAddress: walletAddress });
  } catch (error) {
    console.error('Set order chain error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Set customer wallet on existing order (for manual flow when order was pre-created via API)
 * Helps the scanner match by FROM address. Only allowed for PENDING orders.
 */
/**
 * Customer-initiated cancel. Marks a PENDING order as CANCELLED and fires the
 * order.cancelled webhook (distinct from order.expired, which is the 30-min timeout).
 *
 * Public endpoint — no auth required. Customer-friendly. Only works on PENDING orders;
 * confirmed/refunded/already-cancelled orders are no-ops with a clear message.
 */
router.post('/order/:orderId/cancel', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = (req.body || {}) as { reason?: string };
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, merchantId: true, storeId: true, amount: true, chain: true, externalId: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'CANCELLED') return res.json({ success: true, status: 'CANCELLED', message: 'Already cancelled' });
    if (order.status !== 'PENDING') {
      return res.status(400).json({ error: `Cannot cancel ${order.status} order` });
    }

    const now = new Date();
    await db.$executeRaw`UPDATE orders SET status = 'CANCELLED'::"OrderStatus", "updatedAt" = ${now} WHERE id = ${orderId}`;

    if (order.merchantId) {
      webhookService.sendWebhook(order.merchantId, 'order.cancelled', {
        orderId: order.id,
        externalId: order.externalId || null,
        amount: Number(order.amount),
        chain: order.chain,
        cancelledAt: now.toISOString(),
        reason: reason || 'customer_cancelled',
      }, { storeId: order.storeId || undefined }).catch(err => {
        logger.error('Failed to send order cancel webhook', err as Error, { orderId });
      });
    }

    logger.info('Order cancelled by customer', { orderId, externalId: order.externalId, reason, event: 'order.cancelled' });
    res.json({ success: true, status: 'CANCELLED' });
  } catch (error) {
    logger.error('Cancel order error', error as Error, { orderId: req.params.orderId });
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

router.post('/order/:orderId/wallet', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { customerWallet } = req.body;
    if (!customerWallet || customerWallet.length < 10) {
      return res.status(400).json({ error: 'Valid customerWallet required' });
    }
    const order = await db.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'PENDING') return res.status(400).json({ error: `Order status is ${order.status}` });
    await db.order.update({ where: { id: orderId }, data: { customerWallet } });
    res.json({ success: true });
  } catch (error) {
    console.error('Set customer wallet error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Generic contact-patch endpoint used by the fast A/B variant.
 * Accepts ANY subset of { customerEmail, customerWallet } so the customer can give us
 * whichever they have when they don't have a TX hash. The fast variant uses this when the
 * customer can't paste a TX hash — we still need a way to reach them or match the payment.
 *
 * Only PENDING orders. Email format is loosely validated. Wallet is loosely validated.
 */
router.post('/order/:orderId/contact', rateLimit({
  // No merchantId on this endpoint; rate-limit anonymously to prevent contact-spam attacks
  // (attacker guessing orderIds to overwrite customerEmail/Wallet).
  getMerchantId: async () => null,
  limitAnonymous: true,
  anonymousLimit: 20,
}), async (req, res) => {
  try {
    const { orderId } = req.params;
    const { customerEmail, customerWallet } = (req.body || {}) as { customerEmail?: string; customerWallet?: string };
    const update: any = {};
    if (customerEmail) {
      const e = String(customerEmail).trim().slice(0, 200);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return res.status(400).json({ error: 'Invalid email' });
      update.customerEmail = e;
    }
    if (customerWallet) {
      const w = String(customerWallet).trim().slice(0, 64);
      if (w.length < 10) return res.status(400).json({ error: 'Invalid wallet address' });
      update.customerWallet = w;
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Provide customerEmail and/or customerWallet' });
    const order = await db.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'PENDING') return res.status(400).json({ error: `Order status is ${order.status}` });
    await db.order.update({ where: { id: orderId }, data: update });
    res.json({ success: true, updated: Object.keys(update) });
  } catch (error) {
    console.error('Set customer contact error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Manual TX submission — customer enters txHash when scanner doesn't catch it
 * Auto-verifies on-chain, falls back to manual review
 */
router.post('/order/:orderId/tx', async (req, res) => {
  try {
    const { orderId } = req.params;
    let { txHash, explorerLink } = req.body;

    // Accept a pasted explorer URL in EITHER field (customers paste solscan/etherscan links,
    // not raw hashes). Extract the hash/signature from URLs like
    // https://solscan.io/tx/<sig>?cluster=mainnet or https://basescan.org/tx/0x123...
    const extractTxId = (s: any): string => {
      const str = String(s || '').trim();
      const m = str.match(/(?:\/tx\/|\/transaction\/)([a-zA-Z0-9]+)/);
      return m ? m[1] : str.split(/[?#]/)[0];
    };
    if (!txHash && explorerLink) txHash = extractTxId(explorerLink);
    else if (txHash) txHash = extractTxId(txHash);

    if (!txHash) {
      return res.status(400).json({ error: 'txHash or explorerLink required' });
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { merchant: { select: { id: true, email: true } } },
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'PENDING') {
      return res.status(400).json({ error: `Order status is ${order.status}`, status: order.status });
    }

    // Check expiry
    if (order.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Order has expired', status: 'EXPIRED' });
    }

    // Check if TX already recorded (duplicate prevention — across ALL orders)
    const existingTx = await db.transaction.findUnique({ where: { txHash } });
    if (existingTx) {
      if (existingTx.orderId === orderId && existingTx.status === 'CONFIRMED') {
        return res.json({ success: true, status: 'CONFIRMED', message: 'Already confirmed' });
      }
      return res.status(400).json({ error: 'This transaction has already been used for another order' });
    }

    // Check if order already has a pending manual submission
    const pendingManualTx = await db.transaction.findFirst({
      where: { orderId, status: 'PENDING' },
    });
    if (pendingManualTx) {
      return res.status(400).json({ error: 'A transaction is already pending review for this order', txHash: pendingManualTx.txHash });
    }

    // Try auto-verification on-chain — MUST verify destination, token (== order.token), and amount.
    // EVM manual paths ALSO wait for finality (requiredConfirms) before flipping the order to CONFIRMED.
    let verified = false;
    let pendingFinality = false;
    let verifyError = '';
    try {
      if (order.chain === 'SOLANA_MAINNET') {
        const { SOLANA_TOKEN_MINTS, amountWithinTolerance } = await import('../services/blockchainService');
        const solRpc = process.env.SOLANA_MAINNET_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';

        // Get merchant's ATAs to match against
        const ataRes = await fetch(solRpc, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'getTokenAccountsByOwner',
            params: [order.paymentAddress, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }] }),
          signal: AbortSignal.timeout(8000),
        });
        const ataData: any = await ataRes.json();
        const merchantATAs = new Set((ataData.result?.value || []).map((a: any) => a.pubkey));
        merchantATAs.add(order.paymentAddress); // Also check wallet itself

        // Get the transaction
        const solRes = await fetch(solRpc, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction',
            params: [txHash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] }),
          signal: AbortSignal.timeout(10000),
        });
        const solData: any = await solRes.json();
        const tx = solData.result;

        if (!tx) { verifyError = 'Transaction not found on Solana'; }
        else if (tx.meta?.err) { verifyError = 'Transaction failed on-chain'; }
        else {
          // The transfer MUST use the exact mint for this order's token — reject anything else.
          const expectedMint = SOLANA_TOKEN_MINTS[order.token];
          if (!expectedMint) { verifyError = `Unsupported token ${order.token} for Solana`; }
          else {
            const allIx = [...(tx.transaction?.message?.instructions || []), ...(tx.meta?.innerInstructions?.flatMap((i: any) => i.instructions) || [])];
            let matchedAmount = 0;
            let matchedFrom = '';

            for (const ix of allIx) {
              if (!ix.parsed || ix.program !== 'spl-token') continue;
              if (ix.parsed.type !== 'transferChecked' && ix.parsed.type !== 'transfer') continue;
              const dest = ix.parsed.info.destination;
              if (!merchantATAs.has(dest)) continue; // Not to our wallet
              // Mint must match order.token exactly. Reject legacy `transfer` with no mint.
              const mint = ix.parsed.info.mint;
              if (!mint || mint !== expectedMint) continue;
              const amt = parseFloat(ix.parsed.info.tokenAmount?.uiAmountString || '0');
              matchedAmount += amt;
              matchedFrom = ix.parsed.info.authority || ix.parsed.info.multisigAuthority || ix.parsed.info.signers?.[0] || '';
            }

            const orderAmt = Number(order.amount);
            if (matchedAmount === 0) {
              verifyError = `This transaction does not send ${order.token} to the merchant wallet`;
            } else if (!amountWithinTolerance(matchedAmount, orderAmt)) {
              verifyError = matchedAmount > orderAmt
                ? `Overpayment: TX sends ${matchedAmount.toFixed(6)} ${order.token} but order requires ${orderAmt.toFixed(6)}`
                : `Amount mismatch: TX sends ${matchedAmount.toFixed(6)} ${order.token} but order requires ${orderAmt.toFixed(6)}`;
            } else {
              verified = true;
              await db.transaction.create({
                data: { orderId, txHash, chain: order.chain, amount: matchedAmount,
                  fromAddress: matchedFrom || 'verified', toAddress: order.paymentAddress,
                  status: 'CONFIRMED', confirmations: 1,
                  blockTimestamp: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date() },
              });
              const { OrderService } = await import('../services/orderService');
              await new OrderService().confirmOrder(orderId, { txHash });
            }
          }
        }
      } else if (['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'BNB_MAINNET'].includes(order.chain)) {
        const { ethers } = await import('ethers');
        const { CHAIN_CONFIGS } = await import('../config/chains');
        const { CHAIN_STABLES, getTokenDecimals, amountWithinTolerance } = await import('../services/blockchainService');
        const { getHealthyProvider } = await import('../services/rpcProvider');
        const config = CHAIN_CONFIGS[order.chain as keyof typeof CHAIN_CONFIGS];
        if (!config?.rpcUrl) { verifyError = 'Chain not configured'; }
        else {
          // Use the fallback-aware helper so a single blocked RPC (e.g. llamarpc Cloudflare 403)
          // doesn't surface a wall of challenge-page HTML to the customer. This was the root cause
          // of the UnlockRiver $159.99 USDT incident on 2026-04-22.
          let provider: any = null;
          let receipt: any = null;
          try {
            provider = await getHealthyProvider(order.chain as any);
            receipt = await provider.getTransactionReceipt(txHash);
          } catch (rpcErr: any) {
            logger.warn('manual-tx verify RPC unreachable', {
              orderId, txHash, chain: order.chain,
              err: String(rpcErr?.message || rpcErr).slice(0, 200),
              event: 'manual_tx.rpc_unreachable',
            });
            verifyError = 'We could not reach a blockchain node to verify right now. The scanner will keep watching — your payment will confirm automatically once our nodes recover. No action needed.';
          }
          if (!receipt && !verifyError) { verifyError = 'Transaction not found on this chain'; }
          else if (receipt && receipt.status !== 1) { verifyError = 'Transaction failed on-chain'; }
          else if (receipt && provider) {
            // Only the order's exact token contract counts as a valid transfer source.
            const expectedContract = (CHAIN_STABLES[order.chain]?.[order.token] || '').toLowerCase();
            if (!expectedContract) {
              verifyError = `Unsupported token ${order.token} for ${order.chain}`;
            } else {
              const transferTopic = ethers.id('Transfer(address,address,uint256)');
              const matchingLog = receipt.logs.find((log: any) =>
                log.topics[0] === transferTopic &&
                log.address.toLowerCase() === expectedContract &&
                log.topics[2] && ethers.getAddress('0x' + log.topics[2].slice(26)).toLowerCase() === order.paymentAddress.toLowerCase()
              );
              if (!matchingLog) {
                verifyError = `This transaction does not send ${order.token} to the merchant wallet`;
              } else {
                const decimals = getTokenDecimals(order.chain, order.token);
                const txAmount = parseFloat(ethers.formatUnits(BigInt(matchingLog.data), decimals));
                const evmOrderAmt = Number(order.amount);
                if (!amountWithinTolerance(txAmount, evmOrderAmt)) {
                  verifyError = txAmount > evmOrderAmt
                    ? `Overpayment: TX sends ${txAmount.toFixed(6)} ${order.token} but order requires ${evmOrderAmt.toFixed(6)}`
                    : `Amount mismatch: TX sends ${txAmount.toFixed(6)} ${order.token} but order requires ${evmOrderAmt.toFixed(6)}`;
                } else {
                  // Finality wait: if the TX is on-chain but below requiredConfirms, record as PENDING
                  // and let updatePendingConfirmations promote it when the chain catches up.
                  const currentBlock = await provider.getBlockNumber();
                  const confirmations = Math.max(0, currentBlock - receipt.blockNumber);
                  const isFinal = confirmations >= (config.requiredConfirms || 1);

                  await db.transaction.create({
                    data: {
                      orderId, txHash, chain: order.chain, amount: txAmount,
                      fromAddress: receipt.from, toAddress: order.paymentAddress,
                      blockNumber: BigInt(receipt.blockNumber),
                      status: 'CONFIRMED', // on-chain state
                      confirmations,
                      blockTimestamp: new Date(),
                    },
                  });
                  if (isFinal) {
                    verified = true;
                    const { OrderService } = await import('../services/orderService');
                    await new OrderService().confirmOrder(orderId, { txHash, blockNumber: receipt.blockNumber, confirmations });
                  } else {
                    pendingFinality = true;
                  }
                }
              }
            }
          }
        }
      }
    } catch (verifyErr: any) {
      logger.error('Manual TX auto-verify failed', verifyErr as Error, { orderId, txHash, event: 'manual_tx.verify_error' });
      verifyError = 'Verification failed: ' + verifyErr.message;
    }

    if (verified) {
      return res.json({ success: true, status: 'CONFIRMED', message: 'Payment verified and confirmed!' });
    }
    if (pendingFinality) {
      return res.json({
        success: true,
        status: 'AWAITING_CONFIRMATIONS',
        message: `Transaction found on-chain. Waiting for network confirmations — we'll confirm your order automatically.`,
      });
    }

    // Verification failed with a specific reason — reject, don't queue
    if (verifyError) {
      return res.status(400).json({ error: verifyError, status: 'REJECTED' });
    }

    // Unknown failure — queue for manual review
    await db.transaction.create({
      data: {
        orderId, txHash, chain: order.chain,
        amount: Number(order.amount),
        fromAddress: order.customerWallet || 'manual_submission',
        toAddress: order.paymentAddress,
        status: 'PENDING', confirmations: 0,
        blockTimestamp: new Date(),
      },
    });

    // Notify merchant + admin
    if (order.merchant?.id) {
      webhookService.sendWebhook(order.merchant.id, 'order.created', {
        orderId, txHash, status: 'PENDING_REVIEW',
        message: 'Customer submitted TX hash manually — please verify',
      }).catch(() => {});
    }

    logger.info('Manual TX submitted for review', {
      orderId, txHash, chain: order.chain, event: 'order.manual_tx_submitted',
    });

    res.json({
      success: true,
      status: 'PENDING_REVIEW',
      message: 'Transaction submitted for review. You\'ll be notified once confirmed.',
    });
  } catch (error) {
    console.error('Manual TX submission error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Save widget configuration (merchant auth required)
 */
router.put('/widget-config', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const config = req.body;

    // Validate allowed keys
    const allowed = ['borderStyle', 'theme', 'headerColor', 'headerTextColor', 'logoUrl', 'buttonText', 'fontFamily', 'hideFooter', 'displayName', 'backButtonText'];
    const clean: Record<string, any> = {};
    for (const key of allowed) {
      if (config[key] !== undefined) clean[key] = config[key];
    }

    // Gate hideFooter
    const canHideFooter = ['GROWTH', 'SCALE', 'ENTERPRISE'].includes(merchant.plan);
    if (!canHideFooter) delete clean.hideFooter;

    await db.merchant.update({
      where: { id: merchant.id },
      data: { widgetConfig: clean },
    });

    res.json({ success: true, widgetConfig: clean });
  } catch (error) {
    console.error('Save widget config error:', error);
    res.status(500).json({ error: 'Failed to save widget config' });
  }
});

/**
 * Get widget configuration (public)
 */
router.get('/widget-config', async (req, res) => {
  try {
    const { merchantId } = req.query;
    if (!merchantId) return res.status(400).json({ error: 'merchantId required' });

    const merchant = await db.merchant.findUnique({
      where: { id: merchantId as string },
      select: { widgetConfig: true, plan: true },
    });

    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

    const config = (merchant.widgetConfig as any) || {};
    const canHideFooter = ['GROWTH', 'SCALE', 'ENTERPRISE'].includes(merchant.plan);
    if (!canHideFooter) delete config.hideFooter;

    res.json({ widgetConfig: config });
  } catch (error) {
    console.error('Get widget config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Funnel telemetry — fire-and-forget event capture from checkout page.
 * Appends events to order.metadata.funnel; bounded at 50 events per order to keep payloads sane.
 * Public — no auth. Whitelists event names so attackers can't write arbitrary garbage.
 */
const ALLOWED_FUNNEL_EVENTS = new Set([
  'page_view',
  'merchant_loaded',
  'chains_loaded',
  'chain_selected',
  'wallet_tab_active',
  'wallet_detected',
  'wallet_connect_click',
  'wallet_connected',
  'wallet_connect_failed',
  'pay_click',
  'pay_signed',
  'pay_failed',
  'manual_tab_switch',
  'address_copied',
  'qr_shown',
  'tx_received',
  'tx_confirmed',
  'order_expired',
  'page_left',
  'error_shown',
  'help_opened_manual',
  'help_opened_wallet',
  'pay_mode_stable',
  'pay_mode_crypto',
  'pay_mode_stable_via_banner',
  'token_selected',
]);

router.post('/funnel', async (req, res) => {
  try {
    const { orderId, event, data } = req.body || {};
    if (!orderId || typeof orderId !== 'string') return res.status(400).json({ error: 'orderId required' });
    if (!event || !ALLOWED_FUNNEL_EVENTS.has(event)) return res.status(400).json({ error: 'invalid event' });

    const order = await db.order.findUnique({ where: { id: orderId }, select: { metadata: true } });
    if (!order) return res.status(404).json({ error: 'order not found' });

    const meta = (order.metadata as any) || {};
    const funnel: any[] = Array.isArray(meta.funnel) ? meta.funnel : [];
    funnel.push({
      event,
      ts: new Date().toISOString(),
      ...(data && typeof data === 'object' ? { data } : {}),
    });
    // Keep last 50 to bound row size
    const bounded = funnel.slice(-50);

    await db.order.update({
      where: { id: orderId },
      data: { metadata: { ...meta, funnel: bounded } },
    });

    res.json({ ok: true });
  } catch (err) {
    // Telemetry must never break checkout — swallow errors and return 200.
    console.warn('Funnel event failed:', err instanceof Error ? err.message : err);
    res.json({ ok: false });
  }
});

// ─── Session-level widget telemetry (no orderId required) ─────────────────
// Captures pre-order funnel: which chains/tokens viewed, mode switches, drop-offs.
const ALLOWED_WIDGET_EVENTS = new Set([
  'WIDGET_OPENED',
  'CHAIN_SELECTED',
  'TOKEN_SELECTED',
  'MODE_SWITCHED',
  'PAY_CLICKED',
  'PAYMENT_FAILED',
  'NATIVE_TX_BROADCAST',
  'WALLET_CONNECTED',
  'WALLET_DISCONNECTED',
  'WIDGET_CLOSED',
  // A/B test events for the guided checkout variant
  'VARIANT_ASSIGNED',
  'WIZARD_STEP_VIEWED',
  'WIZARD_ANSWER',
  'WIZARD_ANSWERED',          // wizard's questions answered (pre-payment intent)
  'WIZARD_COMPLETED',         // full wizard → order CONFIRMED (post-payment, true success)
  'WIZARD_SKIPPED',
  'WIZARD_BACK',              // user navigated backward in the wizard
  'MANUAL_TX_SUBMITTED',      // customer clicked "I've sent the payment" (manual flow)
  'ORDER_CONFIRMED',          // order reached terminal CONFIRMED state — true conversion signal
  // Fast-variant (3rd A/B arm): skip sender-wallet upfront, ask for TX/wallet/email AFTER "I've sent it"
  'FAST_STEP_VIEWED',         // user reached a fast-variant-specific screen (e.g. post-send paste-confirm)
  'FAST_CONFIRMATION_PROVIDED', // user pasted TX hash, sender wallet, OR email. details.type='tx_hash'|'wallet'|'email'
  // Funnel drop-off pinpointing — added to close visibility gaps
  'MANUAL_PAY_VIEWED',       // QR / receive address screen displayed
  'WALLET_CONNECT_OPENED',    // customer clicked Connect Wallet
  'WALLET_CONNECT_FAILED',    // wallet refused / rejected / timed out
  'INSUFFICIENT_BALANCE',     // we showed "not enough X" message
  'TX_REJECTED',              // user rejected the tx in their wallet popup
  'ADDRESS_COPIED',           // customer copied the receive address (intent signal)
  'CANCEL_CLICKED',           // customer clicked Cancel Payment
  'BACK_CLICKED',             // customer clicked Back to merchant
  'PAGE_HIDDEN',              // browser tab became hidden (proxy for distraction/abandonment)
]);

router.post('/event', async (req, res) => {
  try {
    const { sessionId, action, merchantId, orderId, details } = req.body || {};
    if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 64) return res.json({ ok: false });
    if (!action || !ALLOWED_WIDGET_EVENTS.has(action)) return res.json({ ok: false });

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
    const userAgent = (req.headers['user-agent'] as string)?.slice(0, 300) ?? null;
    const safeDetails = (details && typeof details === 'object') ? details : {};

    await db.widgetEvent.create({
      data: {
        sessionId, action,
        merchantId: merchantId && typeof merchantId === 'string' ? merchantId : null,
        orderId:    orderId    && typeof orderId    === 'string' ? orderId    : null,
        details: safeDetails, ip, userAgent,
      },
    });
    res.json({ ok: true });
  } catch (err) {
    // Telemetry must never break checkout
    console.warn('Widget event failed:', err instanceof Error ? err.message : err);
    res.json({ ok: false });
  }
});

// ─── Public funnel diagnostics ────────────────────────────────────────────
// Aggregate-only — no PII, no secrets. Used by the morning remote-agent dump.
// Returns: order conversion by merchant, event counts by action + surface, wizard stats.
router.get('/diagnostics/funnel', async (req, res) => {
  try {
    const hours = Math.min(Math.max(parseInt(req.query.hours as string) || 12, 1), 168);
    const since = new Date(Date.now() - hours * 3600_000);

    // Order conversion per merchant (by company name only — no emails/IDs leaked)
    const orderRows = await db.order.groupBy({
      by: ['merchantId', 'status'],
      where: { createdAt: { gte: since } },
      _count: true,
    });
    const merchantIds = [...new Set(orderRows.map(r => r.merchantId).filter((x): x is string => !!x))];
    const merchants = merchantIds.length > 0
      ? await db.merchant.findMany({ where: { id: { in: merchantIds } }, select: { id: true, companyName: true } })
      : [];
    const nameByMid = new Map(merchants.map(m => [m.id, m.companyName]));

    const byMerchant: Record<string, Record<string, number>> = {};
    for (const r of orderRows) {
      const name = r.merchantId ? (nameByMid.get(r.merchantId) ?? 'unknown') : 'demo';
      byMerchant[name] = byMerchant[name] ?? {};
      byMerchant[name][r.status] = r._count;
    }

    // Event counts by action (last N hours)
    const eventRows = await db.widgetEvent.groupBy({
      by: ['action'], where: { createdAt: { gte: since } }, _count: true,
    });
    const eventsByAction: Record<string, number> = {};
    for (const r of eventRows) eventsByAction[r.action] = r._count;

    // Event counts grouped by surface (extract from details JSON)
    const allEvents = await db.widgetEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { action: true, details: true, sessionId: true },
    });
    const bySurface = { page: 0, widget: 0, unknown: 0 };
    const sessionsBySurface = { page: new Set<string>(), widget: new Set<string>() };
    for (const e of allEvents) {
      const surface = (e.details as any)?.surface;
      if (surface === 'page')   { bySurface.page++;   sessionsBySurface.page.add(e.sessionId); }
      else if (surface === 'widget') { bySurface.widget++; sessionsBySurface.widget.add(e.sessionId); }
      else bySurface.unknown++;
    }

    // Wizard funnel: per-session bucketing
    type Sess = { variant: string | null; stepsViewed: number; answered: boolean; completed: boolean; skipped: boolean; surface: string | null; converted: boolean };
    const sessions = new Map<string, Sess>();
    for (const e of allEvents) {
      const s = sessions.get(e.sessionId) ?? { variant: null, stepsViewed: 0, answered: false, completed: false, skipped: false, surface: null, converted: false };
      const d = (e.details as any) ?? {};
      if (d.surface && !s.surface) s.surface = d.surface;
      if (e.action === 'VARIANT_ASSIGNED' && d.variant) s.variant = d.variant;
      if (e.action === 'WIZARD_STEP_VIEWED') s.stepsViewed++;
      if (e.action === 'WIZARD_ANSWER') s.answered = true;
      if (e.action === 'WIZARD_COMPLETED') s.completed = true;
      if (e.action === 'WIZARD_SKIPPED') s.skipped = true;
      if (e.action === 'PAY_CLICKED' || e.action === 'NATIVE_TX_BROADCAST') s.converted = true;
      sessions.set(e.sessionId, s);
    }
    const ab = {
      control: { total: 0, converted: 0 },
      guided:  { total: 0, converted: 0, completed: 0, skipped: 0, abandonedMidWizard: 0 },
    };
    for (const s of sessions.values()) {
      if (s.variant === 'control') { ab.control.total++; if (s.converted) ab.control.converted++; }
      else if (s.variant === 'guided') {
        ab.guided.total++;
        if (s.converted) ab.guided.converted++;
        if (s.completed) ab.guided.completed++;
        if (s.skipped)   ab.guided.skipped++;
        if (s.stepsViewed > 0 && !s.completed && !s.skipped) ab.guided.abandonedMidWizard++;
      }
    }

    res.json({
      windowHours: hours,
      since: since.toISOString(),
      checkedAt: new Date().toISOString(),
      orders: { byMerchant },
      events: { byAction: eventsByAction, bySurface, uniqueSessions: { page: sessionsBySurface.page.size, widget: sessionsBySurface.widget.size } },
      ab,
    });
  } catch (error) {
    console.error('Diagnostics endpoint error:', error);
    res.status(500).json({ error: 'Failed to compute diagnostics' });
  }
});

// ─── Native token price feed (public, cached) ────────────────────────────────
router.get('/native-price', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'token required' });
    const { NATIVE_TOKENS, getPriceUsd } = await import('../services/swapService');
    if (!NATIVE_TOKENS.has(token.toUpperCase())) return res.status(400).json({ error: 'unsupported token' });
    const priceUsd = await getPriceUsd(token.toUpperCase());
    res.json({ token: token.toUpperCase(), priceUsd, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'Price unavailable' });
  }
});

// ─── Stablo customer support chat ────────────────────────────────────────────
// Public, order-scoped. Rate-limited in memory (good enough for serverless).
const stabloRateMap = new Map<string, { count: number; resetAt: number }>();

router.post('/support', async (req, res) => {
  try {
    const { orderId, message } = req.body || {};
    if (!orderId || typeof orderId !== 'string') return res.status(400).json({ error: 'orderId required' });
    if (!message || typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message required' });
    if (message.length > 500) return res.status(400).json({ error: 'Message too long' });

    // Rate limit: 20 msgs per orderId per hour
    const now = Date.now();
    const rl = stabloRateMap.get(orderId);
    if (rl && rl.resetAt > now && rl.count >= 20) {
      return res.json({ reply: "You've sent a lot of messages — take a breath and try again in a bit. If you're really stuck, contact the store directly." });
    }
    if (!rl || rl.resetAt <= now) {
      stabloRateMap.set(orderId, { count: 1, resetAt: now + 60 * 60 * 1000 });
    } else {
      rl.count++;
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { amount: true, token: true, chain: true, status: true, expiresAt: true, nativeToken: true },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const expiresIn = order.expiresAt
      ? Math.max(0, Math.round((new Date(order.expiresAt).getTime() - now) / 60000))
      : null;

    const isNativeOrder = order.nativeToken != null;
    const systemPrompt = `You are Stablo, StablePay's payment assistant. Friendly, confident, and to the point. Max 2 sentences per reply.

THIS ORDER: $${Number(order.amount).toFixed(2)} — paying with ${order.nativeToken || order.token} on ${String(order.chain).replace(/_/g, ' ')} — status: ${order.status}${expiresIn !== null ? `, expires in ${expiresIn} min` : ''}.${isNativeOrder ? `\nThis is a NATIVE TOKEN order: customer sends ${order.nativeToken}, which is automatically swapped to ${(order as any).nativeReceiveWallet ? 'stablecoin' : 'USDC'} — they absorb a 1.5% conversion fee.` : ''}

KNOW THESE ANSWERS COLD:

Is it safe?
"Yes — your payment goes directly to the merchant on-chain. StablePay never holds your funds permanently, and every transaction is verifiable on the blockchain."

Will I get a receipt?
"Yes — as soon as your payment confirms, a receipt is emailed to the address you entered. Usually arrives within a minute."

What crypto do you accept?
"We accept USDC, USDT, and EURC on Base, Ethereum, Polygon, Arbitrum, BNB Chain, and Solana. You can also pay with ETH, SOL, BNB, MATIC, or ARB — we automatically convert them for you (a 1.5% fee applies)."

Can I pay with ETH / SOL / BNB / other native coins?
"Yes — select ETH, SOL, or BNB in the token selector and we'll handle the conversion automatically. A 1.5% conversion fee applies; use USDC to skip it."

I'm paying with ${isNativeOrder ? order.nativeToken : 'native token'} — what happens?
"You send ${isNativeOrder ? order.nativeToken : 'the native token'} to the address shown; we automatically swap it to a stablecoin and deliver it to the merchant. The price is locked for 15 minutes — complete your payment before it expires."

How long does it take?
"Usually under 60 seconds on Base or Polygon. Ethereum can take 2–5 minutes. ${isNativeOrder ? 'Native token orders add ~10–30 seconds for the on-chain swap.' : ''}"

What if it doesn't confirm?
"Make sure you sent to the exact address shown and the exact amount. If it's been over 5 minutes, paste your transaction ID in the 'Still waiting?' box — we'll look it up."

MORE RULES:
- If they don't have any crypto: tell them to buy USDC on Coinbase, Binance, or Kraken, then come back. Avoid recommending direct ETH purchases — stablecoins are simpler.
- Refunds or delivery issues: tell them to contact the store directly — you only handle the payment.
- Never reveal fees, internal systems, swap providers, or backend details.
- If the order is expired: tell them to go back and start a new checkout — expired orders cannot be paid.`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: systemPrompt,
      messages: [{ role: 'user', content: message.trim() }],
    });

    const reply = response.content[0]?.type === 'text' ? response.content[0].text : "Sorry, I couldn't process that. Try refreshing the page.";

    // Persist both turns — fire and forget, never block the response
    db.stabloChat.createMany({
      data: [
        { orderId, role: 'user', content: message.trim() },
        { orderId, role: 'bot', content: reply },
      ],
    }).catch(e => console.warn('Stablo persist failed:', e instanceof Error ? e.message : e));

    res.json({ reply });
  } catch (err) {
    console.error('Stablo support error:', err instanceof Error ? err.message : err);
    res.json({ reply: "Something went wrong on my end. Try refreshing — the payment page is still live." });
  }
});

export { router as embedRouter };
