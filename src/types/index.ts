import {
  Chain as PrismaChain,
  OrderStatus as PrismaOrderStatus,
  TransactionStatus as PrismaTransactionStatus,
  RefundStatus as PrismaRefundStatus,
  InvoiceStatus as PrismaInvoiceStatus,
  ReceiptDeliveryStatus as PrismaReceiptDeliveryStatus
} from '@prisma/client';

export type Chain = PrismaChain;
export type OrderStatus = PrismaOrderStatus;
export type TransactionStatus = PrismaTransactionStatus;
export type RefundStatus = PrismaRefundStatus;
export type InvoiceStatus = PrismaInvoiceStatus;
export type ReceiptDeliveryStatus = PrismaReceiptDeliveryStatus;

export interface CreateOrderRequest {
  amount: number;
  chain: Chain;
  merchantId?: string;
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

// Invoice types
export interface LineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateInvoiceRequest {
  merchantId: string;
  customerEmail?: string;
  customerName?: string;
  customerAddress?: string;
  chain?: Chain;
  token?: string;
  dueDate?: string;
  notes?: string;
  customerNotes?: string;
  taxPercent?: number;
  discountPercent?: number;
  lineItems: LineItemInput[];
}

export interface UpdateInvoiceRequest {
  customerEmail?: string;
  customerName?: string;
  customerAddress?: string;
  chain?: Chain;
  token?: string;
  dueDate?: string;
  notes?: string;
  customerNotes?: string;
  taxPercent?: number;
  discountPercent?: number;
  lineItems?: LineItemInput[];
}

export interface InvoiceLineItemResponse {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface InvoiceResponse {
  id: string;
  invoiceNumber: string;
  merchantId: string;
  customerEmail?: string;
  customerName?: string;
  customerAddress?: string;
  subtotal: number;
  taxPercent: number;
  taxAmount: number;
  discountPercent: number;
  discountAmount: number;
  total: number;
  chain?: Chain;
  token: string;
  paymentAddress?: string;
  status: InvoiceStatus;
  dueDate?: string;
  sentAt?: string;
  viewedAt?: string;
  paidAt?: string;
  orderId?: string;
  notes?: string;
  customerNotes?: string;
  createdAt: string;
  updatedAt: string;
  lineItems: InvoiceLineItemResponse[];
  paymentUrl?: string;
}

export interface InvoiceFilters {
  status?: InvoiceStatus;
  startDate?: string;
  endDate?: string;
}

export interface InvoiceStats {
  total: number;
  draft: number;
  sent: number;
  paid: number;
  overdue: number;
  totalAmount: number;
  paidAmount: number;
}

// Receipt types
export interface ReceiptResponse {
  id: string;
  receiptNumber: string;
  orderId: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  token: string;
  chain: Chain;
  txHash?: string;
  customerEmail?: string;
  customerName?: string;
  emailStatus: ReceiptDeliveryStatus;
  emailSentAt?: string;
  paymentDate: string;
  createdAt: string;
}

export interface ReceiptFilters {
  startDate?: string;
  endDate?: string;
}