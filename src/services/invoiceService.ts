import { db } from '../config/database';
import { Invoice, InvoiceStatus, Prisma } from '@prisma/client';
import {
  CreateInvoiceRequest,
  UpdateInvoiceRequest,
  InvoiceResponse,
  InvoiceFilters,
  InvoiceStats,
  LineItemInput
} from '../types';
import { pdfService } from './pdfService';
import { logger } from '../utils/logger';

class InvoiceService {
  /**
   * Generate a unique invoice number for a merchant
   */
  private async generateInvoiceNumber(merchantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}`;

    // Get the latest invoice number for this merchant this year
    const latestInvoice = await db.invoice.findFirst({
      where: {
        merchantId,
        invoiceNumber: { startsWith: prefix }
      },
      orderBy: { createdAt: 'desc' }
    });

    let nextNumber = 1;
    if (latestInvoice) {
      const match = latestInvoice.invoiceNumber.match(/INV-\d{4}-(\d+)/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    return `${prefix}-${nextNumber.toString().padStart(4, '0')}`;
  }

  /**
   * Calculate invoice totals from line items
   */
  private calculateTotals(
    lineItems: LineItemInput[],
    taxPercent: number = 0,
    discountPercent: number = 0
  ): { subtotal: number; taxAmount: number; discountAmount: number; total: number } {
    const subtotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const discountAmount = subtotal * discountPercent;
    const afterDiscount = subtotal - discountAmount;
    const taxAmount = afterDiscount * taxPercent;
    const total = afterDiscount + taxAmount;

    return {
      subtotal: Math.round(subtotal * 1000000) / 1000000,
      taxAmount: Math.round(taxAmount * 1000000) / 1000000,
      discountAmount: Math.round(discountAmount * 1000000) / 1000000,
      total: Math.round(total * 1000000) / 1000000
    };
  }

  /**
   * Create a new invoice
   */
  async createInvoice(data: CreateInvoiceRequest): Promise<InvoiceResponse> {
    const merchant = await db.merchant.findUnique({
      where: { id: data.merchantId },
      include: {
        wallets: {
          where: data.chain ? { chain: data.chain, isActive: true } : { isActive: true },
          take: 1
        }
      }
    });

    if (!merchant) {
      throw new Error('Merchant not found');
    }

    const invoiceNumber = await this.generateInvoiceNumber(data.merchantId);
    const taxPercent = data.taxPercent || 0;
    const discountPercent = data.discountPercent || 0;
    const totals = this.calculateTotals(data.lineItems, taxPercent, discountPercent);

    const paymentAddress = merchant.wallets[0]?.address || null;

    const invoice = await db.invoice.create({
      data: {
        merchantId: data.merchantId,
        invoiceNumber,
        customerEmail: data.customerEmail,
        customerName: data.customerName,
        customerAddress: data.customerAddress,
        subtotal: totals.subtotal,
        taxPercent,
        taxAmount: totals.taxAmount,
        discountPercent,
        discountAmount: totals.discountAmount,
        total: totals.total,
        chain: data.chain,
        token: data.token || 'USDC',
        paymentAddress,
        status: 'DRAFT',
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        notes: data.notes,
        customerNotes: data.customerNotes,
        lineItems: {
          create: data.lineItems.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.quantity * item.unitPrice
          }))
        }
      },
      include: {
        lineItems: true,
        merchant: {
          select: { companyName: true, email: true, website: true }
        }
      }
    });

    logger.info('Invoice created', {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      merchantId: data.merchantId,
      total: totals.total
    });

    return this.formatInvoiceResponse(invoice);
  }

  /**
   * Get an invoice by ID
   */
  async getInvoice(invoiceId: string): Promise<InvoiceResponse | null> {
    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: true,
        merchant: {
          select: { companyName: true, email: true, website: true }
        }
      }
    });

    if (!invoice) return null;

    return this.formatInvoiceResponse(invoice);
  }

  /**
   * Update an invoice (only DRAFT invoices can be updated)
   */
  async updateInvoice(invoiceId: string, data: UpdateInvoiceRequest): Promise<InvoiceResponse> {
    const existing = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true }
    });

    if (!existing) {
      throw new Error('Invoice not found');
    }

    if (existing.status !== 'DRAFT') {
      throw new Error('Only draft invoices can be updated');
    }

    // If line items are provided, recalculate totals
    let totals = {
      subtotal: Number(existing.subtotal),
      taxAmount: Number(existing.taxAmount),
      discountAmount: Number(existing.discountAmount),
      total: Number(existing.total)
    };

    if (data.lineItems) {
      const taxPercent = data.taxPercent ?? Number(existing.taxPercent);
      const discountPercent = data.discountPercent ?? Number(existing.discountPercent);
      totals = this.calculateTotals(data.lineItems, taxPercent, discountPercent);
    }

    // Update invoice
    const updateData: Prisma.InvoiceUpdateInput = {
      customerEmail: data.customerEmail,
      customerName: data.customerName,
      customerAddress: data.customerAddress,
      chain: data.chain,
      token: data.token,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      notes: data.notes,
      customerNotes: data.customerNotes,
      taxPercent: data.taxPercent,
      discountPercent: data.discountPercent,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      discountAmount: totals.discountAmount,
      total: totals.total
    };

    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if ((updateData as any)[key] === undefined) {
        delete (updateData as any)[key];
      }
    });

    const invoice = await db.$transaction(async (tx) => {
      // If line items provided, delete existing and create new
      if (data.lineItems) {
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId } });
        await tx.invoiceLineItem.createMany({
          data: data.lineItems.map(item => ({
            invoiceId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.quantity * item.unitPrice
          }))
        });
      }

      return tx.invoice.update({
        where: { id: invoiceId },
        data: updateData,
        include: {
          lineItems: true,
          merchant: {
            select: { companyName: true, email: true, website: true }
          }
        }
      });
    });

    logger.info('Invoice updated', { invoiceId, changes: Object.keys(updateData) });

    return this.formatInvoiceResponse(invoice);
  }

  /**
   * Delete an invoice (only DRAFT invoices can be deleted)
   */
  async deleteInvoice(invoiceId: string): Promise<void> {
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (invoice.status !== 'DRAFT') {
      throw new Error('Only draft invoices can be deleted');
    }

    await db.invoice.delete({ where: { id: invoiceId } });

    logger.info('Invoice deleted', { invoiceId, invoiceNumber: invoice.invoiceNumber });
  }

  /**
   * Send an invoice to customer (DRAFT -> SENT)
   */
  async sendInvoice(invoiceId: string): Promise<InvoiceResponse> {
    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: true,
        merchant: { select: { companyName: true, email: true, website: true } }
      }
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (invoice.status !== 'DRAFT') {
      throw new Error('Only draft invoices can be sent');
    }

    if (!invoice.customerEmail) {
      throw new Error('Customer email is required to send invoice');
    }

    const updated = await db.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'SENT',
        sentAt: new Date()
      },
      include: {
        lineItems: true,
        merchant: { select: { companyName: true, email: true, website: true } }
      }
    });

    logger.info('Invoice sent', {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      customerEmail: invoice.customerEmail
    });

    return this.formatInvoiceResponse(updated);
  }

  /**
   * Mark invoice as viewed (for public access tracking)
   */
  async markAsViewed(invoiceId: string): Promise<InvoiceResponse> {
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // Only mark as viewed if it's in SENT status
    if (invoice.status === 'SENT') {
      const updated = await db.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'VIEWED',
          viewedAt: new Date()
        },
        include: {
          lineItems: true,
          merchant: { select: { companyName: true, email: true, website: true } }
        }
      });

      logger.info('Invoice viewed', { invoiceId, invoiceNumber: invoice.invoiceNumber });

      return this.formatInvoiceResponse(updated);
    }

    const current = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: true,
        merchant: { select: { companyName: true, email: true, website: true } }
      }
    });

    return this.formatInvoiceResponse(current!);
  }

  /**
   * Mark invoice as paid (links to an order)
   */
  async markAsPaid(invoiceId: string, orderId: string): Promise<InvoiceResponse> {
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (invoice.status === 'PAID') {
      throw new Error('Invoice is already paid');
    }

    if (invoice.status === 'CANCELLED') {
      throw new Error('Cannot pay a cancelled invoice');
    }

    const updated = await db.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        orderId
      },
      include: {
        lineItems: true,
        merchant: { select: { companyName: true, email: true, website: true } }
      }
    });

    logger.info('Invoice paid', {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      orderId
    });

    // Fire invoice.paid webhook
    if (updated.merchantId) {
      try {
        const { webhookService } = await import('./webhookService');
        webhookService.sendWebhook(updated.merchantId, 'invoice.paid', {
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          orderId,
          amount: Number(updated.total),
          paidAt: new Date().toISOString(),
        }).catch(() => {});
      } catch {}
    }

    return this.formatInvoiceResponse(updated);
  }

  /**
   * Cancel an invoice
   */
  async cancelInvoice(invoiceId: string): Promise<InvoiceResponse> {
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (invoice.status === 'PAID') {
      throw new Error('Cannot cancel a paid invoice');
    }

    const updated = await db.invoice.update({
      where: { id: invoiceId },
      data: { status: 'CANCELLED' },
      include: {
        lineItems: true,
        merchant: { select: { companyName: true, email: true, website: true } }
      }
    });

    logger.info('Invoice cancelled', { invoiceId, invoiceNumber: invoice.invoiceNumber });

    return this.formatInvoiceResponse(updated);
  }

  /**
   * List invoices for a merchant with optional filters
   */
  async listInvoices(
    merchantId: string,
    filters: InvoiceFilters = {},
    page: number = 1,
    limit: number = 50
  ): Promise<{ invoices: InvoiceResponse[]; total: number; page: number; totalPages: number }> {
    const where: Prisma.InvoiceWhereInput = { merchantId };

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.startDate) {
      where.createdAt = { ...where.createdAt as any, gte: new Date(filters.startDate) };
    }
    if (filters.endDate) {
      where.createdAt = { ...where.createdAt as any, lte: new Date(filters.endDate) };
    }

    const [invoices, total] = await Promise.all([
      db.invoice.findMany({
        where,
        include: {
          lineItems: true,
          merchant: { select: { companyName: true, email: true, website: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit
      }),
      db.invoice.count({ where })
    ]);

    return {
      invoices: invoices.map(inv => this.formatInvoiceResponse(inv)),
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Get invoice statistics for a merchant
   */
  async getInvoiceStats(merchantId: string): Promise<InvoiceStats> {
    const [counts, totals] = await Promise.all([
      db.invoice.groupBy({
        by: ['status'],
        where: { merchantId },
        _count: { id: true }
      }),
      db.invoice.aggregate({
        where: { merchantId },
        _sum: { total: true }
      }),
      db.invoice.aggregate({
        where: { merchantId, status: 'PAID' },
        _sum: { total: true }
      })
    ]);

    const statusCounts = counts.reduce((acc, item) => {
      acc[item.status.toLowerCase()] = item._count.id;
      return acc;
    }, {} as Record<string, number>);

    const paidTotal = await db.invoice.aggregate({
      where: { merchantId, status: 'PAID' },
      _sum: { total: true }
    });

    return {
      total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      draft: statusCounts['draft'] || 0,
      sent: (statusCounts['sent'] || 0) + (statusCounts['viewed'] || 0),
      paid: statusCounts['paid'] || 0,
      overdue: statusCounts['overdue'] || 0,
      totalAmount: Number(totals._sum.total || 0),
      paidAmount: Number(paidTotal._sum.total || 0)
    };
  }

  /**
   * Mark overdue invoices (for cron job)
   */
  async markOverdueInvoices(): Promise<number> {
    const now = new Date();

    const result = await db.invoice.updateMany({
      where: {
        status: { in: ['SENT', 'VIEWED'] },
        dueDate: { lt: now }
      },
      data: { status: 'OVERDUE' }
    });

    if (result.count > 0) {
      logger.info('Marked invoices as overdue', { count: result.count });
    }

    return result.count;
  }

  /**
   * Generate PDF for an invoice
   */
  async generatePDF(invoiceId: string): Promise<Buffer> {
    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: true,
        merchant: { select: { companyName: true, email: true, website: true } }
      }
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    return pdfService.generateInvoicePDF(invoice);
  }

  /**
   * Format invoice for API response
   */
  private formatInvoiceResponse(invoice: any): InvoiceResponse {
    const baseUrl = process.env.BASE_URL || 'https://stablepay-nine.vercel.app';

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      merchantId: invoice.merchantId,
      customerEmail: invoice.customerEmail,
      customerName: invoice.customerName,
      customerAddress: invoice.customerAddress,
      subtotal: Number(invoice.subtotal),
      taxPercent: Number(invoice.taxPercent),
      taxAmount: Number(invoice.taxAmount),
      discountPercent: Number(invoice.discountPercent),
      discountAmount: Number(invoice.discountAmount),
      total: Number(invoice.total),
      chain: invoice.chain,
      token: invoice.token,
      paymentAddress: invoice.paymentAddress,
      status: invoice.status,
      dueDate: invoice.dueDate?.toISOString(),
      sentAt: invoice.sentAt?.toISOString(),
      viewedAt: invoice.viewedAt?.toISOString(),
      paidAt: invoice.paidAt?.toISOString(),
      orderId: invoice.orderId,
      notes: invoice.notes,
      customerNotes: invoice.customerNotes,
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
      lineItems: invoice.lineItems.map((item: any) => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        amount: Number(item.amount)
      })),
      paymentUrl: `${baseUrl}/pay/${invoice.id}`
    };
  }
}

export const invoiceService = new InvoiceService();
