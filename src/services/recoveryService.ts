// ─── Native stranded-fund auto-recovery ────────────────────────────────────────
// Periodically reconciles native-token orders whose funds landed in a receive wallet
// but never settled (swap failed / never ran). Policy (chosen by product):
//   Stage 1 — RETRY the swap (recovers the SALE → merchant gets paid, order CONFIRMED).
//   Stage 2 — if the swap is exhausted AND the order is past expiry+grace, REFUND the
//             customer, but ONLY to a known-good order.customerWallet.
//   Stage 3 — otherwise flag the order for MANUAL review and leave the funds put.
//
// Money-safety invariants (hardened after an adversarial audit found double-spend/
// double-pay/double-refund holes in the naive version):
//   • Never re-mark an order PENDING unconditionally — use an optimistic-locked
//     conditional updateMany (status ∈ {EXPIRED,PROCESSING} AND updatedAt == snapshot),
//     so we can never stomp a PROCESSING set by the live 15s scanner mid-swap.
//   • swapAndForward re-reads on-chain balance and refuses to re-swap drained wallets
//     (E_ALREADY_SWEPT) — defends both this loop and the live scanner.
//   • Swap SUCCESS is persisted (rec.lastForwardTxHash) BEFORE confirmOrder, so a confirm
//     failure can never be mistaken for a swap failure → never re-swaps a paid order.
//   • Refund is at-most-once: refundNativeToAddress claims REFUNDED before broadcasting.
//   • Claim collisions ("already processing") don't burn the retry budget.
//   • Never touch CONFIRMED/REFUNDED/CANCELLED (excluded in the query); per-order try/catch.
import { ethers } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import { db } from '../config/database';
import { logger } from '../utils/logger';
import { swapAndForward, refundNativeToAddress, getReceiveWalletBalance } from './swapService';

const MAX_SWAP_RETRIES = 3;
const STALE_MS         = 12 * 60_000;      // don't act on an order updated within this window
const REFUND_GRACE_MS  = 30 * 60_000;      // wait this long past expiry before auto-refunding
const DUST             = 0.0001;           // ignore receive wallets at/below dust
const PER_CYCLE_CAP    = 25;               // bound RPC load per cycle
const LOOKBACK_MS      = 14 * 86_400_000;  // only reconcile wallets from the last 14 days

let running = false;

function isValidAddressForChain(addr: string | null | undefined, chain: string): boolean {
  if (!addr || typeof addr !== 'string') return false;
  if (chain.startsWith('SOLANA')) {
    try { new PublicKey(addr); return true; } catch { return false; }
  }
  return ethers.isAddress(addr);
}

function isBenignClaimCollision(msg: string): boolean {
  return msg.includes('already processing') || msg.includes('not pending');
}

async function tryConfirm(orderId: string, txHash: string): Promise<boolean> {
  try {
    const { OrderService } = await import('./orderService');
    await new OrderService().confirmOrder(orderId, { txHash });
  } catch { /* fall through — verify by the row's real status below */ }
  // Source of truth is the row's actual status, not absence-of-throw. This correctly handles
  // confirmOrder's non-throwing stale-skip (status NOT moved → false) AND a post-confirm
  // bookkeeping throw (status already CONFIRMED → true). Only a genuine non-transition is false.
  const o = await db.order.findUnique({ where: { id: orderId }, select: { status: true } }).catch(() => null);
  return o?.status === 'CONFIRMED';
}

async function flagManualReview(orderId: string, meta: any, rec: any, why: string, extra: Record<string, unknown>): Promise<void> {
  if (rec.needsManualReview) return;
  rec.needsManualReview = true;
  rec.flaggedAt = new Date().toISOString();
  rec.flagReason = why;
  await db.order.update({ where: { id: orderId }, data: { metadata: { ...meta, recovery: rec } } }).catch(err => logger.warn('non-critical async op failed (recoveryService)', { error: (err as Error)?.message }));
  logger.security(`Auto-recovery: MANUAL review — ${why}`, { orderId, event: 'recovery.manual_review', ...extra });
}

export interface RecoveryStats {
  scanned: number; withFunds: number; swapped: number; refunded: number; reconciled: number; manualReview: number; errors: number; skipped?: boolean;
}

export async function recoverStrandedNative(): Promise<RecoveryStats> {
  if (running) {
    logger.warn('Auto-recovery: previous cycle still running, skipping');
    return { scanned: 0, withFunds: 0, swapped: 0, refunded: 0, reconciled: 0, manualReview: 0, errors: 0, skipped: true };
  }
  running = true;
  const stats: RecoveryStats = { scanned: 0, withFunds: 0, swapped: 0, refunded: 0, reconciled: 0, manualReview: 0, errors: 0 };
  try {
    const since = new Date(Date.now() - LOOKBACK_MS);
    const wallets = await db.nativeReceiveWallet.findMany({
      where: { createdAt: { gte: since }, order: { status: { notIn: ['CONFIRMED', 'REFUNDED', 'CANCELLED'] } } },
      include: { order: true },
      orderBy: { createdAt: 'asc' },
      take: PER_CYCLE_CAP,
    });

    for (const w of wallets) {
      stats.scanned++;
      const order = w.order;
      try {
        const chain = String(order.chain);
        const meta: any = (order.metadata && typeof order.metadata === 'object') ? { ...(order.metadata as any) } : {};
        const rec: any = meta.recovery || { swapAttempts: 0 };

        // ── A) Reconcile a forwarded-but-unconfirmed order (merchant already paid). Runs
        //       regardless of balance — the wallet is drained after a successful forward,
        //       so the dust check below would otherwise skip it forever. NEVER re-swaps.
        if (rec.lastForwardTxHash) {
          if (await tryConfirm(order.id, rec.lastForwardTxHash)) {
            stats.reconciled++;
            logger.security('Auto-recovery: reconciled stuck PROCESSING → CONFIRMED', { orderId: order.id, txHash: rec.lastForwardTxHash, event: 'recovery.reconciled' });
          } else {
            await flagManualReview(order.id, meta, rec, 'forwarded but cannot confirm', { forwardTxHash: rec.lastForwardTxHash });
            stats.manualReview++;
          }
          continue;
        }

        // ── B) Staleness fast-path filter — the live scanner may be mid-swap on a freshly
        //       touched order. The optimistic-locked claim below is the real guarantee.
        if (Date.now() - order.updatedAt.getTime() < STALE_MS) continue;

        // ── C) Only act when funds are actually present.
        const bal = await getReceiveWalletBalance(w.address, chain);
        if (bal <= DUST) continue;
        stats.withFunds++;

        // ── D) Stage 1: retry the swap (best outcome — merchant gets paid) ──
        if ((rec.swapAttempts || 0) < MAX_SWAP_RETRIES) {
          // Optimistic-locked re-open: only if NOTHING has touched the order since our
          // snapshot (updatedAt match) AND it's in a stuck state. This can never overwrite
          // a fresh PROCESSING the live scanner just set (its updatedAt would differ).
          const reopened = await db.order.updateMany({
            where: { id: order.id, status: { in: ['EXPIRED', 'PROCESSING'] }, updatedAt: order.updatedAt },
            data: { status: 'PENDING' },
          });
          if (reopened.count === 0) continue; // someone else touched it — let them own it

          let forwardTxHash: string;
          try {
            ({ forwardTxHash } = await swapAndForward(order.id));
          } catch (swapErr) {
            const msg = (swapErr as Error).message || '';
            if (isBenignClaimCollision(msg)) continue; // live scanner grabbed it — don't burn budget
            if (msg.includes('E_ALREADY_SWEPT')) {
              // Funds already moved on-chain but we lost the forward record → needs a human.
              await flagManualReview(order.id, meta, rec, 'wallet already swept, no forward record', { chain, balance: bal });
              stats.manualReview++;
              continue;
            }
            // Genuine swap failure. swapAndForward already left the order PROCESSING; just
            // record the attempt (do NOT touch status — avoids clobbering anything).
            rec.swapAttempts = (rec.swapAttempts || 0) + 1;
            rec.lastAttemptAt = new Date().toISOString();
            rec.lastError = msg.slice(0, 300);
            await db.order.update({ where: { id: order.id }, data: { metadata: { ...meta, recovery: rec } } }).catch(err => logger.warn('non-critical async op failed (recoveryService)', { error: (err as Error)?.message }));
            stats.errors++;
            logger.warn('Auto-recovery: swap retry failed', { orderId: order.id, attempt: rec.swapAttempts, error: rec.lastError });
            continue;
          }

          // Swap SUCCEEDED — funds already forwarded to the merchant. Persist that durably
          // FIRST so a confirmOrder failure can never be mistaken for a swap failure (which
          // would re-swap and double-pay). The branch A reconciler picks up confirm failures.
          rec.lastForwardTxHash = forwardTxHash;
          rec.resolved = 'swapped';
          rec.resolvedAt = new Date().toISOString();
          await db.order.update({ where: { id: order.id }, data: { metadata: { ...meta, recovery: rec } } }).catch(err => logger.warn('non-critical async op failed (recoveryService)', { error: (err as Error)?.message }));
          if (await tryConfirm(order.id, forwardTxHash)) {
            stats.swapped++;
            logger.security('Auto-recovery: swap succeeded', { orderId: order.id, txHash: forwardTxHash, attempt: (rec.swapAttempts || 0) + 1, event: 'recovery.swap_succeeded' });
          } else {
            stats.errors++;
            logger.error('Auto-recovery: forwarded but confirmOrder failed — will reconcile next cycle', new Error('confirm failed post-forward'), { orderId: order.id, forwardTxHash });
          }
          continue;
        }

        // ── E) Stage 2/3: swap exhausted → refund known wallet, else flag manual ──
        const pastGrace = order.expiresAt ? (Date.now() - order.expiresAt.getTime() > REFUND_GRACE_MS) : true;
        if (!pastGrace) continue;

        if (isValidAddressForChain(order.customerWallet, chain)) {
          try {
            const { txHash, amount } = await refundNativeToAddress(order.id, order.customerWallet!); // at-most-once; marks REFUNDED
            if (txHash) {
              stats.refunded++;
              logger.security('Auto-recovery: refunded to customer', { orderId: order.id, dest: order.customerWallet, txHash, amount, event: 'recovery.auto_refunded' });
              const { webhookService } = await import('./webhookService');
              if (order.merchantId) {
                webhookService.sendWebhook(order.merchantId, 'order.auto_refunded', {
                  orderId: order.id, destinationAddress: order.customerWallet, txHash, amount, chain, nativeToken: order.nativeToken,
                }).catch(err => logger.warn('non-critical async op failed (recoveryService)', { error: (err as Error)?.message }));
              }
            }
          } catch (refundErr) {
            stats.errors++;
            logger.error('Auto-recovery: refund failed', refundErr as Error, { orderId: order.id });
          }
        } else {
          await flagManualReview(order.id, meta, rec, 'no valid customer wallet to refund', { balance: bal, chain, nativeToken: order.nativeToken, receiveAddress: w.address });
          stats.manualReview++;
        }
      } catch (e) {
        stats.errors++;
        logger.error('Auto-recovery: per-order error', e as Error, { orderId: order?.id, walletId: w.id });
      }
    }

    if (stats.swapped || stats.refunded || stats.reconciled || stats.manualReview || stats.errors) {
      logger.info('Auto-recovery cycle complete', { ...stats });
    }
    return stats;
  } finally {
    running = false;
  }
}
