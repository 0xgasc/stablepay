import { db } from '../config/database';
import { Decimal } from '@prisma/client/runtime/library';

export interface CreateRefundRequest {
  orderId: string;
  amount?: number;
  reason: string;
}

export interface RefundPolicy {
  maxRefundDays: number;
  allowPartialRefunds: boolean;
  requireApproval: boolean;
  autoRefundThreshold: number;
}

export class RefundService {
  private policy: RefundPolicy = {
    maxRefundDays: 30,
    allowPartialRefunds: true,
    requireApproval: true,
    autoRefundThreshold: 100,
  };

  async createRefund(data: CreateRefundRequest): Promise<any> {
    const order = await db.order.findUnique({
      where: { id: data.orderId },
      include: { transactions: true, refunds: true },
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

    const shouldAutoApprove = !this.policy.requireApproval || refundAmount <= this.policy.autoRefundThreshold;

    const refund = await db.refund.create({
      data: {
        orderId: data.orderId,
        amount: new Decimal(refundAmount),
        reason: data.reason,
        status: shouldAutoApprove ? 'APPROVED' : 'PENDING',
        approvedBy: shouldAutoApprove ? 'SYSTEM' : undefined,
      },
    });

    if (shouldAutoApprove) {
      await this.processRefund(refund.id);
    }

    return refund;
  }

  async approveRefund(refundId: string, approvedBy: string): Promise<any> {
    const refund = await db.refund.update({
      where: { id: refundId },
      data: {
        status: 'APPROVED',
        approvedBy,
      },
    });

    await this.processRefund(refundId);
    return refund;
  }

  async rejectRefund(refundId: string, approvedBy: string): Promise<any> {
    return db.refund.update({
      where: { id: refundId },
      data: {
        status: 'REJECTED',
        approvedBy,
      },
    });
  }

  private async processRefund(refundId: string): Promise<void> {
    const refund = await db.refund.findUnique({
      where: { id: refundId },
      include: { order: true },
    });

    if (!refund || refund.status !== 'APPROVED') return;

    try {
      const refundTxHash = await this.executeRefundTransaction(refund);

      await db.refund.update({
        where: { id: refundId },
        data: {
          status: 'PROCESSED',
          refundTxHash,
        },
      });

      const now = new Date();
      await db.$executeRaw`UPDATE orders SET status = 'REFUNDED'::"OrderStatus", "updatedAt" = ${now} WHERE id = ${refund.orderId}`;

      console.log(`Refund processed: ${refundId}, tx: ${refundTxHash}`);
    } catch (error) {
      console.error(`Failed to process refund ${refundId}:`, error);
    }
  }

  private async executeRefundTransaction(refund: any): Promise<string> {
    console.log(`Mock refund transaction for ${refund.amount} USDC`);
    return `0x${Math.random().toString(16).substr(2, 64)}`;
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