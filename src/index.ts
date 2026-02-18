// Build timestamp: 2025-12-29T02:45:00Z
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { ordersRouter } from './routes/orders';
import { refundsRouter } from './routes/refunds';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';
import { feesRouter } from './routes/fees';
import { webhooksRouter } from './routes/webhooks';
import { invoicesRouter, invoicePayRouter } from './routes/invoices';
import { receiptsRouter } from './routes/receipts';
import { embedRouter } from './routes/embed';
import { validateEnv } from './utils/env';
import { OrderService } from './services/orderService';
import { logger } from './utils/logger';
import cron from 'node-cron';
// import { BlockchainService } from './services/blockchainService';

// Load and validate environment variables
dotenv.config();

let env;
try {
  env = validateEnv();
} catch (error) {
  console.error('Environment validation failed:', error);
  // Use defaults for Vercel
  env = {
    PORT: process.env.PORT || '3000',
    NODE_ENV: process.env.NODE_ENV || 'production',
    DATABASE_URL: process.env.DATABASE_URL || '',
    DIRECT_URL: process.env.DIRECT_URL,
  } as any;
}

const app = express();
const port = env.PORT || 3000;

// Configure helmet with secure CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://lxbrsiujmntrvzqdphhj.supabase.co", "https://stablepay-nine.vercel.app"],
    },
  },
}));
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use('/public', express.static(path.join(process.cwd(), 'public')));

// Serve invoice payment page at /pay/:invoiceId
app.get('/pay/:invoiceId', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'invoice-pay.html'));
});

// Health checks (no /api prefix for Kubernetes/Docker health probes)
app.use('/health', healthRouter);

// API routes
app.use('/api/orders', ordersRouter);
app.use('/api/refunds', refundsRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/pay', invoicePayRouter);  // Public invoice payment endpoint
app.use('/api/v1/admin', adminRouter);
app.use('/api/fees', feesRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/embed', embedRouter);  // Embeddable widget endpoints
app.use('/api', authRouter);

// Simple orders endpoint for test payments
app.post('/api/v1/orders', async (req, res) => {
  try {
    const { db } = await import('./config/database');
    const { merchantId, productName, amount, chain, customerEmail, paymentAddress: fallbackAddress } = req.body;

    if (!merchantId || !amount || !chain) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['merchantId', 'amount', 'chain']
      });
    }

    // Look up merchant's configured wallet for this chain
    let paymentAddress = fallbackAddress;

    if (merchantId && merchantId !== 'DEMO') {
      try {
        // Get all wallets for merchant and filter by chain
        const merchantWallets = await db.merchantWallet.findMany({
          where: {
            merchantId: merchantId,
            isActive: true
          }
        });

        const matchingWallet = merchantWallets.find(w => w.chain === chain);

        if (matchingWallet) {
          paymentAddress = matchingWallet.address;
          logger.debug('Using merchant wallet', { chain, paymentAddress, merchantId });
        } else {
          logger.debug('No merchant wallet found, using fallback', { chain, merchantId, walletCount: merchantWallets.length, fallbackAddress });
        }
      } catch (walletError) {
        logger.error('Error looking up merchant wallet', walletError as Error, { merchantId, chain });
        // Continue with fallback address
      }
    }

    if (!paymentAddress) {
      return res.status(400).json({
        error: 'No payment address available. Merchant must configure a wallet for this chain.'
      });
    }

    const order = await db.order.create({
      data: {
        merchantId,
        customerName: productName || 'Test Payment',
        amount: parseFloat(amount),
        chain,
        customerEmail: customerEmail || 'anonymous',
        paymentAddress,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });

    res.status(201).json({
      success: true,
      order: {
        id: order.id,
        merchantId: order.merchantId,
        customerName: order.customerName,
        amount: order.amount.toString(),
        chain: order.chain,
        status: order.status,
        paymentAddress: order.paymentAddress,
        customerEmail: order.customerEmail,
        expiresAt: order.expiresAt,
        createdAt: order.createdAt
      }
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET orders endpoint
app.get('/api/v1/orders', async (req, res) => {
  try {
    const { db } = await import('./config/database');
    const { merchantId, orderId } = req.query;

    if (orderId && typeof orderId === 'string') {
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: {
          transactions: true,
          refunds: true
        }
      });

      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      // Convert BigInt to string for JSON serialization
      const orderJSON = JSON.parse(JSON.stringify(order, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      ));

      return res.json(orderJSON);
    }

    if (merchantId && typeof merchantId === 'string') {
      const orders = await db.order.findMany({
        where: { merchantId },
        include: {
          transactions: true
        },
        orderBy: { createdAt: 'desc' },
        take: 100
      });

      // Convert BigInt to string for JSON serialization
      const ordersJSON = JSON.parse(JSON.stringify(orders, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      ));

      return res.json(ordersJSON);
    }

    return res.status(400).json({ error: 'merchantId or orderId required' });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT - Update order (for confirmations)
app.put('/api/v1/orders', async (req, res) => {
  try {
    const { db } = await import('./config/database');
    const { orderId, txHash, blockNumber, status } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    logger.debug('Confirming order', { orderId, txHash });

    // Use raw SQL to update status and updatedAt
    const newStatus = status || 'CONFIRMED';
    const now = new Date();
    await db.$executeRaw`UPDATE orders SET status = ${newStatus}::"OrderStatus", "updatedAt" = ${now} WHERE id = ${orderId}`;

    // Fetch the updated order
    const order = await db.order.findUnique({
      where: { id: orderId }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Create transaction record
    if (txHash) {
      const existingTx = await db.transaction.findUnique({
        where: { txHash: txHash }
      });

      if (!existingTx) {
        const transaction = await db.transaction.create({
          data: {
            orderId: orderId,
            txHash: txHash,
            chain: order.chain,
            amount: order.amount,
            fromAddress: order.customerEmail || 'unknown',
            toAddress: order.paymentAddress || 'unknown',
            blockNumber: blockNumber ? BigInt(blockNumber) : null,
            status: 'CONFIRMED',
            confirmations: 1
          }
        });
        console.log('Transaction record created:', transaction.id);
      }
    }

    return res.json({ success: true, order });
  } catch (error) {
    console.error('Update order error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Internal server error', details: errorMessage });
  }
});

// DELETE - Delete order (for cleanup)
app.delete('/api/v1/orders/:orderId', async (req, res) => {
  try {
    const { db } = await import('./config/database');
    const { orderId } = req.params;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    // First delete related transactions
    await db.transaction.deleteMany({
      where: { orderId }
    });

    // Then delete related refunds
    await db.refund.deleteMany({
      where: { orderId }
    });

    // Finally delete the order
    const deletedOrder = await db.order.delete({
      where: { id: orderId }
    });

    console.log('Order deleted:', orderId);
    return res.json({ success: true, deleted: deletedOrder.id });
  } catch (error) {
    console.error('Delete order error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Internal server error', details: errorMessage });
  }
});

// POST - Confirm order (uses orderService for proper fee calculation)
app.post('/api/v1/orders/:orderId/confirm', async (req, res) => {
  try {
    const { db } = await import('./config/database');
    const { orderId } = req.params;
    const { txHash, blockNumber, confirmations } = req.body;

    console.log('Confirming order:', orderId, 'with txHash:', txHash);

    // First check if order exists and merchant status
    const existingOrder = await db.order.findUnique({
      where: { id: orderId },
      include: { merchant: { select: { isSuspended: true, id: true } } }
    });

    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if merchant is suspended
    if (existingOrder.merchant?.isSuspended) {
      return res.status(403).json({
        error: 'Merchant account suspended',
        message: 'Payment processing is suspended due to unpaid fees. Please pay outstanding fees to continue.',
        suspended: true
      });
    }

    // Block expired or cancelled orders from being confirmed
    if (existingOrder.status === 'EXPIRED' || existingOrder.status === 'CANCELLED') {
      return res.status(400).json({
        error: `Order is ${existingOrder.status.toLowerCase()}`,
        message: `Cannot confirm an order with status ${existingOrder.status}.`,
      });
    }

    // Skip if already confirmed (avoid double-counting fees/volume)
    if (existingOrder.status === 'CONFIRMED' || existingOrder.status === 'PAID') {
      console.log('Order already confirmed, returning existing state:', orderId);
      return res.json({ success: true, order: existingOrder, alreadyConfirmed: true });
    }

    // Use orderService.confirmOrder for proper fee calculation and volume tracking
    const orderService = new OrderService();
    const order = await orderService.confirmOrder(orderId, {
      txHash,
      blockNumber: blockNumber ? parseInt(blockNumber) : undefined,
      confirmations: confirmations || 1
    });

    console.log('Order confirmed successfully with fees:', orderId);
    res.json({ success: true, order });
  } catch (error) {
    console.error('Confirm order error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Internal server error', details: errorMessage });
  }
});

// Alias for crypto-pay.html confirm endpoint (uses orderService for proper fee calculation)
app.post('/api/orders-confirm', async (req, res) => {
  try {
    const { db } = await import('./config/database');
    const { orderId, txHash, blockNumber, confirmations } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    console.log('Confirming order via /api/orders-confirm:', orderId, 'txHash:', txHash);

    // First check if order exists and merchant is not suspended
    const existingOrder = await db.order.findUnique({
      where: { id: orderId },
      include: { merchant: { select: { isSuspended: true, id: true } } }
    });

    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if merchant is suspended
    if (existingOrder.merchant?.isSuspended) {
      return res.status(403).json({
        error: 'Merchant account suspended',
        message: 'Payment processing is suspended due to unpaid fees.',
        suspended: true
      });
    }

    // Block expired or cancelled orders from being confirmed
    if (existingOrder.status === 'EXPIRED' || existingOrder.status === 'CANCELLED') {
      return res.status(400).json({
        error: `Order is ${existingOrder.status.toLowerCase()}`,
        message: `Cannot confirm an order with status ${existingOrder.status}.`,
      });
    }

    // Skip if already confirmed (avoid double-counting fees/volume)
    if (existingOrder.status === 'CONFIRMED' || existingOrder.status === 'PAID') {
      console.log('Order already confirmed, returning existing state:', orderId);
      return res.json({ success: true, order: existingOrder, alreadyConfirmed: true });
    }

    // Use orderService.confirmOrder for proper fee calculation and volume tracking
    const orderService = new OrderService();
    const order = await orderService.confirmOrder(orderId, {
      txHash,
      blockNumber: blockNumber ? parseInt(blockNumber) : undefined,
      confirmations: confirmations || 1
    });

    console.log('Order confirmed successfully with fees:', orderId);
    res.json({ success: true, order });
  } catch (error) {
    console.error('Confirm order error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Internal server error', details: errorMessage });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Database health check
app.get('/api/db-health', async (req, res) => {
  try {
    const { db } = await import('./config/database');
    const count = await db.order.count();
    res.json({ 
      status: 'database connected', 
      orderCount: count,
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    console.error('Database health check failed:', error);
    res.status(500).json({ 
      status: 'database error',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/chains', (req, res) => {
  const chains = [
    { 
      id: 'BASE_SEPOLIA', 
      name: 'Base Sepolia', 
      network: 'testnet',
      faucetUrl: 'https://faucet.quicknode.com/base/sepolia',
      explorerUrl: 'https://sepolia.basescan.org'
    },
    { 
      id: 'ETHEREUM_SEPOLIA', 
      name: 'Ethereum Sepolia', 
      network: 'testnet',
      faucetUrl: 'https://sepoliafaucet.com',
      explorerUrl: 'https://sepolia.etherscan.io'
    },
  ];
  res.json(chains);
});

// Cancel an order
app.post('/api/v1/orders/:orderId/cancel', async (req, res) => {
  try {
    const { db } = await import('./config/database');
    const { orderId } = req.params;
    const { reason } = req.body;

    const order = await db.order.findUnique({ where: { id: orderId } });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status === 'CONFIRMED' || order.status === 'PAID') {
      return res.status(400).json({
        error: 'Cannot cancel a completed order',
        message: `Order has status ${order.status}. Use refund instead.`,
      });
    }

    if (order.status === 'CANCELLED') {
      return res.json({ success: true, order, alreadyCancelled: true });
    }

    const now = new Date();
    await db.$executeRaw`UPDATE orders SET status = 'CANCELLED'::"OrderStatus", "updatedAt" = ${now} WHERE id = ${orderId}`;

    const updated = await db.order.findUnique({ where: { id: orderId } });

    logger.info('Order cancelled', { orderId, reason, event: 'order.cancelled' });
    res.json({ success: true, order: updated });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  try {
    // Start server first
    app.listen(port, () => {
      console.log(`StablePay API server running on port ${port}`);
      console.log(`Health check: http://localhost:${port}/api/health`);
    });

    // Cron: Check for overdue fees every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      try {
        logger.info('Running scheduled fee overdue check', { event: 'cron.fee_check_start' });
        const response = await fetch(`http://localhost:${port}/api/fees/check-overdue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminKey: process.env.ADMIN_KEY }),
        });
        const result = await response.json() as Record<string, any>;
        logger.info('Fee overdue check completed', { result, event: 'cron.fee_check_done' });
      } catch (error) {
        logger.error('Cron fee check failed', error as Error, { event: 'cron.fee_check_error' });
      }
    });

    // Cron: Process webhook retries every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      try {
        const { webhookService } = await import('./services/webhookService');
        const processed = await webhookService.processRetries();
        if (processed > 0) {
          logger.info('Webhook retries processed', { count: processed, event: 'cron.webhook_retries' });
        }
      } catch (error) {
        logger.error('Cron webhook retry failed', error as Error, { event: 'cron.webhook_retry_error' });
      }
    });

    console.log('Cron jobs scheduled: fee check (every 6h), webhook retries (every 5m)');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Export the Express app for Vercel
export default app;

// Only start server if running directly (not imported)
if (require.main === module) {
  startServer();
}
