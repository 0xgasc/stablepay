import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { rateLimit } from '../middleware/rateLimit';
import { logger } from '../utils/logger';
import { receiptService } from '../services/receiptService';
import { emailService } from '../services/emailService';

const router = Router();

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
