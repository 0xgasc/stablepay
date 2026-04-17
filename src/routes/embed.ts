import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { rateLimit } from '../middleware/rateLimit';
import { requireMerchantAuth } from '../middleware/auth';
import { idempotency } from '../middleware/idempotency';
import { logger } from '../utils/logger';
import { webhookService } from '../services/webhookService';

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
  token: z.enum(['USDC', 'USDT', 'EURC']).default('USDC'),
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
          select: { chain: true, address: true, supportedTokens: true }
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
        for (const sw of store.wallets) byChain.set(sw.chain, sw as any);
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

    res.json({
      merchantId,
      storeId: storeId || null,
      merchantName: storeBranding?.displayName || merchant.companyName,
      merchantWebsite: (storeId ? (await db.store.findUnique({ where: { id: storeId as string }, select: { website: true } }))?.website : null) || merchant.website || null,
      chains: finalWallets.map(w => w.chain),
      wallets: finalWallets,
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

    const wallet = merchant.wallets[0];
    if (!wallet) {
      return res.status(400).json({
        error: 'No wallet configured',
        message: chainAgnostic
          ? 'Merchant has no active wallets configured'
          : `Merchant has no wallet for ${data.chain}`
      });
    }

    // Enforce token only when chain is locked (chain-agnostic orders re-validate at chain selection)
    if (!chainAgnostic) {
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

    const order = await db.order.create({
      data: {
        merchantId: data.merchantId,
        storeId: resolvedStoreId,
        amount: data.amount,
        token: data.token,
        chain: resolvedChain,
        customerEmail: data.customerEmail || null,
        customerName: data.customerName || data.productName || null,
        paymentAddress,
        customerWallet: data.customerWallet || null,
        paymentMethod: data.paymentMethod || null,
        source: data.source || 'EMBED_WIDGET',
        externalId: data.externalId || null,
        metadata: Object.keys(finalMetadata).length > 0 ? finalMetadata : undefined,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });

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
        paymentAddress: order.paymentAddress,
        expiresAt: order.expiresAt.toISOString(),
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
        transactions: {
          where: { status: 'CONFIRMED' },
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

    const txHash = order.transactions[0]?.txHash || null;
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
        select: { chain: true, address: true, supportedTokens: true },
      });
      availableChains = wallets;
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
      confirmedAt: order.transactions[0]?.blockTimestamp?.toISOString() || null,
      expiresAt: order.expiresAt.toISOString(),
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

    // Validate token
    const requestedToken = token || order.token || 'USDC';
    if (!supportedTokens.includes(requestedToken)) {
      return res.status(400).json({
        error: 'Token not supported',
        message: `Does not accept ${requestedToken} on ${chain}. Supported: ${supportedTokens.join(', ')}`
      });
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
 * Manual TX submission — customer enters txHash when scanner doesn't catch it
 * Auto-verifies on-chain, falls back to manual review
 */
router.post('/order/:orderId/tx', async (req, res) => {
  try {
    const { orderId } = req.params;
    let { txHash, explorerLink } = req.body;

    // Parse txHash from explorer link if provided
    if (!txHash && explorerLink) {
      // Extract hash from URLs like https://basescan.org/tx/0x123... or https://solscan.io/tx/abc...
      const match = explorerLink.match(/(?:\/tx\/|\/transaction\/)([a-zA-Z0-9]+)/);
      if (match) txHash = match[1];
    }

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
        const config = CHAIN_CONFIGS[order.chain as keyof typeof CHAIN_CONFIGS];
        if (!config?.rpcUrl) { verifyError = 'Chain not configured'; }
        else {
          const provider = new ethers.JsonRpcProvider(config.rpcUrl);
          const receipt = await provider.getTransactionReceipt(txHash);
          if (!receipt) { verifyError = 'Transaction not found on this chain'; }
          else if (receipt.status !== 1) { verifyError = 'Transaction failed on-chain'; }
          else {
            // Only the order's exact token contract counts as a valid transfer source.
            const expectedContract = (CHAIN_STABLES[order.chain]?.[order.token] || '').toLowerCase();
            if (!expectedContract) {
              verifyError = `Unsupported token ${order.token} for ${order.chain}`;
            } else {
              const transferTopic = ethers.id('Transfer(address,address,uint256)');
              const matchingLog = receipt.logs.find(log =>
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

export { router as embedRouter };
