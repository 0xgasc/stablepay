import { db } from '../config/database';
import { CHAIN_CONFIGS } from '../config/chains';
import { Chain, CreateOrderRequest, CreateOrderResponse, OrderDetailsResponse } from '../types';
import { Decimal } from '@prisma/client/runtime/library';
import { canProcessPayment, calculateFee, getVolumeTier, getTransactionFeePercent } from '../config/pricing';
import { logger } from '../utils/logger';
import { webhookService } from './webhookService';

export class OrderService {
  async createOrder(data: CreateOrderRequest): Promise<CreateOrderResponse> {
    const chainConfig = CHAIN_CONFIGS[data.chain];
    if (!chainConfig) {
      throw new Error(`Unsupported chain: ${data.chain}`);
    }

    const expiryMinutes = data.expiryMinutes || 30;
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    const order = await db.order.create({
      data: {
        amount: new Decimal(data.amount),
        chain: data.chain,
        customerEmail: data.customerEmail,
        customerName: data.customerName,
        paymentAddress: chainConfig.paymentAddress,
        expiresAt,
        merchantId: data.merchantId,
      },
    });

    // Send webhook for order creation
    if (order.merchantId) {
      webhookService.sendWebhook(order.merchantId, 'order.created', {
        orderId: order.id,
        amount: data.amount,
        chain: data.chain,
        paymentAddress: chainConfig.paymentAddress,
        expiresAt: expiresAt.toISOString(),
      }).catch(err => {
        logger.error('Failed to send order.created webhook', err as Error, { orderId: order.id });
      });
    }

    return {
      orderId: order.id,
      amount: data.amount,
      chain: data.chain,
      paymentAddress: chainConfig.paymentAddress,
      usdcAddress: chainConfig.usdcAddress,
      expiresAt: expiresAt.toISOString(),
      status: order.status,
    };
  }

  async getOrder(orderId: string): Promise<OrderDetailsResponse | null> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!order) return null;

    return {
      id: order.id,
      amount: Number(order.amount),
      chain: order.chain,
      status: order.status,
      paymentAddress: order.paymentAddress,
      customerEmail: order.customerEmail || undefined,
      customerName: order.customerName || undefined,
      expiresAt: order.expiresAt.toISOString(),
      createdAt: order.createdAt.toISOString(),
      transactions: order.transactions.map(tx => ({
        id: tx.id,
        txHash: tx.txHash,
        chain: tx.chain,
        amount: Number(tx.amount),
        fromAddress: tx.fromAddress,
        status: tx.status,
        confirmations: tx.confirmations,
        blockNumber: tx.blockNumber ? Number(tx.blockNumber) : undefined,
        blockTimestamp: tx.blockTimestamp?.toISOString(),
      })),
    };
  }

  async getAllOrders(page = 1, limit = 50, includeTransactions = false) {
    const skip = (page - 1) * limit;
    
    const [orders, total] = await Promise.all([
      db.order.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          transactions: includeTransactions,
        },
      }),
      db.order.count(),
    ]);

    return {
      orders: orders.map(order => ({
        id: order.id,
        amount: Number(order.amount),
        chain: order.chain,
        status: order.status,
        customerEmail: order.customerEmail,
        customerName: order.customerName,
        createdAt: order.createdAt.toISOString(),
        expiresAt: order.expiresAt.toISOString(),
        transactionCount: order.transactions?.length || 0,
        ...(includeTransactions && {
          transactions: order.transactions?.map(tx => ({
            id: tx.id,
            txHash: tx.txHash,
            chain: tx.chain,
            amount: Number(tx.amount),
            fromAddress: tx.fromAddress,
            status: tx.status,
            confirmations: tx.confirmations,
            blockNumber: tx.blockNumber ? Number(tx.blockNumber) : undefined,
            blockTimestamp: tx.blockTimestamp?.toISOString(),
          })) || []
        })
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async updateOrderWithTransaction(orderId: string, txHash: string, fromAddress?: string) {
    // Get order details first
    const orderDetails = await db.order.findUnique({ 
      where: { id: orderId } 
    });
    
    if (!orderDetails) {
      throw new Error('Order not found');
    }

    // Check if transaction already exists
    const existingTx = await db.transaction.findUnique({
      where: { txHash }
    });

    let transaction;
    if (existingTx) {
      // Update existing transaction
      transaction = await db.transaction.update({
        where: { txHash },
        data: {
          fromAddress: fromAddress || existingTx.fromAddress,
          status: 'PENDING'
        }
      });
    } else {
      // Create new transaction
      transaction = await db.transaction.create({
        data: {
          orderId,
          txHash,
          chain: orderDetails.chain,
          amount: orderDetails.amount,
          fromAddress: fromAddress || 'Unknown',
          toAddress: orderDetails.paymentAddress,
          status: 'PENDING'
        }
      });
    }

    // Update order status to PAID using raw SQL
    const now = new Date();
    await db.$executeRaw`UPDATE orders SET status = 'PAID'::"OrderStatus", "updatedAt" = ${now} WHERE id = ${orderId}`;

    const updatedOrder = await db.order.findUnique({
      where: { id: orderId },
      include: { transactions: true }
    });

    if (!updatedOrder) {
      throw new Error('Order not found after update');
    }

    // Convert BigInt values to numbers for JSON serialization
    return {
      ...updatedOrder,
      amount: Number(updatedOrder.amount),
      transactions: updatedOrder.transactions.map((tx: any) => ({
        ...tx,
        amount: Number(tx.amount),
        blockNumber: tx.blockNumber ? Number(tx.blockNumber) : null
      }))
    };
  }

  async confirmOrder(orderId: string, txData?: {
    txHash?: string,
    blockNumber?: number,
    confirmations?: number
  }) {
    // Get order details
    const orderDetails = await db.order.findUnique({
      where: { id: orderId }
    });

    if (!orderDetails) {
      throw new Error('Order not found');
    }

    // If transaction data provided, create or update transaction
    if (txData?.txHash) {
      const existingTx = await db.transaction.findUnique({
        where: { txHash: txData.txHash }
      });

      if (existingTx) {
        // Update existing transaction
        await db.transaction.update({
          where: { txHash: txData.txHash },
          data: {
            status: 'CONFIRMED',
            blockNumber: txData.blockNumber ? BigInt(txData.blockNumber) : undefined,
            confirmations: txData.confirmations,
            blockTimestamp: new Date()
          }
        });
      } else {
        // Create new transaction
        await db.transaction.create({
          data: {
            orderId,
            txHash: txData.txHash,
            chain: orderDetails.chain,
            amount: orderDetails.amount,
            fromAddress: orderDetails.customerName || 'Unknown', // Use customer name as placeholder
            toAddress: orderDetails.paymentAddress,
            status: 'CONFIRMED',
            blockNumber: txData.blockNumber ? BigInt(txData.blockNumber) : undefined,
            confirmations: txData.confirmations || 1,
            blockTimestamp: new Date()
          }
        });
      }
    }

    // Use raw SQL to update status and updatedAt
    const confirmNow = new Date();
    await db.$executeRaw`UPDATE orders SET status = 'CONFIRMED'::"OrderStatus", "updatedAt" = ${confirmNow} WHERE id = ${orderId}`;

    const confirmedOrder = await db.order.findUnique({
      where: { id: orderId },
      include: { transactions: true, merchant: true }
    });

    if (!confirmedOrder) {
      throw new Error('Order not found after update');
    }

    // Accumulate fees on merchant account
    if (confirmedOrder.merchantId && confirmedOrder.merchant) {
      const orderAmount = Number(confirmedOrder.amount);
      const currentVolume = Number(confirmedOrder.merchant.monthlyVolumeUsed) || 0;
      const customFee = confirmedOrder.merchant.customFeePercent
        ? Number(confirmedOrder.merchant.customFeePercent)
        : null;

      // Calculate fee at NEW volume tier (after this order is added)
      const newVolume = currentVolume + orderAmount;
      const feePercent = getTransactionFeePercent(newVolume, customFee);
      const feeAmount = orderAmount * feePercent;

      const isMainnet = confirmedOrder.merchant.networkMode === 'MAINNET';

      // Atomic update: volume, fees, and order in one transaction
      await db.$transaction([
        // Update order with fee info
        db.order.update({
          where: { id: orderId },
          data: {
            feePercent: new Decimal(feePercent),
            feeAmount: new Decimal(feeAmount)
          }
        }),
        // Update merchant: increment feesDue AND volume in same transaction
        db.merchant.update({
          where: { id: confirmedOrder.merchantId },
          data: {
            feesDue: { increment: feeAmount },
            monthlyVolumeUsed: { increment: orderAmount },
            monthlyTransactions: { increment: 1 },
            ...(isMainnet && {
              mainnetVolumeUsed: { increment: orderAmount },
              mainnetTransactions: { increment: 1 }
            }),
            ...(!isMainnet && {
              testnetVolumeUsed: { increment: orderAmount },
              testnetTransactions: { increment: 1 }
            })
          }
        })
      ]);

      logger.info('Order fee and volume recorded', {
        orderId,
        merchantId: confirmedOrder.merchantId,
        orderAmount,
        previousVolume: currentVolume,
        newVolume,
        feePercent,
        feeAmount,
        event: 'order.fee_recorded'
      });

      // Send webhook for order confirmation
      webhookService.sendWebhook(confirmedOrder.merchantId, 'order.confirmed', {
        orderId: confirmedOrder.id,
        amount: orderAmount,
        chain: confirmedOrder.chain,
        txHash: txData?.txHash,
        feePercent,
        feeAmount,
      }).catch(err => {
        logger.error('Failed to send order.confirmed webhook', err as Error, { orderId });
      });
    }

    // Convert BigInt values to numbers for JSON serialization
    return {
      ...confirmedOrder,
      amount: Number(confirmedOrder.amount),
      transactions: confirmedOrder.transactions.map((tx: any) => ({
        ...tx,
        amount: Number(tx.amount),
        blockNumber: tx.blockNumber ? Number(tx.blockNumber) : null
      }))
    };
  }

  async expireOrder(orderId: string) {
    // Get order details first for webhook
    const order = await db.order.findUnique({ where: { id: orderId } });

    const now = new Date();
    await db.$executeRaw`UPDATE orders SET status = 'EXPIRED'::"OrderStatus", "updatedAt" = ${now} WHERE id = ${orderId}`;

    // Send webhook for order expiration
    if (order?.merchantId) {
      webhookService.sendWebhook(order.merchantId, 'order.expired', {
        orderId: order.id,
        amount: Number(order.amount),
        chain: order.chain,
        expiredAt: now.toISOString(),
      }).catch(err => {
        logger.error('Failed to send order.expired webhook', err as Error, { orderId });
      });
    }

    return db.order.findUnique({ where: { id: orderId } });
  }

  async checkTierLimits(merchantId: string, orderAmount: number): Promise<{
    allowed: boolean;
    reason?: string;
    upgradeRequired?: boolean;
    suspended?: boolean;
    feePercent?: number;
    feeAmount?: number;
    volumeTier?: string;
  }> {
    const merchant = await db.merchant.findUnique({
      where: { id: merchantId },
      select: {
        plan: true,
        networkMode: true,
        monthlyVolumeUsed: true,
        monthlyTransactions: true,
        mainnetVolumeUsed: true,
        mainnetTransactions: true,
        testnetVolumeUsed: true,
        testnetTransactions: true,
        billingCycleStart: true,
        customFeePercent: true,
        isSuspended: true,
        feesDue: true,
      },
    });

    if (!merchant) {
      return { allowed: false, reason: 'Merchant not found' };
    }

    // Check if merchant is suspended for unpaid fees
    if (merchant.isSuspended) {
      return {
        allowed: false,
        reason: 'Account suspended due to unpaid fees. Please pay your outstanding balance to continue.',
        suspended: true
      };
    }

    // Reset monthly volume if billing cycle has passed
    const now = new Date();
    const billingCycleStart = new Date(merchant.billingCycleStart);
    const daysSinceStart = Math.floor((now.getTime() - billingCycleStart.getTime()) / (1000 * 60 * 60 * 24));

    let currentMonthlyVolume = parseFloat(merchant.monthlyVolumeUsed.toString());
    let currentMainnetVolume = parseFloat(merchant.mainnetVolumeUsed.toString());
    let currentMainnetTxns = merchant.mainnetTransactions;

    if (daysSinceStart >= 30) {
      // Reset billing cycle
      await db.merchant.update({
        where: { id: merchantId },
        data: {
          monthlyVolumeUsed: 0,
          monthlyTransactions: 0,
          mainnetVolumeUsed: 0,
          mainnetTransactions: 0,
          testnetVolumeUsed: 0,
          testnetTransactions: 0,
          billingCycleStart: now,
        },
      });
      currentMonthlyVolume = 0;
      currentMainnetVolume = 0;
      currentMainnetTxns = 0;
    }

    // Calculate fee based on volume tier
    const customFee = merchant.customFeePercent ? parseFloat(merchant.customFeePercent.toString()) : null;
    const feePercent = getTransactionFeePercent(currentMonthlyVolume, customFee);
    const feeAmount = orderAmount * feePercent;
    const volumeTier = getVolumeTier(currentMonthlyVolume);

    // For FREE tier, check mainnet vs testnet limits separately
    const networkMode = merchant.networkMode;

    if (merchant.plan === 'FREE') {
      // Use mainnet-specific tracking for FREE tier
      const result = canProcessPayment(
        merchant.plan,
        currentMainnetVolume,
        orderAmount,
        networkMode,
        currentMainnetTxns
      );
      return { ...result, feePercent, feeAmount, volumeTier: volumeTier.name };
    }

    // For other tiers (STARTER, PRO, ENTERPRISE), no limits - just return fee info
    return {
      allowed: true,
      feePercent,
      feeAmount,
      volumeTier: volumeTier.name
    };
  }

  async updateMerchantVolume(merchantId: string, amount: number) {
    // Get merchant's network mode
    const merchant = await db.merchant.findUnique({
      where: { id: merchantId },
      select: { networkMode: true },
    });

    if (!merchant) {
      throw new Error('Merchant not found');
    }

    const isMainnet = merchant.networkMode === 'MAINNET';

    // Update both combined and network-specific counters
    await db.merchant.update({
      where: { id: merchantId },
      data: {
        monthlyVolumeUsed: {
          increment: amount,
        },
        monthlyTransactions: {
          increment: 1,
        },
        ...(isMainnet && {
          mainnetVolumeUsed: {
            increment: amount,
          },
          mainnetTransactions: {
            increment: 1,
          },
        }),
        ...(!isMainnet && {
          testnetVolumeUsed: {
            increment: amount,
          },
          testnetTransactions: {
            increment: 1,
          },
        }),
      },
    });

    logger.info('Merchant volume updated', {
      merchantId,
      amount,
      networkMode: merchant.networkMode,
      event: 'volume.updated'
    });
  }
}