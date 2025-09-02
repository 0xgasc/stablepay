import { db } from '../config/database';
import { CHAIN_CONFIGS } from '../config/chains';
import { Chain, CreateOrderRequest, CreateOrderResponse, OrderDetailsResponse } from '../types';
import { Decimal } from '@prisma/client/runtime/library';

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
      },
    });

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

    // Update order status to PAID
    const updatedOrder = await db.order.update({
      where: { id: orderId },
      data: { status: 'PAID' },
      include: { transactions: true }
    });

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
    // If transaction data provided, update transaction
    if (txData?.txHash) {
      await db.transaction.updateMany({
        where: { 
          orderId,
          txHash: txData.txHash 
        },
        data: { 
          status: 'CONFIRMED',
          blockNumber: txData.blockNumber ? BigInt(txData.blockNumber) : undefined,
          confirmations: txData.confirmations,
          blockTimestamp: new Date()
        }
      });
    }

    const confirmedOrder = await db.order.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED' },
      include: { transactions: true }
    });

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
    return db.order.update({
      where: { id: orderId },
      data: { status: 'EXPIRED' },
    });
  }
}