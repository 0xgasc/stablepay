/**
 * Money-core behavior tests: confirmOrder's atomic state machine, the expireOrder guard,
 * and candidate ranking. These exist because the matching/confirm spec changed twice in
 * production with no failing test — and because every bug here costs real dollars.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';

// ── Mock collaborators ───────────────────────────────────────────────────────
const dbMock = vi.hoisted(() => ({
  order: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  transaction: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  merchant: { update: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}));
vi.mock('../config/database', () => ({ db: dbMock }));
vi.mock('./emailService', () => ({ emailService: { sendPaymentNotification: vi.fn().mockResolvedValue(undefined), sendReceipt: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../services/emailService', () => ({ emailService: { sendPaymentNotification: vi.fn().mockResolvedValue(undefined), sendReceipt: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../services/webhookService', () => ({ webhookService: { sendWebhook: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../services/receiptService', () => ({ receiptService: { createReceipt: vi.fn().mockResolvedValue({ id: 'rcpt1', receiptNumber: 'RCP-TEST', customerEmail: null }) } }));
vi.mock('../services/storeResolver', () => ({ resolvePaymentAddress: vi.fn().mockResolvedValue({ address: '0xMERCHANT' }) }));

import { OrderService } from '../services/orderService';
import { webhookService } from '../services/webhookService';

const HOUR = 60 * 60 * 1000;

function baseOrder(over: Record<string, unknown> = {}) {
  return {
    id: 'order1',
    status: 'PENDING',
    amount: new Decimal(10),
    token: 'USDC',
    chain: 'SOLANA_MAINNET',
    nativeToken: null,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    merchantId: 'm1',
    storeId: null,
    externalId: null,
    customerEmail: null,
    customerWallet: null,
    paymentAddress: '0xMERCHANT',
    paymentMethod: 'MANUAL_SEND',
    metadata: {},
    ...over,
  };
}

function merchant(over: Record<string, unknown> = {}) {
  return {
    monthlyVolumeUsed: new Decimal(0),
    customFeePercent: null,
    isDayOne: false,
    networkMode: 'MAINNET',
    autoSendReceipts: false,
    ...over,
  };
}

/** Wire findUnique: first call (no include) → details; later calls (include) → confirmed view. */
function wireOrder(details: ReturnType<typeof baseOrder>, confirmedStatus = 'CONFIRMED') {
  dbMock.order.findUnique.mockImplementation(async (args: { include?: unknown }) => {
    if (args && args.include) {
      return { ...details, status: confirmedStatus, transactions: [], merchant: merchant() };
    }
    return details;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.order.update.mockResolvedValue({});
  dbMock.transaction.findUnique.mockResolvedValue(null);
  dbMock.transaction.create.mockResolvedValue({});
  dbMock.transaction.update.mockResolvedValue({});
});

// ── confirmOrder ─────────────────────────────────────────────────────────────
describe('confirmOrder atomic guard', () => {
  it('confirms a live PENDING order and records fees exactly once', async () => {
    wireOrder(baseOrder());
    dbMock.$executeRaw.mockResolvedValue(1); // UPDATE hit the PENDING arm

    const svc = new OrderService();
    const result = await svc.confirmOrder('order1', { txHash: '0xabc' });

    expect(result.status).toBe('CONFIRMED');
    expect((result as { _staleSkipped?: boolean })._staleSkipped).toBeUndefined();
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1); // fee accumulation
    expect(webhookService.sendWebhook).toHaveBeenCalledWith(
      'm1', 'order.confirmed', expect.objectContaining({ orderId: 'order1' }), expect.anything());
  });

  it('stale-skips an already-CONFIRMED order: no fees, no webhook (double-confirm guard)', async () => {
    const details = baseOrder({ status: 'CONFIRMED' });
    dbMock.order.findUnique.mockImplementation(async (args: { include?: unknown }) =>
      args && args.include ? { ...details, transactions: [] } : details);
    dbMock.$executeRaw.mockResolvedValue(0); // guard rejected the UPDATE

    const svc = new OrderService();
    const result = await svc.confirmOrder('order1');

    expect((result as { _staleSkipped?: boolean })._staleSkipped).toBe(true);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
    expect(webhookService.sendWebhook).not.toHaveBeenCalled();
  });

  it('confirms an EXPIRED stablecoin order inside the grace window and flags latePayment', async () => {
    wireOrder(baseOrder({ status: 'EXPIRED', expiresAt: new Date(Date.now() - 1 * HOUR) }));
    dbMock.$executeRaw.mockResolvedValue(1); // EXPIRED-in-grace arm accepted

    const svc = new OrderService();
    const result = await svc.confirmOrder('order1', { txHash: '0xlate' });

    expect(result.status).toBe('CONFIRMED');
    // latePayment metadata write happened (order.update with latePayment key)
    const metaWrites = dbMock.order.update.mock.calls.filter(
      (c: unknown[]) => JSON.stringify((c[0] as { data: unknown }).data).includes('latePayment'));
    expect(metaWrites.length).toBe(1);
  });

  it('also flags latePayment when the sweep flips PENDING→EXPIRED mid-confirm (race)', async () => {
    // Read says PENDING but expiry is already in the past — the UPDATE succeeded via the
    // EXPIRED arm. Stablecoin order ⇒ wasLate must catch it.
    wireOrder(baseOrder({ status: 'PENDING', expiresAt: new Date(Date.now() - 5 * 60 * 1000) }));
    dbMock.$executeRaw.mockResolvedValue(1);

    const svc = new OrderService();
    await svc.confirmOrder('order1');

    const metaWrites = dbMock.order.update.mock.calls.filter(
      (c: unknown[]) => JSON.stringify((c[0] as { data: unknown }).data).includes('latePayment'));
    expect(metaWrites.length).toBe(1);
  });

  it('rejects a txHash already bound to a DIFFERENT order (replay guard)', async () => {
    wireOrder(baseOrder());
    dbMock.transaction.findUnique.mockResolvedValue({ orderId: 'someOtherOrder', txHash: '0xabc' });

    const svc = new OrderService();
    await expect(svc.confirmOrder('order1', { txHash: '0xabc' }))
      .rejects.toThrow(/already used/i);
    expect(dbMock.$executeRaw).not.toHaveBeenCalled(); // never reached the status UPDATE
  });

  it('accepts a txHash already bound to the SAME order (scanner retry path)', async () => {
    wireOrder(baseOrder());
    dbMock.transaction.findUnique.mockResolvedValue({ orderId: 'order1', txHash: '0xabc' });
    dbMock.$executeRaw.mockResolvedValue(1);

    const svc = new OrderService();
    const result = await svc.confirmOrder('order1', { txHash: '0xabc' });
    expect(result.status).toBe('CONFIRMED');
    expect(dbMock.transaction.update).toHaveBeenCalled(); // updated, not duplicated
    expect(dbMock.transaction.create).not.toHaveBeenCalled();
  });
});

// ── expireOrder ──────────────────────────────────────────────────────────────
describe('expireOrder status guard', () => {
  it('expires a PENDING order and fires order.expired', async () => {
    dbMock.order.findUnique.mockResolvedValue(baseOrder());
    dbMock.$executeRaw.mockResolvedValue(1);

    const svc = new OrderService();
    await svc.expireOrder('order1');

    expect(webhookService.sendWebhook).toHaveBeenCalledWith(
      'm1', 'order.expired', expect.objectContaining({ orderId: 'order1' }), expect.anything());
  });

  it('does NOT fire order.expired when the order was already CONFIRMED (clobber guard)', async () => {
    dbMock.order.findUnique.mockResolvedValue(baseOrder({ status: 'CONFIRMED' }));
    dbMock.$executeRaw.mockResolvedValue(0); // status='PENDING' filter rejected it

    const svc = new OrderService();
    await svc.expireOrder('order1');

    expect(webhookService.sendWebhook).not.toHaveBeenCalled();
  });
});
