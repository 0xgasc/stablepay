import { Router } from 'express';
import { z } from 'zod';
import { RefundService } from '../services/refundService';

const router = Router();
const refundService = new RefundService();

const createRefundSchema = z.object({
  orderId: z.string().min(1),
  amount: z.number().positive().optional(),
  reason: z.string().min(1),
});

const refundActionSchema = z.object({
  approvedBy: z.string().min(1),
});

router.post('/', async (req, res) => {
  try {
    const data = createRefundSchema.parse(req.body);
    const refund = await refundService.createRefund(data);
    res.status(201).json(refund);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
});

router.get('/pending', async (req, res) => {
  try {
    const refunds = await refundService.getPendingRefunds();
    res.json(refunds);
  } catch (error) {
    console.error('Get pending refunds error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await refundService.getRefundStats();
    res.json(stats);
  } catch (error) {
    console.error('Get refund stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:refundId/approve', async (req, res) => {
  try {
    const { refundId } = req.params;
    const { approvedBy } = refundActionSchema.parse(req.body);
    
    const refund = await refundService.approveRefund(refundId, approvedBy);
    res.json(refund);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
});

router.post('/:refundId/reject', async (req, res) => {
  try {
    const { refundId } = req.params;
    const { approvedBy } = refundActionSchema.parse(req.body);
    
    const refund = await refundService.rejectRefund(refundId, approvedBy);
    res.json(refund);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
});

export { router as refundsRouter };