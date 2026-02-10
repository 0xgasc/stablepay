import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { rateLimit } from '../middleware/rateLimit';
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
  productName: z.string().optional(),
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

    // Get merchant's configured wallets
    const wallets = await db.merchantWallet.findMany({
      where: {
        merchantId: merchantId as string,
        isActive: true
      },
      select: { chain: true }
    });

    // Check if merchant exists and is active
    const merchant = await db.merchant.findUnique({
      where: { id: merchantId as string },
      select: { id: true, isActive: true, isSuspended: true, companyName: true }
    });

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    if (merchant.isSuspended) {
      return res.status(503).json({ error: 'Merchant temporarily unavailable' });
    }

    res.json({
      merchantId,
      merchantName: merchant.companyName,
      chains: wallets.map(w => w.chain)
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
    const order = await db.order.create({
      data: {
        merchantId: data.merchantId,
        amount: data.amount,
        token: data.token,
        chain: data.chain as any,
        customerEmail: data.customerEmail || null,
        customerName: data.customerName || data.productName || null,
        paymentAddress: wallet.address,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 min expiry
      }
    });

    logger.info('Embed order created', {
      orderId: order.id,
      merchantId: data.merchantId,
      amount: data.amount,
      chain: data.chain,
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

    res.json({
      id: order.id,
      status: order.status,
      amount: Number(order.amount),
      token: order.token,
      chain: order.chain,
      txHash: order.transactions[0]?.txHash || null,
      confirmedAt: order.transactions[0]?.blockTimestamp?.toISOString() || null
    });
  } catch (error) {
    console.error('Get embed order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as embedRouter };
