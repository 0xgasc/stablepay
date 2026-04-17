import { Router } from 'express';
import { db } from '../config/database';
import { rateLimit } from '../middleware/rateLimit';
import { requireMerchantAuth } from '../middleware/auth';
import { logger } from '../utils/logger';
import { receiptService } from '../services/receiptService';
import { emailService } from '../services/emailService';

const router = Router();

// ============================================
// SPECIFIC ROUTES FIRST
// ============================================

// Get receipt by order ID
router.get('/by-order/:orderId', requireMerchantAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const merchant = (req as any).merchant;

    // Verify the order belongs to this merchant
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { merchantId: true }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.merchantId !== merchant.id) {
      return res.status(403).json({ error: 'Not authorized to access this receipt' });
    }

    const receipt = await receiptService.getReceiptByOrder(orderId);

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found for this order' });
    }

    res.json({ receipt });
  } catch (error) {
    console.error('Get receipt by order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// GENERAL ROUTES
// ============================================

// List receipts for a merchant
router.get('/', requireMerchantAuth, rateLimit({
  getMerchantId: async (req) => (req as any).merchant?.id || null,
  limitAnonymous: true,
  anonymousLimit: 50
}), async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const { page = '1', limit = '50', startDate, endDate } = req.query;

    const result = await receiptService.listReceipts(
      merchant.id,
      {
        startDate: startDate as string,
        endDate: endDate as string
      },
      parseInt(page as string, 10),
      parseInt(limit as string, 10)
    );

    res.json(result);
  } catch (error) {
    console.error('List receipts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public: find receipt by orderId (for customer receipt page)
// If order is CONFIRMED but receipt doesn't exist yet, create it on the fly
router.get('/for-order/:orderId', async (req, res) => {
  try {
    let receipt = await db.receipt.findFirst({
      where: { orderId: req.params.orderId },
      select: { id: true },
    });

    // Fallback: if no receipt but order is confirmed, create it now
    if (!receipt) {
      const order = await db.order.findUnique({
        where: { id: req.params.orderId },
        select: { status: true },
      });
      if (order?.status === 'CONFIRMED') {
        try {
          const { receiptService } = await import('../services/receiptService');
          const created = await receiptService.createReceipt(req.params.orderId);
          receipt = { id: created.id };
        } catch { /* receipt creation failed, return 404 */ }
      }
    }

    if (!receipt) return res.status(404).json({ error: 'Receipt not found for this order' });
    res.json({ receiptId: receipt.id });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public: customer self-service receipt email (rate-limited 3/hr per order).
// Sends the receipt to whatever email the customer provides — useful when the merchant didn't
// auto-email and the customer lost the receipt URL.
router.post('/for-order/:orderId/email', rateLimit({
  getMerchantId: async () => null,
  limitAnonymous: true,
  anonymousLimit: 3,
}), async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email address required' });
    }
    if (!emailService.isConfigured()) {
      return res.status(503).json({ error: 'Email service not configured' });
    }

    let receipt = await db.receipt.findFirst({
      where: { orderId: req.params.orderId },
      select: { id: true },
    });
    if (!receipt) {
      const order = await db.order.findUnique({
        where: { id: req.params.orderId },
        select: { status: true },
      });
      if (order?.status === 'CONFIRMED') {
        try {
          const created = await receiptService.createReceipt(req.params.orderId);
          receipt = { id: created.id };
        } catch { /* creation failed — return 404 below */ }
      }
    }
    if (!receipt) return res.status(404).json({ error: 'Receipt not available for this order' });

    const sent = await emailService.sendReceipt(receipt.id, email);
    if (!sent) return res.status(500).json({ error: 'Failed to send email' });

    logger.info('Customer self-service receipt email', {
      receiptId: receipt.id,
      orderId: req.params.orderId,
      to: email,
      event: 'receipt.self_service_email',
    });
    res.json({ success: true });
  } catch (error) {
    logger.error('Self-service receipt email error', error as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// PARAMETERIZED ROUTES LAST
// ============================================

// Download receipt PDF
router.get('/:receiptId/pdf', async (req, res) => {
  try {
    const { receiptId } = req.params;

    // Check if authorized (either merchant or public with valid receipt)
    const receipt = await db.receipt.findUnique({
      where: { id: receiptId },
      select: { id: true, receiptNumber: true, merchantId: true }
    });

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    // Verify merchant auth if provided
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (token) {
      const merchant = await db.merchant.findFirst({
        where: { loginToken: token }
      });

      if (merchant && merchant.id !== receipt.merchantId) {
        return res.status(403).json({ error: 'Not authorized to access this receipt' });
      }
    }

    // Generate PDF
    const pdfBuffer = await receiptService.generatePDF(receiptId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${receipt.receiptNumber}.pdf"`);
    res.send(pdfBuffer);

    logger.info('Receipt PDF downloaded', { receiptId, receiptNumber: receipt.receiptNumber });
  } catch (error) {
    console.error('Download receipt PDF error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Resend receipt email
router.post('/:receiptId/resend', requireMerchantAuth, async (req, res) => {
  try {
    const { receiptId } = req.params;
    const { email } = req.body; // Optional override email
    const merchant = (req as any).merchant;

    // Verify ownership
    const receipt = await db.receipt.findUnique({
      where: { id: receiptId },
      select: { id: true, merchantId: true, customerEmail: true, receiptNumber: true }
    });

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    if (receipt.merchantId !== merchant.id) {
      return res.status(403).json({ error: 'Not authorized to resend this receipt' });
    }

    const toEmail = email || receipt.customerEmail;
    if (!toEmail) {
      return res.status(400).json({ error: 'No email address available' });
    }

    if (!emailService.isConfigured()) {
      return res.status(503).json({
        error: 'Email service not configured',
        message: 'Set RESEND_API_KEY environment variable to enable email'
      });
    }

    const success = await emailService.sendReceipt(receiptId, toEmail);

    if (success) {
      logger.info('Receipt email resent', { receiptId, to: toEmail });
      res.json({ success: true, message: 'Receipt sent successfully' });
    } else {
      res.status(500).json({ error: 'Failed to send receipt email' });
    }
  } catch (error) {
    console.error('Resend receipt error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get receipt details
router.get('/:receiptId', async (req, res) => {
  try {
    const { receiptId } = req.params;

    const receipt = await receiptService.getReceipt(receiptId);

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    // If auth provided, verify ownership
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (token) {
      const merchant = await db.merchant.findFirst({
        where: { loginToken: token }
      });

      if (merchant && merchant.id !== receipt.merchantId) {
        return res.status(403).json({ error: 'Not authorized to access this receipt' });
      }
    }

    res.json({ receipt });
  } catch (error) {
    console.error('Get receipt error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as receiptsRouter };
