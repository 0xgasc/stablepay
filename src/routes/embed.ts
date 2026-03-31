import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { rateLimit } from '../middleware/rateLimit';
import { requireMerchantAuth } from '../middleware/auth';
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
  amount: z.number().positive(),
  chain: z.string().min(1),
  token: z.enum(['USDC', 'USDT', 'EURC']).default('USDC'),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerName: z.string().optional(),
  customerWallet: z.string().optional(),  // Customer's wallet for precise FROM matching
  paymentMethod: z.enum(['WALLET_CONNECT', 'MANUAL_SEND']).optional(),
  source: z.enum(['EMBED_WIDGET', 'CHECKOUT_LINK', 'DASHBOARD', 'API', 'INVOICE']).optional(),
  productName: z.string().optional(),
  externalId: z.string().optional(),   // Merchant's own order/reference ID
  metadata: z.record(z.any()).optional()
});

/**
 * Get available chains for a merchant
 * Used by widget to show chain selector
 */
router.get('/chains', async (req, res) => {
  try {
    const { merchantId } = req.query;

    if (!merchantId) {
      return res.status(400).json({ error: 'merchantId is required' });
    }

    // Get merchant + wallets in one query
    const merchant = await db.merchant.findUnique({
      where: { id: merchantId as string },
      select: {
        id: true, isActive: true, isSuspended: true, companyName: true, plan: true, widgetConfig: true,
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

    res.json({
      merchantId,
      merchantName: merchant.companyName,
      chains: merchant.wallets.map(w => w.chain),
      wallets: merchant.wallets,
      widgetConfig,
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
}), async (req, res) => {
  try {
    const data = checkoutSchema.parse(req.body);

    // Verify merchant
    const merchant = await db.merchant.findUnique({
      where: { id: data.merchantId },
      include: {
        wallets: {
          where: { chain: data.chain as any, isActive: true },
          take: 1
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

    const wallet = merchant.wallets[0];
    if (!wallet) {
      return res.status(400).json({
        error: 'No wallet configured',
        message: `Merchant has no wallet for ${data.chain}`
      });
    }

    // Create order
    // Cancel any existing pending orders for this merchant + customer wallet combo
    // Prevents duplicate order matching confusion
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

    const order = await db.order.create({
      data: {
        merchantId: data.merchantId,
        amount: data.amount,
        token: data.token,
        chain: data.chain as any,
        customerEmail: data.customerEmail || null,
        customerName: data.customerName || data.productName || null,
        paymentAddress: wallet.address,
        customerWallet: data.customerWallet || null,
        paymentMethod: data.paymentMethod || null,
        source: data.source || 'EMBED_WIDGET',
        externalId: data.externalId || null,
        metadata: data.metadata || undefined,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });

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
      amount: data.amount,
      chain: data.chain,
      paymentAddress: wallet.address,
      source: 'embed_widget',
      productName: data.productName,
      metadata: data.metadata
    }).catch(err => {
      logger.error('Failed to send order.created webhook', err as Error, { orderId: order.id });
    });

    res.status(201).json({
      success: true,
      order: {
        id: order.id,
        amount: Number(order.amount),
        token: order.token,
        chain: order.chain,
        paymentAddress: order.paymentAddress,
        expiresAt: order.expiresAt.toISOString()
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
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
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

    res.json({
      id: order.id,
      status: order.status,
      amount: Number(order.amount),
      token: order.token,
      chain: order.chain,
      paymentAddress: order.paymentAddress,
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

    // Check if TX already recorded
    const existingTx = await db.transaction.findUnique({ where: { txHash } });
    if (existingTx) {
      return res.status(400).json({ error: 'Transaction already recorded' });
    }

    // Try auto-verification on-chain
    let verified = false;
    try {
      if (order.chain === 'SOLANA_MAINNET') {
        // Verify Solana TX via RPC
        const solRpc = process.env.SOLANA_MAINNET_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';
        const solRes = await fetch(solRpc, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'getTransaction',
            params: [txHash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
          }),
          signal: AbortSignal.timeout(10000),
        });
        const solData: any = await solRes.json();
        if (solData.result && !solData.result.meta?.err) {
          verified = true;
          // Create confirmed transaction
          await db.transaction.create({
            data: {
              orderId, txHash, chain: order.chain,
              amount: Number(order.amount),
              fromAddress: order.customerWallet || 'manual',
              toAddress: order.paymentAddress,
              status: 'CONFIRMED', confirmations: 1,
              blockTimestamp: solData.result.blockTime ? new Date(solData.result.blockTime * 1000) : new Date(),
            },
          });
          const { OrderService } = await import('../services/orderService');
          await new OrderService().confirmOrder(orderId, { txHash });
        }
      } else if (['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'BNB_MAINNET'].includes(order.chain)) {
        // Verify EVM TX via RPC
        const { ethers } = await import('ethers');
        const { CHAIN_CONFIGS } = await import('../config/chains');
        const config = CHAIN_CONFIGS[order.chain as keyof typeof CHAIN_CONFIGS];
        if (config?.rpcUrl) {
          const provider = new ethers.JsonRpcProvider(config.rpcUrl);
          const receipt = await provider.getTransactionReceipt(txHash);
          if (receipt && receipt.status === 1) {
            verified = true;
            await db.transaction.create({
              data: {
                orderId, txHash, chain: order.chain,
                amount: Number(order.amount),
                fromAddress: receipt.from,
                toAddress: order.paymentAddress,
                blockNumber: BigInt(receipt.blockNumber),
                status: 'CONFIRMED', confirmations: 1,
                blockTimestamp: new Date(),
              },
            });
            const { OrderService } = await import('../services/orderService');
            await new OrderService().confirmOrder(orderId, { txHash, blockNumber: receipt.blockNumber });
          }
        }
      }
    } catch (verifyErr: any) {
      console.error(`[manual-tx] Auto-verify failed for ${orderId}:`, verifyErr.message);
    }

    if (verified) {
      return res.json({ success: true, status: 'CONFIRMED', message: 'Payment verified and confirmed!' });
    }

    // Auto-verify failed — queue for manual review
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
    const allowed = ['borderStyle', 'theme', 'headerColor', 'headerTextColor', 'logoUrl', 'buttonText', 'hideFooter'];
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
