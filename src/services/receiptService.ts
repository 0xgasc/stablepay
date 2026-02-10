import { db } from '../config/database';
import { Receipt, ReceiptDeliveryStatus } from '@prisma/client';
import { ReceiptResponse, ReceiptFilters } from '../types';
import { pdfService } from './pdfService';
import { logger } from '../utils/logger';

class ReceiptService {
  /**
   * Generate a unique receipt number for a merchant
   */
  private async generateReceiptNumber(merchantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `RCP-${year}`;

    // Get the latest receipt number for this merchant this year
    const latestReceipt = await db.receipt.findFirst({
      where: {
        merchantId,
        receiptNumber: { startsWith: prefix }
      },
      orderBy: { createdAt: 'desc' }
    });

    let nextNumber = 1;
    if (latestReceipt) {
      const match = latestReceipt.receiptNumber.match(/RCP-\d{4}-(\d+)/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    return `${prefix}-${nextNumber.toString().padStart(4, '0')}`;
  }

  /**
   * Create a receipt for a confirmed order
   * Called automatically when an order is confirmed
   */
  async createReceipt(orderId: string): Promise<Receipt> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        merchant: {
          select: {
            id: true,
            companyName: true,
            email: true,
            autoSendReceipts: true
          }
        },
        transactions: {
          where: { status: 'CONFIRMED' },
          take: 1,
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!order) {
      throw new Error('Order not found');
    }

    if (!order.merchantId || !order.merchant) {
      throw new Error('Order has no associated merchant');
    }

    // Check if receipt already exists
    const existingReceipt = await db.receipt.findUnique({
      where: { orderId }
    });

    if (existingReceipt) {
      logger.info('Receipt already exists for order', { orderId, receiptId: existingReceipt.id });
      return existingReceipt;
    }

    const receiptNumber = await this.generateReceiptNumber(order.merchantId);
    const confirmedTx = order.transactions[0];

    const receipt = await db.receipt.create({
      data: {
        orderId,
        merchantId: order.merchantId,
        receiptNumber,
        amount: order.amount,
        token: order.token,
        chain: order.chain,
        txHash: confirmedTx?.txHash || null,
        merchantName: order.merchant.companyName,
        customerEmail: order.customerEmail,
        customerName: order.customerName,
        emailStatus: 'PENDING',
        paymentDate: new Date()
      }
    });

    logger.info('Receipt created', {
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      orderId,
      merchantId: order.merchantId
    });

    return receipt;
  }

  /**
   * Get a receipt by ID
   */
  async getReceipt(receiptId: string): Promise<ReceiptResponse | null> {
    const receipt = await db.receipt.findUnique({
      where: { id: receiptId },
      include: {
        merchant: {
          select: { companyName: true, email: true, website: true }
        }
      }
    });

    if (!receipt) return null;

    return this.formatReceiptResponse(receipt);
  }

  /**
   * Get receipt by order ID
   */
  async getReceiptByOrder(orderId: string): Promise<ReceiptResponse | null> {
    const receipt = await db.receipt.findUnique({
      where: { orderId },
      include: {
        merchant: {
          select: { companyName: true, email: true, website: true }
        }
      }
    });

    if (!receipt) return null;

    return this.formatReceiptResponse(receipt);
  }

  /**
   * List receipts for a merchant with optional filters
   */
  async listReceipts(
    merchantId: string,
    filters: ReceiptFilters = {},
    page: number = 1,
    limit: number = 50
  ): Promise<{ receipts: ReceiptResponse[]; total: number; page: number; totalPages: number }> {
    const where: any = { merchantId };

    if (filters.startDate) {
      where.paymentDate = { ...where.paymentDate, gte: new Date(filters.startDate) };
    }
    if (filters.endDate) {
      where.paymentDate = { ...where.paymentDate, lte: new Date(filters.endDate) };
    }

    const [receipts, total] = await Promise.all([
      db.receipt.findMany({
        where,
        include: {
          merchant: {
            select: { companyName: true, email: true, website: true }
          }
        },
        orderBy: { paymentDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      db.receipt.count({ where })
    ]);

    return {
      receipts: receipts.map(r => this.formatReceiptResponse(r)),
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Generate PDF for a receipt
   */
  async generatePDF(receiptId: string): Promise<Buffer> {
    const receipt = await db.receipt.findUnique({
      where: { id: receiptId },
      include: {
        merchant: {
          select: { companyName: true, email: true, website: true }
        }
      }
    });

    if (!receipt) {
      throw new Error('Receipt not found');
    }

    return pdfService.generateReceiptPDF(receipt);
  }

  /**
   * Update receipt email status
   */
  async updateEmailStatus(
    receiptId: string,
    status: ReceiptDeliveryStatus,
    sentAt?: Date
  ): Promise<Receipt> {
    return db.receipt.update({
      where: { id: receiptId },
      data: {
        emailStatus: status,
        emailSentAt: sentAt
      }
    });
  }

  /**
   * Format receipt for API response
   */
  private formatReceiptResponse(receipt: any): ReceiptResponse {
    return {
      id: receipt.id,
      receiptNumber: receipt.receiptNumber,
      orderId: receipt.orderId,
      merchantId: receipt.merchantId,
      merchantName: receipt.merchantName,
      amount: Number(receipt.amount),
      token: receipt.token,
      chain: receipt.chain,
      txHash: receipt.txHash,
      customerEmail: receipt.customerEmail,
      customerName: receipt.customerName,
      emailStatus: receipt.emailStatus,
      emailSentAt: receipt.emailSentAt?.toISOString(),
      paymentDate: receipt.paymentDate.toISOString(),
      createdAt: receipt.createdAt.toISOString()
    };
  }
}

export const receiptService = new ReceiptService();
