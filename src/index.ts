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
import { validateEnv } from './utils/env';
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

// Health checks (no /api prefix for Kubernetes/Docker health probes)
app.use('/health', healthRouter);

// API routes
app.use('/api/orders', ordersRouter);
app.use('/api/refunds', refundsRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api', authRouter);

// Simple orders endpoint for test payments
app.post('/api/v1/orders', async (req, res) => {
  try {
    const { db } = await import('./config/database');
    const { merchantId, productName, amount, chain, customerEmail, paymentAddress } = req.body;

    if (!merchantId || !amount || !chain || !paymentAddress) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['merchantId', 'amount', 'chain', 'paymentAddress']
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

    console.log('Confirming order:', orderId, 'with txHash:', txHash);

    const order = await db.order.update({
      where: { id: orderId },
      data: {
        status: status || 'CONFIRMED',
        updatedAt: new Date()
      }
    });

    // Create transaction record
    if (txHash) {
      const transaction = await db.transaction.create({
        data: {
          orderId: orderId,
          txHash: txHash,
          chain: order.chain,
          amount: order.amount,
          fromAddress: order.customerEmail || 'unknown',
          toAddress: order.paymentAddress,
          blockNumber: blockNumber ? BigInt(blockNumber) : null,
          status: 'CONFIRMED'
        }
      });
      console.log('Transaction record created:', transaction.id);
    }

    return res.json({ success: true, order });
  } catch (error) {
    console.error('Update order error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Internal server error', details: errorMessage });
  }
});

// POST - Confirm order
app.post('/api/v1/orders/:orderId/confirm', async (req, res) => {
  try {
    const { db } = await import('./config/database');
    const { orderId } = req.params;
    const { txHash, blockNumber, status } = req.body;

    const order = await db.order.update({
      where: { id: orderId },
      data: {
        status: status || 'CONFIRMED',
        updatedAt: new Date()
      }
    });

    // Create transaction record
    if (txHash) {
      await db.transaction.create({
        data: {
          orderId: orderId,
          txHash: txHash,
          chain: order.chain,
          amount: order.amount,
          fromAddress: order.customerEmail || 'unknown',
          toAddress: order.paymentAddress,
          blockNumber: blockNumber ? BigInt(blockNumber) : undefined,
          status: 'CONFIRMED'
        }
      });
    }

    res.json({ success: true, order });
  } catch (error) {
    console.error('Confirm order error:', error);
    res.status(500).json({ error: 'Internal server error' });
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

    // Try to start blockchain scanner (non-blocking)
    // Temporarily disabled due to Prisma prepared statement errors
    // try {
    //   const blockchainService = new BlockchainService();
    //   await blockchainService.startScanning();
    //   console.log('✅ Blockchain scanner started successfully!');
    // } catch (scannerError) {
    //   console.warn('⚠️  Blockchain scanner failed to start:', scannerError.message);
    //   console.warn('   API will work but payments won\'t be detected automatically');
    // }
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