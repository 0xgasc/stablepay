import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { PRICING_TIERS } from '../config/pricing';
import { rateLimit } from '../middleware/rateLimit';
import { logger } from '../utils/logger';
import { webhookService } from '../services/webhookService';

const router = Router();

const createRefundSchema = z.object({
  orderId: z.string().min(1),
  amount: z.string().min(1), // String to match Decimal in DB
  reason: z.string().min(1),
  customerEmail: z.string().email().optional(), // For customer-initiated refunds
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'PROCESSED']).optional(),
});

// Middleware to verify merchant auth token
async function requireMerchantAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const merchant = await db.merchant.findFirst({
      where: { loginToken: token },
      select: { id: true, email: true, companyName: true }
    });

    if (!merchant) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach merchant to request
    (req as any).merchant = merchant;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// Helper to verify merchant owns the refund's order
async function verifyRefundOwnership(refundId: string, merchantId: string): Promise<{ valid: boolean; refund?: any; error?: string }> {
  const refund = await db.refund.findUnique({
    where: { id: refundId },
    include: {
      order: {
        include: { transactions: true }
      }
    }
  });

  if (!refund) {
    return { valid: false, error: 'Refund not found' };
  }

  if (refund.order.merchantId !== merchantId) {
    return { valid: false, error: 'Not authorized to manage this refund' };
  }

  return { valid: true, refund };
}

// ============================================
// SPECIFIC ROUTES FIRST (before /:refundId)
// ============================================

// Get pending refunds for a merchant
router.get('/pending', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;

    const refunds = await db.refund.findMany({
      where: {
        status: 'PENDING',
        order: { merchantId: merchant.id }
      },
      include: {
        order: {
          select: {
            id: true,
            amount: true,
            chain: true,
            customerEmail: true,
            merchantId: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ refunds });
  } catch (error) {
    console.error('Get pending refunds error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get refund stats for a merchant
router.get('/stats', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;

    const where = {
      order: { merchantId: merchant.id }
    };

    const [total, pending, processed, rejected] = await Promise.all([
      db.refund.count({ where }),
      db.refund.count({ where: { ...where, status: 'PENDING' } }),
      db.refund.count({ where: { ...where, status: 'PROCESSED' } }),
      db.refund.count({ where: { ...where, status: 'REJECTED' } }),
    ]);

    const totalAmount = await db.refund.aggregate({
      where: { ...where, status: 'PROCESSED' },
      _sum: { amount: true }
    });

    res.json({
      total,
      pending,
      processed,
      rejected,
      totalRefunded: totalAmount._sum.amount || 0
    });
  } catch (error) {
    console.error('Get refund stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GENERAL ROUTES
// ============================================

// Get refunds for a merchant (list)
router.get('/', async (req, res) => {
  try {
    const { merchantId, orderId } = req.query;

    // Check auth header for merchantId validation
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (merchantId && token) {
      // Verify token matches merchantId
      const merchant = await db.merchant.findFirst({
        where: { id: merchantId as string, loginToken: token }
      });
      if (!merchant) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    let where: any = {};

    if (orderId) {
      where.orderId = orderId as string;
    }

    if (merchantId) {
      where.order = {
        merchantId: merchantId as string
      };
    }

    const refunds = await db.refund.findMany({
      where,
      include: {
        order: {
          select: {
            id: true,
            amount: true,
            chain: true,
            customerEmail: true,
            merchantId: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ refunds });
  } catch (error) {
    console.error('Get refunds error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create refund (customer or merchant initiated)
router.post('/', rateLimit({
  getMerchantId: async (req) => {
    // Extract merchantId from the order
    if (req.body.orderId) {
      const order = await db.order.findUnique({
        where: { id: req.body.orderId },
        select: { merchantId: true }
      });
      return order?.merchantId || null;
    }
    return null;
  },
  limitAnonymous: false // Don't allow anonymous refund creation
}), async (req, res) => {
  try {
    const data = createRefundSchema.parse(req.body);

    // Verify order exists and get original amount
    const order = await db.order.findUnique({
      where: { id: data.orderId },
      include: {
        transactions: true,
        refunds: true,
        merchant: {
          select: {
            id: true,
            plan: true,
            companyName: true
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Only allow refunds on CONFIRMED or PAID orders
    if (order.status !== 'CONFIRMED' && order.status !== 'PAID') {
      return res.status(400).json({
        error: 'Order not eligible for refund',
        message: `Cannot refund an order with status ${order.status}. Only CONFIRMED or PAID orders can be refunded.`,
      });
    }

    // If customer email provided, verify it matches the order
    if (data.customerEmail && order.customerEmail) {
      if (data.customerEmail.toLowerCase() !== order.customerEmail.toLowerCase()) {
        return res.status(403).json({
          error: 'Email does not match order',
          message: 'The email address provided does not match the email associated with this order.'
        });
      }
    }

    // Check tier permissions for refunds
    if (order.merchant) {
      const merchantPlan = order.merchant.plan || 'FREE';
      const tier = PRICING_TIERS[merchantPlan];

      if (!tier || !tier.features.refunds) {
        return res.status(403).json({
          error: 'Refunds not available',
          message: `Refunds are not available on ${tier?.name || 'FREE'} plan. Upgrade to STARTER or higher to process refunds.`,
          upgradeRequired: true,
          upgradeUrl: '/pricing.html',
          currentPlan: merchantPlan,
          requiredFeature: 'refunds'
        });
      }
    }

    // Validate refund amount doesn't exceed original
    const refundAmount = parseFloat(data.amount);
    const orderAmount = parseFloat(order.amount.toString());

    if (refundAmount > orderAmount) {
      return res.status(400).json({
        error: 'Refund amount cannot exceed original order amount',
        maxAmount: orderAmount
      });
    }

    // Check existing refunds don't exceed total
    const existingRefunds = order.refunds.filter(r => r.status !== 'REJECTED');
    const totalRefunded = existingRefunds.reduce((sum, r) => sum + Number(r.amount), 0);

    if (totalRefunded + refundAmount > orderAmount) {
      return res.status(400).json({
        error: 'Total refund amount would exceed order amount',
        maxAmount: orderAmount - totalRefunded,
        alreadyRefunded: totalRefunded
      });
    }

    // Create refund record
    const refund = await db.refund.create({
      data: {
        orderId: data.orderId,
        amount: data.amount,
        reason: data.reason,
        status: data.status || 'PENDING',
      }
    });

    logger.info('Refund request created', {
      refundId: refund.id,
      orderId: data.orderId,
      amount: refundAmount,
      event: 'refund.created'
    });

    // Send webhook for refund request
    if (order.merchantId) {
      webhookService.sendWebhook(order.merchantId, 'refund.requested', {
        refundId: refund.id,
        orderId: data.orderId,
        amount: refundAmount,
        reason: data.reason,
        status: refund.status,
      }).catch(err => {
        logger.error('Failed to send refund.requested webhook', err as Error, { refundId: refund.id });
      });
    }

    res.status(201).json({ success: true, refund });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      console.error('Create refund error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
});

// ============================================
// PARAMETERIZED ROUTES LAST
// ============================================

// Approve refund (merchant action)
router.post('/:refundId/approve', requireMerchantAuth, async (req, res) => {
  try {
    const { refundId } = req.params;
    const merchant = (req as any).merchant;

    // Verify ownership
    const { valid, refund, error } = await verifyRefundOwnership(refundId, merchant.id);
    if (!valid) {
      return res.status(refund ? 403 : 404).json({ error });
    }

    if (refund.status !== 'PENDING') {
      return res.status(400).json({ error: 'Refund is not pending' });
    }

    const updated = await db.refund.update({
      where: { id: refundId },
      data: {
        status: 'APPROVED',
        approvedBy: merchant.email || 'MERCHANT'
      },
      include: {
        order: {
          include: { transactions: true }
        }
      }
    });

    // Get customer wallet from payment transaction
    const paymentTx = updated.order.transactions.find((tx: any) => tx.status === 'CONFIRMED');

    logger.info('Refund approved', {
      refundId,
      approvedBy: merchant.email,
      merchantId: merchant.id,
      event: 'refund.approved'
    });

    res.json({
      success: true,
      refund: {
        ...updated,
        amount: Number(updated.amount)
      },
      customerWallet: paymentTx?.fromAddress,
      nextStep: 'Send funds to customer wallet and submit tx hash via POST /refunds/:id/process'
    });
  } catch (error) {
    console.error('Approve refund error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Reject refund (merchant action)
router.post('/:refundId/reject', requireMerchantAuth, async (req, res) => {
  try {
    const { refundId } = req.params;
    const { reason } = req.body;
    const merchant = (req as any).merchant;

    // Verify ownership
    const { valid, refund, error } = await verifyRefundOwnership(refundId, merchant.id);
    if (!valid) {
      return res.status(refund ? 403 : 404).json({ error });
    }

    if (refund.status !== 'PENDING') {
      return res.status(400).json({ error: 'Refund is not pending' });
    }

    const updated = await db.refund.update({
      where: { id: refundId },
      data: {
        status: 'REJECTED',
        approvedBy: merchant.email || 'MERCHANT'
      }
    });

    logger.info('Refund rejected', {
      refundId,
      rejectedBy: merchant.email,
      merchantId: merchant.id,
      reason,
      event: 'refund.rejected'
    });

    res.json({
      success: true,
      refund: {
        ...updated,
        amount: Number(updated.amount)
      }
    });
  } catch (error) {
    console.error('Reject refund error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Process refund - merchant submits tx hash after sending funds
router.post('/:refundId/process', requireMerchantAuth, async (req, res) => {
  try {
    const { refundId } = req.params;
    const { txHash } = req.body;
    const merchant = (req as any).merchant;

    if (!txHash) {
      return res.status(400).json({ error: 'Transaction hash required' });
    }

    // Verify ownership
    const { valid, refund, error } = await verifyRefundOwnership(refundId, merchant.id);
    if (!valid) {
      return res.status(refund ? 403 : 404).json({ error });
    }

    if (refund.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Refund must be approved before processing' });
    }

    // Get order details for fee reversal
    const order = await db.order.findUnique({
      where: { id: refund.orderId },
      select: {
        amount: true,
        feeAmount: true,
        feePercent: true,
        merchantId: true
      }
    });

    // Update refund with tx hash and mark as processed
    const updated = await db.refund.update({
      where: { id: refundId },
      data: {
        status: 'PROCESSED',
        refundTxHash: txHash
      }
    });

    // Update order status to REFUNDED
    const now = new Date();
    await db.$executeRaw`UPDATE orders SET status = 'REFUNDED'::"OrderStatus", "updatedAt" = ${now} WHERE id = ${refund.orderId}`;

    // REVERSE FEES: Calculate proportional fee to reverse
    if (order?.merchantId && order?.feeAmount) {
      const orderAmount = Number(order.amount);
      const refundAmount = Number(refund.amount);
      const originalFee = Number(order.feeAmount);

      // Proportional fee reversal (if partial refund, reverse partial fee)
      const feeToReverse = (refundAmount / orderAmount) * originalFee;

      await db.merchant.update({
        where: { id: order.merchantId },
        data: {
          feesDue: {
            decrement: feeToReverse
          }
        }
      });

      logger.info('Fee reversed on refund', {
        refundId,
        orderId: refund.orderId,
        merchantId: order.merchantId,
        refundAmount,
        feeReversed: feeToReverse,
        event: 'refund.fee_reversed'
      });
    }

    logger.info('Refund processed', {
      refundId,
      txHash,
      processedBy: merchant.email,
      merchantId: merchant.id,
      orderId: refund.orderId,
      amount: Number(refund.amount),
      event: 'refund.processed'
    });

    // Send webhook for refund processed
    if (order?.merchantId) {
      webhookService.sendWebhook(order.merchantId, 'refund.processed', {
        refundId,
        orderId: refund.orderId,
        amount: Number(refund.amount),
        txHash,
        processedAt: now.toISOString(),
      }).catch(err => {
        logger.error('Failed to send refund.processed webhook', err as Error, { refundId });
      });
    }

    res.json({
      success: true,
      refund: {
        ...updated,
        amount: Number(updated.amount)
      },
      message: 'Refund completed successfully'
    });
  } catch (error) {
    console.error('Process refund error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get refund details with customer wallet (public for status checks)
router.get('/:refundId', async (req, res) => {
  try {
    const { refundId } = req.params;

    const refund = await db.refund.findUnique({
      where: { id: refundId },
      include: {
        order: {
          include: {
            transactions: true,
            merchant: {
              select: { id: true, companyName: true }
            }
          }
        }
      }
    });

    if (!refund) {
      return res.status(404).json({ error: 'Refund not found' });
    }

    // Get customer wallet from payment transaction
    const paymentTx = refund.order.transactions.find((tx: any) => tx.status === 'CONFIRMED');

    res.json({
      ...refund,
      amount: Number(refund.amount),
      customerWallet: paymentTx?.fromAddress,
      order: {
        ...refund.order,
        amount: Number(refund.order.amount)
      }
    });
  } catch (error) {
    console.error('Get refund error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as refundsRouter };
