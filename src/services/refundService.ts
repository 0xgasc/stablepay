import { db } from '../config/database';
import { Decimal } from '@prisma/client/runtime/library';
import { logger } from '../utils/logger';

export interface CreateRefundRequest {
  orderId: string;
  amount?: number;
  reason: string;
  customerWallet?: string; // Customer's wallet address for refund
}

export interface RefundPolicy {
  maxRefundDays: number;
  allowPartialRefunds: boolean;
  autoApproveThreshold: number; // Auto-approve small refunds
}

export class RefundService {
  private policy: RefundPolicy = {
    maxRefundDays: 30,
    allowPartialRefunds: true,
    autoApproveThreshold: 50, // Auto-approve refunds under $50
  };

  async createRefund(data: CreateRefundRequest): Promise<any> {
    const order = await db.order.findUnique({
      where: { id: data.orderId },
      include: {
        transactions: true,
        refunds: true,
        merchant: { select: { id: true, companyName: true, email: true } }
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    if (order.status !== 'PAID' && order.status !== 'CONFIRMED') {
      throw new Error('Order must be paid or confirmed to request refund');
    }

    const orderAge = Date.now() - order.createdAt.getTime();
    const maxAge = this.policy.maxRefundDays * 24 * 60 * 60 * 1000;

    if (orderAge > maxAge) {
      throw new Error(`Refunds are only allowed within ${this.policy.maxRefundDays} days`);
    }

    const paidAmount = Number(order.amount);
    const refundAmount = data.amount || paidAmount;

    if (refundAmount > paidAmount) {
      throw new Error('Refund amount cannot exceed paid amount');
    }

    if (!this.policy.allowPartialRefunds && refundAmount !== paidAmount) {
      throw new Error('Partial refunds are not allowed');
    }

    const existingRefunds = order.refunds.filter(r => r.status !== 'REJECTED');
    const totalRefunded = existingRefunds.reduce((sum, r) => sum + Number(r.amount), 0);

    if (totalRefunded + refundAmount > paidAmount) {
      throw new Error('Total refund amount would exceed paid amount');
    }

    // Auto-approve small refunds, otherwise PENDING for merchant review
    const shouldAutoApprove = refundAmount <= this.policy.autoApproveThreshold;

    const refund = await db.refund.create({
      data: {
        orderId: data.orderId,
        amount: new Decimal(refundAmount),
        reason: data.reason,
        status: shouldAutoApprove ? 'APPROVED' : 'PENDING',
        approvedBy: shouldAutoApprove ? 'AUTO' : undefined,
      },
    });

    logger.info('Refund request created', {
      refundId: refund.id,
      orderId: data.orderId,
      amount: refundAmount,
      status: refund.status,
      merchantId: order.merchantId || undefined,
      event: 'refund.created'
    });

    return {
      ...refund,
      order: {
        id: order.id,
        amount: Number(order.amount),
        chain: order.chain,
        customerEmail: order.customerEmail
      },
      merchant: order.merchant
    };
  }

  async approveRefund(refundId: string, approvedBy: string): Promise<any> {
    const refund = await db.refund.update({
      where: { id: refundId },
      data: {
        status: 'APPROVED',
        approvedBy,
      },
      include: {
        order: {
          include: { merchant: true }
        }
      }
    });

    logger.info('Refund approved', {
      refundId,
      approvedBy,
      event: 'refund.approved'
    });

    // Don't auto-process - merchant must send funds and submit tx hash
    return refund;
  }

  async rejectRefund(refundId: string, rejectedBy: string, reason?: string): Promise<any> {
    const refund = await db.refund.update({
      where: { id: refundId },
      data: {
        status: 'REJECTED',
        approvedBy: rejectedBy,
      },
    });

    logger.info('Refund rejected', {
      refundId,
      rejectedBy,
      reason,
      event: 'refund.rejected'
    });

    return refund;
  }

  // Called when merchant submits the tx hash after sending funds
  async processRefund(refundId: string, txHash: string, processedBy: string): Promise<any> {
    const refund = await db.refund.findUnique({
      where: { id: refundId },
      include: { order: true },
    });

    if (!refund) {
      throw new Error('Refund not found');
    }

    if (refund.status !== 'APPROVED') {
      throw new Error('Refund must be approved before processing');
    }

    // Update refund with tx hash
    const updatedRefund = await db.refund.update({
      where: { id: refundId },
      data: {
        status: 'PROCESSED',
        refundTxHash: txHash,
      },
    });

    // Update order status to REFUNDED
    const now = new Date();
    await db.$executeRaw`UPDATE orders SET status = 'REFUNDED'::"OrderStatus", "updatedAt" = ${now} WHERE id = ${refund.orderId}`;

    logger.info('Refund processed', {
      refundId,
      txHash,
      processedBy,
      orderId: refund.orderId,
      amount: Number(refund.amount),
      event: 'refund.processed'
    });

    return updatedRefund;
  }

  // Get refund details with customer wallet info from transaction
  async getRefundDetails(refundId: string): Promise<any> {
    const refund = await db.refund.findUnique({
      where: { id: refundId },
      include: {
        order: {
          include: {
            transactions: true,
            merchant: {
              select: { id: true, companyName: true, email: true }
            }
          }
        }
      }
    });

    if (!refund) return null;

    // Get customer wallet from the payment transaction
    const paymentTx = refund.order.transactions.find(tx => tx.status === 'CONFIRMED');
    const customerWallet = paymentTx?.fromAddress;

    return {
      ...refund,
      amount: Number(refund.amount),
      customerWallet,
      order: {
        ...refund.order,
        amount: Number(refund.order.amount)
      }
    };
  }

  async getPendingRefunds(): Promise<any[]> {
    return db.refund.findMany({
      where: { status: 'PENDING' },
      include: { order: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getRefundStats() {
    const [total, pending, approved, rejected, processed] = await Promise.all([
      db.refund.count(),
      db.refund.count({ where: { status: 'PENDING' } }),
      db.refund.count({ where: { status: 'APPROVED' } }),
      db.refund.count({ where: { status: 'REJECTED' } }),
      db.refund.count({ where: { status: 'PROCESSED' } }),
    ]);

    const totalAmount = await db.refund.aggregate({
      where: { status: 'PROCESSED' },
      _sum: { amount: true },
    });

    return {
      total,
      pending,
      approved,
      rejected,
      processed,
      totalRefunded: Number(totalAmount._sum.amount || 0),
    };
  }
}