import { Chain as PrismaChain, OrderStatus as PrismaOrderStatus, TransactionStatus as PrismaTransactionStatus, RefundStatus as PrismaRefundStatus } from '@prisma/client';

export type Chain = PrismaChain;
export type OrderStatus = PrismaOrderStatus;
export type TransactionStatus = PrismaTransactionStatus;
export type RefundStatus = PrismaRefundStatus;

export interface CreateOrderRequest {
  amount: number;
  chain: Chain;
  customerEmail?: string;
  customerName?: string;
  expiryMinutes?: number;
}

export interface CreateOrderResponse {
  orderId: string;
  amount: number;
  chain: Chain;
  paymentAddress: string;
  usdcAddress: string;
  expiresAt: string;
  status: OrderStatus;
}

export interface OrderDetailsResponse {
  id: string;
  amount: number;
  chain: Chain;
  status: OrderStatus;
  paymentAddress: string;
  customerEmail?: string;
  customerName?: string;
  expiresAt: string;
  createdAt: string;
  transactions: TransactionInfo[];
}

export interface TransactionInfo {
  id: string;
  txHash: string;
  chain: Chain;
  amount: number;
  fromAddress: string;
  status: TransactionStatus;
  confirmations: number;
  blockNumber?: number;
  blockTimestamp?: string;
}