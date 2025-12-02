import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { PRICING_TIERS } from '../config/pricing';

const router = Router();

const createRefundSchema = z.object({
  orderId: z.string().min(1),
  amount: z.string().min(1), // String to match Decimal in DB
  reason: z.string().min(1),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
});

const updateRefundSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
  refundTxHash: z.string().optional(),
  approvedBy: z.string().optional(),
});

// Create refund
router.post('/', async (req, res) => {
  try {
    const data = createRefundSchema.parse(req.body);

    // Verify order exists and get original amount
    const order = await db.order.findUnique({
      where: { id: data.orderId },
      include: {
        transactions: true,
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

    // Check tier permissions for refunds
    if (order.merchant) {
      const merchantPlan = order.merchant.plan || 'FREE';
      const tier = PRICING_TIERS[merchantPlan];

      if (!tier || !tier.features.refunds) {
        return res.status(403).json({
          error: 'Refunds not available',
          message: `Refunds are not available on ${tier?.name || 'FREE'} plan. Upgrade to STARTER or higher to process refunds.`,
          upgradeRequired: true,
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

    // Create refund record
    const refund = await db.refund.create({
      data: {
        orderId: data.orderId,
        amount: data.amount,
        reason: data.reason,
        status: data.status || 'PENDING',
      }
    });

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

// Update refund (for adding tx hash after execution)
router.patch('/:refundId', async (req, res) => {
  try {
    const { refundId } = req.params;
    const data = updateRefundSchema.parse(req.body);

    const refund = await db.refund.update({
      where: { id: refundId },
      data: data
    });

    res.json({ success: true, refund });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      console.error('Update refund error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
});

// Get refunds for a merchant
router.get('/', async (req, res) => {
  try {
    const { merchantId, orderId } = req.query;

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

// Get pending refunds
router.get('/pending', async (req, res) => {
  try {
    const refunds = await db.refund.findMany({
      where: { status: 'PENDING' },
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

// Get refund stats
router.get('/stats', async (req, res) => {
  try {
    const { merchantId } = req.query;

    const where: any = {};
    if (merchantId) {
      where.order = { merchantId: merchantId as string };
    }

    const [total, pending, completed, failed] = await Promise.all([
      db.refund.count({ where }),
      db.refund.count({ where: { ...where, status: 'PENDING' } }),
      db.refund.count({ where: { ...where, status: 'COMPLETED' } }),
      db.refund.count({ where: { ...where, status: 'FAILED' } }),
    ]);

    const totalAmount = await db.refund.aggregate({
      where: { ...where, status: 'COMPLETED' },
      _sum: { amount: true }
    });

    res.json({
      total,
      pending,
      completed,
      failed,
      totalRefunded: totalAmount._sum.amount || 0
    });
  } catch (error) {
    console.error('Get refund stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as refundsRouter };