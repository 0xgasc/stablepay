import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { rateLimit } from '../middleware/rateLimit';
import { logger } from '../utils/logger';
import { invoiceService } from '../services/invoiceService';
import { emailService } from '../services/emailService';
import { webhookService } from '../services/webhookService';
import { InvoiceStatus } from '../types';

const router = Router();

// Validation schemas
const lineItemSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  quantity: z.number().int().positive().default(1),
  unitPrice: z.number().positive('Unit price must be positive')
});

const createInvoiceSchema = z.object({
  customerEmail: z.string().email().optional(),
  customerName: z.string().optional(),
  customerAddress: z.string().optional(),
  chain: z.enum([
    'BASE_SEPOLIA', 'BASE_MAINNET',
    'ETHEREUM_SEPOLIA', 'ETHEREUM_MAINNET',
    'POLYGON_MAINNET', 'POLYGON_MUMBAI',
    'ARBITRUM_MAINNET', 'ARBITRUM_SEPOLIA',
    'SOLANA_MAINNET', 'SOLANA_DEVNET'
  ]).optional(),
  token: z.enum(['USDC', 'USDT', 'EURC']).default('USDC'),
  dueDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  customerNotes: z.string().optional(),
  taxPercent: z.number().min(0).max(1).optional(),
  discountPercent: z.number().min(0).max(1).optional(),
  lineItems: z.array(lineItemSchema).min(1, 'At least one line item is required')
});

const updateInvoiceSchema = createInvoiceSchema.partial();

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
      select: { id: true, email: true, companyName: true, isSuspended: true }
    });

    if (!merchant) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (merchant.isSuspended) {
      return res.status(403).json({
        error: 'Account suspended',
        message: 'Your account is suspended. Please contact support.'
      });
    }

    (req as any).merchant = merchant;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// ============================================
// SPECIFIC ROUTES FIRST
// ============================================

// Get invoice statistics
router.get('/stats', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const stats = await invoiceService.getInvoiceStats(merchant.id);
    res.json(stats);
  } catch (error) {
    console.error('Get invoice stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GENERAL ROUTES
// ============================================

// List invoices for a merchant
router.get('/', requireMerchantAuth, rateLimit({
  getMerchantId: async (req) => (req as any).merchant?.id || null,
  limitAnonymous: true,
  anonymousLimit: 50
}), async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const { page = '1', limit = '50', status, startDate, endDate } = req.query;

    const result = await invoiceService.listInvoices(
      merchant.id,
      {
        status: status as InvoiceStatus | undefined,
        startDate: startDate as string,
        endDate: endDate as string
      },
      parseInt(page as string, 10),
      parseInt(limit as string, 10)
    );

    res.json(result);
  } catch (error) {
    console.error('List invoices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new invoice
router.post('/', requireMerchantAuth, rateLimit({
  getMerchantId: async (req) => (req as any).merchant?.id || null
}), async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const data = createInvoiceSchema.parse(req.body);

    const invoice = await invoiceService.createInvoice({
      ...data,
      merchantId: merchant.id
    });

    // Send webhook
    webhookService.sendWebhook(merchant.id, 'invoice.created', {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      customerEmail: invoice.customerEmail
    }).catch(err => {
      logger.error('Failed to send invoice.created webhook', err as Error, { invoiceId: invoice.id });
    });

    res.status(201).json({ success: true, invoice });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      console.error('Create invoice error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
});

// ============================================
// PARAMETERIZED ROUTES LAST
// ============================================

// Download invoice PDF
router.get('/:invoiceId/pdf', async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, invoiceNumber: true, merchantId: true, status: true }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Generate PDF
    const pdfBuffer = await invoiceService.generatePDF(invoiceId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
    res.send(pdfBuffer);

    logger.info('Invoice PDF downloaded', { invoiceId, invoiceNumber: invoice.invoiceNumber });
  } catch (error) {
    console.error('Download invoice PDF error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Send invoice to customer
router.post('/:invoiceId/send', requireMerchantAuth, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const merchant = (req as any).merchant;

    // Verify ownership
    const existing = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, merchantId: true, status: true, customerEmail: true, invoiceNumber: true }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (existing.merchantId !== merchant.id) {
      return res.status(403).json({ error: 'Not authorized to send this invoice' });
    }

    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Only draft invoices can be sent' });
    }

    if (!existing.customerEmail) {
      return res.status(400).json({ error: 'Customer email is required to send invoice' });
    }

    // Update status to SENT
    const invoice = await invoiceService.sendInvoice(invoiceId);

    // Send email if configured
    if (emailService.isConfigured()) {
      emailService.sendInvoice(invoiceId).catch(err => {
        logger.error('Failed to send invoice email', err as Error, { invoiceId });
      });
    }

    // Send webhook
    webhookService.sendWebhook(merchant.id, 'invoice.sent', {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      customerEmail: invoice.customerEmail,
      paymentUrl: invoice.paymentUrl
    }).catch(err => {
      logger.error('Failed to send invoice.sent webhook', err as Error, { invoiceId });
    });

    res.json({ success: true, invoice });
  } catch (error) {
    console.error('Send invoice error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Cancel invoice
router.post('/:invoiceId/cancel', requireMerchantAuth, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const merchant = (req as any).merchant;

    // Verify ownership
    const existing = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, merchantId: true, status: true }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (existing.merchantId !== merchant.id) {
      return res.status(403).json({ error: 'Not authorized to cancel this invoice' });
    }

    const invoice = await invoiceService.cancelInvoice(invoiceId);

    // Send webhook
    webhookService.sendWebhook(merchant.id, 'invoice.cancelled', {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber
    }).catch(err => {
      logger.error('Failed to send invoice.cancelled webhook', err as Error, { invoiceId });
    });

    res.json({ success: true, invoice });
  } catch (error) {
    console.error('Cancel invoice error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Update invoice (DRAFT only)
router.put('/:invoiceId', requireMerchantAuth, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const merchant = (req as any).merchant;
    const data = updateInvoiceSchema.parse(req.body);

    // Verify ownership
    const existing = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, merchantId: true, status: true }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (existing.merchantId !== merchant.id) {
      return res.status(403).json({ error: 'Not authorized to update this invoice' });
    }

    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Only draft invoices can be updated' });
    }

    const invoice = await invoiceService.updateInvoice(invoiceId, data);

    res.json({ success: true, invoice });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      console.error('Update invoice error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
});

// Delete invoice (DRAFT only)
router.delete('/:invoiceId', requireMerchantAuth, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const merchant = (req as any).merchant;

    // Verify ownership
    const existing = await db.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, merchantId: true, status: true, invoiceNumber: true }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (existing.merchantId !== merchant.id) {
      return res.status(403).json({ error: 'Not authorized to delete this invoice' });
    }

    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Only draft invoices can be deleted' });
    }

    await invoiceService.deleteInvoice(invoiceId);

    res.json({ success: true, message: 'Invoice deleted' });
  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get invoice details
router.get('/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const invoice = await invoiceService.getInvoice(invoiceId);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // If auth provided, verify ownership for draft invoices
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (invoice.status === 'DRAFT') {
      if (!token) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      const merchant = await db.merchant.findFirst({
        where: { loginToken: token }
      });

      if (!merchant || merchant.id !== invoice.merchantId) {
        return res.status(404).json({ error: 'Invoice not found' });
      }
    }

    // Mark as viewed for SENT invoices (public access)
    if (invoice.status === 'SENT' && !token) {
      await invoiceService.markAsViewed(invoiceId);

      // Send webhook
      webhookService.sendWebhook(invoice.merchantId, 'invoice.viewed', {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        viewedAt: new Date().toISOString()
      }).catch(err => {
        logger.error('Failed to send invoice.viewed webhook', err as Error, { invoiceId });
      });
    }

    res.json({ invoice });
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// PUBLIC INVOICE PAYMENT ROUTES
// (No auth required - customer access)
// ============================================

// Create a separate router for public /api/pay routes
const payRouter = Router();

// Get invoice for payment (public)
payRouter.get('/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const invoice = await invoiceService.getInvoice(invoiceId);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Only allow access to sent/viewed invoices (not drafts or paid)
    if (invoice.status === 'DRAFT') {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (invoice.status === 'PAID') {
      return res.json({
        invoice,
        alreadyPaid: true,
        message: 'This invoice has already been paid'
      });
    }

    if (invoice.status === 'CANCELLED') {
      return res.status(410).json({
        error: 'Invoice cancelled',
        message: 'This invoice has been cancelled'
      });
    }

    // Mark as viewed if first time
    if (invoice.status === 'SENT') {
      await invoiceService.markAsViewed(invoiceId);

      // Send webhook
      webhookService.sendWebhook(invoice.merchantId, 'invoice.viewed', {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        viewedAt: new Date().toISOString()
      }).catch(err => {
        logger.error('Failed to send invoice.viewed webhook', err as Error, { invoiceId });
      });
    }

    // Get merchant wallets for chain selection
    const merchantWallets = await db.merchantWallet.findMany({
      where: { merchantId: invoice.merchantId, isActive: true },
      select: { chain: true }
    });

    res.json({
      invoice,
      availableChains: merchantWallets.map(w => w.chain)
    });
  } catch (error) {
    console.error('Get invoice for payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create order from invoice (customer paying)
payRouter.post('/:invoiceId/order', rateLimit({
  getMerchantId: async (req) => {
    const invoice = await db.invoice.findUnique({
      where: { id: req.params.invoiceId },
      select: { merchantId: true }
    });
    return invoice?.merchantId || null;
  },
  limitAnonymous: true,
  anonymousLimit: 20
}), async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { chain } = req.body; // Customer can select chain

    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        merchant: {
          include: {
            wallets: { where: { isActive: true } }
          }
        }
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (invoice.status === 'DRAFT') {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (invoice.status === 'PAID') {
      return res.status(400).json({ error: 'Invoice already paid' });
    }

    if (invoice.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Invoice has been cancelled' });
    }

    if (invoice.merchant?.isSuspended) {
      return res.status(503).json({
        error: 'Payment unavailable',
        message: 'This merchant is temporarily unavailable'
      });
    }

    // Determine chain and payment address
    const selectedChain = chain || invoice.chain || 'BASE_MAINNET';
    const wallet = invoice.merchant?.wallets.find(w => w.chain === selectedChain);

    if (!wallet) {
      return res.status(400).json({
        error: 'No wallet configured',
        message: `Merchant has no wallet configured for ${selectedChain}`,
        availableChains: invoice.merchant?.wallets.map(w => w.chain) || []
      });
    }

    // Create order linked to invoice
    const order = await db.order.create({
      data: {
        merchantId: invoice.merchantId,
        amount: invoice.total,
        token: invoice.token,
        chain: selectedChain as any,
        customerEmail: invoice.customerEmail,
        customerName: invoice.customerName,
        paymentAddress: wallet.address,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 min expiry
      }
    });

    // Link invoice to order
    await db.invoice.update({
      where: { id: invoiceId },
      data: { orderId: order.id }
    });

    logger.info('Order created from invoice', {
      invoiceId,
      orderId: order.id,
      merchantId: invoice.merchantId,
      amount: Number(invoice.total),
      chain: selectedChain
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
      },
      invoiceId,
      invoiceNumber: invoice.invoiceNumber
    });
  } catch (error) {
    console.error('Create order from invoice error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export { router as invoicesRouter, payRouter as invoicePayRouter };
