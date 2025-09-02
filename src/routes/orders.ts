import { Router } from 'express';
import { z } from 'zod';
import { OrderService } from '../services/orderService';

const router = Router();
const orderService = new OrderService();

const createOrderSchema = z.object({
  amount: z.number().positive(),
  chain: z.enum(['BASE_SEPOLIA', 'ETHEREUM_SEPOLIA']),
  customerEmail: z.string().email().optional(),
  customerName: z.string().min(1).optional(),
  expiryMinutes: z.number().positive().optional(),
});

router.post('/', async (req, res) => {
  try {
    const data = createOrderSchema.parse(req.body);
    const order = await orderService.createOrder(data);
    res.status(201).json(order);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      console.error('Create order error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

router.get('/:orderId', async (req, res) => {
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

router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const includeTransactions = req.query.includeTransactions === 'true';
    
    const result = await orderService.getAllOrders(page, limit, includeTransactions);
    res.json(result);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add transaction hash to order
router.post('/:orderId/transaction', async (req, res) => {
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

// Confirm order with transaction details
router.post('/:orderId/confirm', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { txHash, blockNumber, confirmations } = req.body;
    
    const order = await orderService.confirmOrder(orderId, {
      txHash,
      blockNumber: blockNumber ? parseInt(blockNumber) : undefined,
      confirmations
    });
    res.json({ message: 'Order confirmed', order });
  } catch (error) {
    console.error('Confirm order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as ordersRouter };