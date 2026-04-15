import { Router } from 'express';
import { z } from 'zod';
import { OrderService } from '../services/orderService';
import { canProcessPayment } from '../config/pricing';
import { rateLimit } from '../middleware/rateLimit';
import { requireMerchantAuth, AuthenticatedRequest } from '../middleware/auth';
import { db } from '../config/database';

const router = Router();
const orderService = new OrderService();

const createOrderSchema = z.object({
  amount: z.number().positive(),
  chain: z.enum([
    'BASE_MAINNET', 'BASE_SEPOLIA',
    'ETHEREUM_MAINNET', 'ETHEREUM_SEPOLIA',
    'POLYGON_MAINNET', 'POLYGON_MUMBAI',
    'ARBITRUM_MAINNET', 'ARBITRUM_SEPOLIA',
    'SOLANA_MAINNET', 'SOLANA_DEVNET',
    'BNB_MAINNET', 'TRON_MAINNET',
  ]),
  merchantId: z.string().optional(),
  customerEmail: z.string().email().optional(),
  customerName: z.string().min(1).optional(),
  expiryMinutes: z.number().positive().optional(),
  externalId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

router.post('/', rateLimit({
  getMerchantId: async (req) => req.body.merchantId || null,
  limitAnonymous: true,
  anonymousLimit: 10 // 10 orders per hour for unauthenticated requests
}), async (req, res) => {
  try {
    console.log('Creating order with data:', req.body);
    const data = createOrderSchema.parse(req.body);
    console.log('Parsed order data:', data);

    // Check tier limits if merchantId provided
    if (req.body.merchantId) {
      const limitCheck = await orderService.checkTierLimits(req.body.merchantId, data.amount);
      if (!limitCheck.allowed) {
        return res.status(403).json({
          error: 'Tier limit exceeded',
          message: limitCheck.reason,
          upgradeRequired: limitCheck.upgradeRequired || true,
          upgradeUrl: '/pricing.html'
        });
      }
    }

    const order = await orderService.createOrder(data);
    console.log('Order created successfully:', order.orderId);
    res.status(201).json(order);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Validation error:', error.errors);
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      console.error('Create order error:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      res.status(500).json({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
});

// Public: customer order history lookup by wallet address only
// Wallet addresses are public on-chain, so this doesn't leak private info
router.get('/history/lookup', rateLimit({
  getMerchantId: async () => null,
  limitAnonymous: true,
  anonymousLimit: 20
}), async (req, res) => {
  try {
    const wallet = (req.query.wallet as string || '').trim();

    if (!wallet || wallet.length < 10) {
      return res.status(400).json({ error: 'Valid wallet address required' });
    }

    const orders = await db.order.findMany({
      where: {
        status: { in: ['CONFIRMED', 'REFUNDED'] },
        OR: [
          { customerWallet: { equals: wallet, mode: 'insensitive' } },
          { transactions: { some: { fromAddress: { equals: wallet, mode: 'insensitive' } } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        amount: true,
        token: true,
        chain: true,
        status: true,
        createdAt: true,
        merchant: { select: { companyName: true } },
        transactions: {
          where: { status: 'CONFIRMED' },
          take: 1,
          select: { txHash: true, fromAddress: true, blockTimestamp: true },
        },
      },
    });

    const result = orders.map(o => ({
      id: o.id,
      amount: Number(o.amount),
      token: o.token,
      chain: o.chain,
      status: o.status,
      merchant: o.merchant?.companyName || null,
      date: o.createdAt.toISOString(),
      txHash: o.transactions[0]?.txHash || null,
      paidAt: o.transactions[0]?.blockTimestamp?.toISOString() || null,
    }));

    res.json({ orders: result, total: result.length });
  } catch (error) {
    console.error('Customer history lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:orderId', rateLimit({
  getMerchantId: async (req) => req.query.merchantId as string || null,
  limitAnonymous: true,
  anonymousLimit: 30
}), async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await orderService.getOrder(orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json(order);
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', requireMerchantAuth, async (req, res) => {
  try {
    const merchantId = (req as AuthenticatedRequest).merchant.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const includeTransactions = req.query.includeTransactions === 'true';
    const status = req.query.status as string | undefined;

    // Only return orders belonging to this merchant
    const where: any = { merchantId };
    if (status && ['PENDING', 'CONFIRMED', 'REFUNDED', 'EXPIRED', 'CANCELLED'].includes(status)) {
      where.status = status;
    }

    const orders = await db.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: includeTransactions ? { transactions: true } : undefined,
    });
    const total = await db.order.count({ where });

    // Serialize BigInt values (blockNumber) to strings for JSON
    const safeOrders = JSON.parse(JSON.stringify(orders, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    res.json({ orders: safeOrders, total, page, limit });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add transaction hash to order (merchant auth required)
router.post('/:orderId/transaction', requireMerchantAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { txHash, fromAddress } = req.body;
    
    if (!txHash) {
      return res.status(400).json({ error: 'Transaction hash required' });
    }
    
    const order = await orderService.updateOrderWithTransaction(orderId, txHash, fromAddress);
    res.json({ message: 'Transaction added to order', order });
  } catch (error) {
    console.error('Update order transaction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Confirm order with transaction details (merchant auth required)
router.post('/:orderId/confirm', requireMerchantAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { txHash, blockNumber, confirmations } = req.body;

    // Check if merchant is suspended
    const existingOrder = await db.order.findUnique({
      where: { id: orderId },
      include: {
        merchant: {
          select: { isSuspended: true, id: true }
        }
      }
    });

    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (existingOrder.merchant?.isSuspended) {
      return res.status(403).json({
        error: 'Merchant account suspended',
        message: 'Payment processing is suspended due to unpaid fees.',
        suspended: true
      });
    }

    const order = await orderService.confirmOrder(orderId, {
      txHash,
      blockNumber: blockNumber ? parseInt(blockNumber) : undefined,
      confirmations
    });

    // Volume is now updated atomically inside confirmOrder

    res.json({ message: 'Order confirmed', order });
  } catch (error) {
    console.error('Confirm order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as ordersRouter };