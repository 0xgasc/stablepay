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
import { agentRouter } from './routes/agent';
import { complianceRouter } from './routes/compliance';
import { treasuryRouter } from './routes/treasury';
import { paymentLinksRouter } from './routes/paymentLinks';
import { db } from './config/database';
import { validateEnv } from './utils/env';
import { logger } from './utils/logger';
import cron from 'node-cron';

// Load and validate environment variables
dotenv.config();

let env;
try {
  env = validateEnv();
} catch (error) {
  console.error('Environment validation failed:', error);
  // Fall back to minimal config for Vercel (where zod validation may fail on optional fields)
  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL not set. Exiting.');
    process.exit(1);
  }
  env = {
    PORT: process.env.PORT || '3000',
    NODE_ENV: process.env.NODE_ENV || 'production',
    DATABASE_URL: process.env.DATABASE_URL,
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
      connectSrc: ["'self'", "https://wetakestables.shop"],
    },
  },
}));
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use('/public', express.static(path.join(process.cwd(), 'public')));

// Serve widget JS with short cache (Vercel static cache is 4h, too long for rapid iteration)
app.get('/api/widget.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
  res.setHeader('Vercel-CDN-Cache-Control', 'public, max-age=60, must-revalidate');
  res.setHeader('CDN-Cache-Control', 'public, max-age=60, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(path.join(process.cwd(), 'public', 'checkout-widget.js'));
});

// Payment link short URLs → resolve and redirect to checkout
app.get('/pay/:slug', async (req, res) => {
  try {
    const link = await db.paymentLink.findUnique({ where: { slug: req.params.slug } });
    if (!link || !link.isActive) {
      return res.status(404).send('Payment link not found or expired');
    }
    await db.paymentLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 } } });
    const params = new URLSearchParams({
      merchantId: link.merchantId,
      amount: Number(link.amount).toString(),
      token: link.token,
    });
    if (link.productName) params.set('productName', link.productName);
    if (link.chains.length > 0) params.set('chains', link.chains.join(','));
    if (link.externalId) params.set('externalId', link.externalId);
    params.set('linkId', link.id);
    res.redirect(`/crypto-pay.html?${params.toString()}`);
  } catch (err) {
    res.status(500).send('Error loading payment link');
  }
});

// Serve invoice payment page at /pay/:invoiceId
app.get('/pay/:invoiceId', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'invoice-pay.html'));
});

// Health checks
app.use('/health', healthRouter);

// ─── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/orders', ordersRouter);
app.use('/api/refunds', refundsRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/v1/receipts', receiptsRouter); // Legacy alias
app.use('/api/pay', invoicePayRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/fees', feesRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/embed', embedRouter);
app.use('/api/agent', agentRouter);
app.use('/api/compliance', complianceRouter);
app.use('/api/treasury', treasuryRouter);
app.use('/api/payment-links', paymentLinksRouter);
app.use('/api', authRouter);

// ─── Legacy v1 redirects (old unprotected routes removed) ──────────────────
app.post('/api/v1/orders', (req, res) => res.redirect(307, '/api/embed/checkout'));
app.get('/api/v1/orders', (_req, res) => res.status(410).json({ error: 'Use GET /api/orders with Bearer token' }));
app.put('/api/v1/orders', (_req, res) => res.status(410).json({ error: 'Endpoint removed' }));
app.delete('/api/v1/orders/:orderId', (_req, res) => res.status(410).json({ error: 'Endpoint removed' }));
app.post('/api/v1/orders/:orderId/confirm', (_req, res) => res.status(410).json({ error: 'Endpoint removed' }));
app.post('/api/v1/orders/:orderId/cancel', (_req, res) => res.status(410).json({ error: 'Endpoint removed' }));
app.get('/api/v1/chains', (_req, res) => res.redirect(301, '/api/embed/chains'));

// ─── Error handler ──────────────────────────────────────────────────────────
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Server startup ─────────────────────────────────────────────────────────
async function startServer() {
  try {
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

    // Cron: Expire stale PENDING orders every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      try {
        const { db } = await import('./config/database');
        const { OrderService } = await import('./services/orderService');
        const orderService = new OrderService();
        const staleOrders = await db.order.findMany({
          where: { status: 'PENDING', expiresAt: { lt: new Date() } },
          select: { id: true },
          take: 50,
        });
        for (const order of staleOrders) {
          await orderService.expireOrder(order.id);
        }
        if (staleOrders.length > 0) {
          logger.info('Expired stale orders', { count: staleOrders.length, event: 'cron.order_expiry' });
        }
      } catch (error) {
        logger.error('Cron order expiry failed', error as Error, { event: 'cron.order_expiry_error' });
      }
    });

    console.log('Cron jobs scheduled: fee check (every 6h), webhook retries (every 5m), order expiry (every 5m)');
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
