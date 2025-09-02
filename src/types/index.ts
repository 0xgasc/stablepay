export type Chain = 'BASE_SEPOLIA' | 'ETHEREUM_SEPOLIA';

export type OrderStatus = 'PENDING' | 'PAID' | 'CONFIRMED' | 'REFUNDED' | 'EXPIRED' | 'CANCELLED';

export type TransactionStatus = 'PENDING' | 'CONFIRMED' | 'FAILED';

export type RefundStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PROCESSED';

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