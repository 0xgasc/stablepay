import { ethers } from 'ethers';
import { db } from '../config/database';
import { CHAIN_CONFIGS } from '../config/chains';
import { Chain } from '../types';
import { Decimal } from '@prisma/client/runtime/library';
import { OrderService, LATE_PAYMENT_GRACE_MS } from './orderService';
import { webhookService } from './webhookService';
import { logger } from '../utils/logger';

const USDC_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)"
];

// EVM chains to scan (mainnet only)
const SCAN_CHAINS: Chain[] = [
  'BASE_MAINNET',
  'ETHEREUM_MAINNET',
  'POLYGON_MAINNET',
  'ARBITRUM_MAINNET',
  'BNB_MAINNET',
];

// All stablecoin contracts per chain (USDC + USDT + EURC where available)
export const CHAIN_STABLES: Record<string, Record<string, string>> = {
  BASE_MAINNET: { USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42' },
  ETHEREUM_MAINNET: { USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7', EURC: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c' },
  POLYGON_MAINNET: { USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' },
  ARBITRUM_MAINNET: { USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' },
  BNB_MAINNET: { USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', USDT: '0x55d398326f99059fF775485246999027B3197955' },
};

// Per-(chain, token) decimals. BNB's Binance-Peg USDC/USDT are 18; everything else we support is 6.
export const CHAIN_TOKEN_DECIMALS: Record<string, Record<string, number>> = {
  BNB_MAINNET: { USDC: 18, USDT: 18 },
};
export function getTokenDecimals(chain: string, token: string): number {
  return CHAIN_TOKEN_DECIMALS[chain]?.[token] ?? 6;
}

// Solana SPL mints keyed by token name (source of truth for mint validation)
export const SOLANA_TOKEN_MINTS: Record<string, string> = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  EURC: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr',
};

// TRON TRC-20 contracts keyed by token name
export const TRON_TOKEN_CONTRACTS: Record<string, string> = {
  USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  USDC: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8',
};

function reverseTokenLookup(chain: string, contractAddr: string): string | null {
  const stables = CHAIN_STABLES[chain];
  if (!stables) return null;
  const lower = contractAddr.toLowerCase();
  for (const [token, addr] of Object.entries(stables)) {
    if (addr.toLowerCase() === lower) return token;
  }
  return null;
}

function reverseSolanaMintLookup(mint: string): string | null {
  for (const [token, m] of Object.entries(SOLANA_TOKEN_MINTS)) {
    if (m === mint) return token;
  }
  return null;
}

// Cross-stablecoin acceptance (global policy, approved): USDC and USDT are both USD-pegged ~1:1,
// so a USD-stablecoin order accepts either interchangeably — a customer who sends USDT to a USDC
// order (or vice-versa) gets credited instead of stranded. EURC is EUR, a genuinely different
// currency/value, so it is NEVER cross-accepted (the wrong-token guard stays for it).
function isUsdStable(token: string | null | undefined): boolean {
  return token === 'USDC' || token === 'USDT';
}

// Record on the order (metadata) when it settled in a different-but-equivalent stablecoin than
// ordered, so the merchant's books reflect what actually landed in their wallet.
async function flagSettledInToken(orderId: string, expected: string, received: string, txHash: string, chain: string) {
  try {
    const existing = await db.order.findUnique({ where: { id: orderId }, select: { metadata: true } });
    const meta = (existing?.metadata as Record<string, unknown>) || {};
    await db.order.update({
      where: { id: orderId },
      data: { metadata: { ...meta, settledInToken: { expected, received, txHash, chain, at: new Date().toISOString() } } },
    });
  } catch (e) { logger.warn('flagSettledInToken failed', { orderId, error: (e as Error).message }); }
}

// One wrong-token transfer must flag AT MOST ONE order, EVER. Without this, a single stray USDT
// tx got re-matched against every new pending order at the shared address for days (observed: the
// same txHash flagged 13 times across different orders). In-memory set is the fast path; the JSON
// metadata lookup makes it durable across scanner restarts.
const flaggedWrongTokenTxs = new Set<string>();

async function flagWrongToken(orderId: string, merchantId: string | null, expected: string, received: string | null, txHash: string, chain: string) {
  try {
    if (flaggedWrongTokenTxs.has(txHash)) return;
    const alreadyFlagged = await db.order.findFirst({
      where: { metadata: { path: ['wrongTokenDetected', 'txHash'], equals: txHash } },
      select: { id: true },
    });
    if (alreadyFlagged) { flaggedWrongTokenTxs.add(txHash); return; }
    const existing = await db.order.findUnique({ where: { id: orderId }, select: { metadata: true } });
    const meta = (existing?.metadata as Record<string, unknown>) || {};
    await db.order.update({
      where: { id: orderId },
      data: {
        metadata: {
          ...meta,
          wrongTokenDetected: { expectedToken: expected, receivedToken: received, txHash, chain, detectedAt: new Date().toISOString() },
        },
      },
    });
    // Only mark deduped AFTER the durable write succeeds — adding before it would permanently
    // suppress a retry if the update threw, leaving the transfer never flagged.
    flaggedWrongTokenTxs.add(txHash);
    if (merchantId) {
      webhookService.sendWebhook(merchantId, 'order.wrong_token', {
        orderId, expectedToken: expected, receivedToken: received, txHash, chain,
      }).catch(() => {});
    }
  } catch (e) { logger.warn('flagWrongToken failed', { orderId, error: (e as Error).message }); }
}

// Scannable order set: live PENDING orders, plus EXPIRED stablecoin orders still inside the
// late-payment grace window. Exchange withdrawals routinely land after the 30-min order TTL;
// before this, the scanner dropped the order at expiry and an arriving payment sat at the
// merchant address credited to no one. Native orders are excluded (stale price snapshots —
// recoveryService owns those).
function scannableOrderWhere() {
  return {
    OR: [
      { status: 'PENDING' as const, expiresAt: { gt: new Date() } },
      { status: 'EXPIRED' as const, nativeToken: null, expiresAt: { gt: new Date(Date.now() - LATE_PAYMENT_GRACE_MS) } },
    ],
  };
}

export function amountWithinTolerance(txAmount: number, orderAmount: number, tolerance = 0.01): boolean {
  if (orderAmount <= 0) return false;
  const diff = Math.abs(txAmount - orderAmount) / orderAmount;
  return diff <= tolerance;
}

// Asymmetric acceptance.
//  • Overpayment / exact: symmetric ±1% band (wallet rounding) — unchanged.
//  • Underpayment: shortfall must be ≤ min($1.00, 3% of order) ABSOLUTE. Exchanges deduct their
//    withdrawal fee from the sent amount (observed live: 4.90 arrived for a 4.99 order — customer
//    paid, scanner skipped it, order expired). The $1 cap bounds deliberate undercutting at
//    $1/order on EVERY order size — the earlier version let the 1% band override it, so a $500
//    order could be shorted $5 unflagged. The 3% relative cap stops the $1 allowance from
//    dominating small orders.
//  • `underpaid` flags acceptances whose shortfall exceeds the 1% rounding band (fee-rule
//    acceptances) — written to metadata.underpaid so abuse patterns stay visible.
export function amountAcceptable(txAmount: number, orderAmount: number): { ok: boolean; underpaid: boolean; shortfall: number } {
  if (orderAmount <= 0) return { ok: false, underpaid: false, shortfall: 0 };
  const shortfall = Math.round((orderAmount - txAmount) * 1e6) / 1e6;
  if (shortfall <= 0) {
    return { ok: amountWithinTolerance(txAmount, orderAmount), underpaid: false, shortfall: 0 };
  }
  // Round the cap like the shortfall — 30*0.03 is 0.8999999… in IEEE754 and would make the
  // exact-boundary case (0.90 short on $30) flip on float noise.
  const cap = Math.round(Math.min(1.0, orderAmount * 0.03) * 1e6) / 1e6;
  const ok = shortfall <= cap;
  const underpaid = ok && shortfall > orderAmount * 0.01;
  return { ok, underpaid, shortfall };
}

// Record a fee-rule underpay acceptance on the order (advisory, non-blocking).
export async function flagUnderpaid(orderId: string, expected: number, received: number, txHash: string, chain: string) {
  try {
    const existing = await db.order.findUnique({ where: { id: orderId }, select: { metadata: true } });
    const meta = (existing?.metadata as Record<string, unknown>) || {};
    await db.order.update({
      where: { id: orderId },
      data: {
        metadata: {
          ...meta,
          underpaid: {
            expected, received,
            shortfall: Math.round((expected - received) * 1e6) / 1e6,
            reason: 'accepted under exchange-fee rule', txHash, chain,
            detectedAt: new Date().toISOString(),
          },
        },
      },
    });
    logger.warn('underpaid payment accepted (exchange-fee rule)', {
      orderId, expected, received, txHash, chain, event: 'scanner.underpay_accepted',
    });
  } catch (e) { logger.warn('flagUnderpaid failed', { orderId, error: (e as Error).message }); }
}

export class BlockchainService {
  private providers: Record<string, ethers.JsonRpcProvider> = {};
  private contracts: Record<string, ethers.Contract[]> = {}; // Multiple contracts per chain
  private orderService = new OrderService();

  // Solana optimization: cache ATAs per wallet (refresh every 60s)
  private solanaATACache: Map<string, { atas: string[]; fetchedAt: number }> = new Map();
  private solanaLastSig: Map<string, string> = new Map(); // Track last processed sig per wallet

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    for (const chain of SCAN_CHAINS) {
      const config = CHAIN_CONFIGS[chain];
      if (!config?.rpcUrl) continue;
      this.providers[chain] = new ethers.JsonRpcProvider(config.rpcUrl);
      // Create contract instances for ALL stablecoins on this chain
      const stables = CHAIN_STABLES[chain] || { USDC: config.usdcAddress };
      this.contracts[chain] = Object.values(stables).map(addr =>
        new ethers.Contract(addr, USDC_ABI, this.providers[chain])
      );
    }
  }

  async scanForPayments(chain: Chain): Promise<number> {
    try {
      const config = CHAIN_CONFIGS[chain];
      if (!config?.rpcUrl) {
        logger.warn('scanner skipping chain — no RPC configured', { chain, event: 'scanner.no_rpc' });
        return 0;
      }

      // Get scannable orders for this chain (PENDING + EXPIRED-within-grace stablecoin)
      const pendingOrders = await db.order.findMany({
        where: { chain, ...scannableOrderWhere() },
        select: { id: true, paymentAddress: true, amount: true, customerWallet: true, createdAt: true, token: true, merchantId: true },
        orderBy: { createdAt: 'desc' },
      });

      if (pendingOrders.length === 0) return 0;

      // Resilient provider — if primary RPC (often llamarpc) is Cloudflare-blocking us,
      // rotate to a public fallback. Previously we silently ate the 403 and lost real payments.
      const { getHealthyProvider } = await import('./rpcProvider');
      const provider = await getHealthyProvider(chain);
      const stables = CHAIN_STABLES[chain] || { USDC: config.usdcAddress };
      const contracts = Object.values(stables).map(addr => new ethers.Contract(addr, USDC_ABI, provider));

      // Use head minus a small safety margin. Different RPCs in our fallback pool can be
      // a block or two behind the one we just queried for getBlockNumber(); without the margin
      // we hit "block range extends beyond current head block" (-32602). The next tick re-scans
      // anyway, so we don't lose anything by trailing slightly.
      const headBlock = await provider.getBlockNumber();
      const currentBlock = Math.max(0, headBlock - 2);

      // Ensure chain config exists (for confirmation tracking)
      let chainConfig = await db.chainConfig.findUnique({ where: { chain } });
      if (!chainConfig) {
        chainConfig = await db.chainConfig.create({
          data: {
            chain,
            rpcUrl: config.rpcUrl,
            usdcAddress: config.usdcAddress,
            paymentAddress: config.paymentAddress || '',
            requiredConfirms: config.requiredConfirms,
            blockTimeSeconds: config.blockTimeSeconds,
            lastScannedBlock: BigInt(currentBlock),
          },
        });
      }

      // Targeted scan: query Transfer events TO each unique payment address directly
      // Since ERC20 Transfer(from, to, value) has `to` as indexed, RPC filters server-side
      // No sequential block crawling — just ask "did this wallet receive tokens recently?"
      const uniqueAddresses = [...new Set(pendingOrders.map(o => o.paymentAddress.toLowerCase()).filter(a => a.length > 0))];

      // Size the lookback window from the OLDEST still-pending order's age, not a fixed ~10 min.
      // A fixed 600s window is SHORTER than the 30-min stablecoin order TTL, so a real payment that
      // lands during an RPC outage (entire fallback pool down >10 min — the documented llamarpc
      // Cloudflare-403 mode) ages out of the window before scanning resumes and is permanently
      // missed even though the order stays PENDING. Cover the full pending lifetime + slack so a
      // payment can never age out while its order is still PENDING. Capped at ~35 min (max order
      // lifetime 30 min + slack) so the eth_getLogs range stays bounded.
      const blockTime = config.blockTimeSeconds || 2;
      const oldestCreatedAtMs = Math.min(...pendingOrders.map(o => o.createdAt.getTime()));
      const oldestAgeSeconds = (Date.now() - oldestCreatedAtMs) / 1000;
      // Always cover at least the legacy ~600s window; never exceed the capped lifetime.
      const coverSeconds = Math.min(Math.max(oldestAgeSeconds + 60, 600), 35 * 60);
      const lookbackBlocks = Math.ceil(coverSeconds / blockTime);
      const fromBlock = Math.max(0, currentBlock - lookbackBlocks);

      let matched = 0;

      for (const targetAddress of uniqueAddresses) {
        // Query ALL stablecoin contracts for transfers TO this specific address
        const allEvents: ethers.EventLog[] = [];
        for (const contract of contracts) {
          try {
            // Targeted filter: Transfer(anyone → targetAddress)
            const filter = contract.filters.Transfer(null, targetAddress);
            // Chunk the block range into provider-safe spans. The window can now span the full
            // order lifetime (up to ~35 min), which on fast chains (e.g. Arbitrum at ~0.25s/block
            // ≈ 8.4k blocks) exceeds the ~2k-block getLogs cap many public RPCs enforce. Querying
            // in chunks avoids -32602 "block range too large" — otherwise we'd trade a silent miss
            // for a hard error and lose the payment anyway.
            const MAX_GETLOGS_SPAN = 2000;
            let spanStart = fromBlock;
            while (spanStart <= currentBlock) {
              const spanEnd = Math.min(spanStart + MAX_GETLOGS_SPAN - 1, currentBlock);
              const events = await contract.queryFilter(filter, spanStart, spanEnd);
              allEvents.push(...(events as ethers.EventLog[]));
              spanStart = spanEnd + 1;
            }
          } catch (err: any) {
            // Classify by failure mode so we don't page Sentry on routine rate-limits.
            // RPC providers throttle aggressively — JSON-RPC -32005 / "rate limit" / "batch
            // triggered" / BAD_DATA from a 200 response with an embedded error are all
            // expected infrastructure events. Scanner keeps going (other contracts continue,
            // next tick retries). We log them at WARN, not ERROR — Sentry only pages on ERROR.
            //
            // Real RPC failures (TLS, timeouts, hard 5xx, no fallback healthy) STAY at error
            // because those mean a payment may actually drop on the floor, like the UnlockRiver
            // incident on 2026-04-22 with llamarpc Cloudflare 403.
            const msg = String(err?.message || err);
            const inner = String(err?.error?.message || '');
            const code = err?.error?.code ?? err?.code;
            const isRateLimit =
              /rate.?limit|too many requests|throttle|-32005|-32016|BAD_DATA/i.test(msg) ||
              /rate.?limit|too many requests|throttle/i.test(inner) ||
              err?.code === 'BAD_DATA' ||
              // batch-rate-limit leaks through as "missing response for request" with the
              // batch error embedded in the value array
              /missing response.*-32005|missing response.*rate.?limit|missing response.*batch/i.test(msg);
            // Transient: the RPC fallback rotation can land us on a node whose head is a few
            // blocks behind the head we measured pre-call. eth_getLogs then rejects -32602
            // "block range extends beyond current head". Next tick recomputes currentBlock, the
            // logs were not lost. Warn, don't page.
            const isAheadOfHead =
              code === -32602 ||
              /beyond current head|exceeds the maximum|block range/i.test(msg) ||
              /beyond current head|exceeds the maximum|block range/i.test(inner);
            // Generic upstream timeout / 5xx — retried next tick, doesn't lose data
            const isUpstreamTransient =
              code === -32002 ||
              /request timed out|gateway timeout|504|503|502|SERVER_ERROR|UNKNOWN_ERROR/i.test(msg) ||
              /request timed out|gateway timeout/i.test(inner);
            const transient = isRateLimit || isAheadOfHead || isUpstreamTransient;
            const ctx = {
              chain,
              contract: (contract as any)?.target || 'unknown',
              targetAddress,
              fromBlock,
              currentBlock,
              event: 'scanner.rpc_query_failed',
              reason: isRateLimit ? 'rate_limit' : isAheadOfHead ? 'rpc_behind_head' : isUpstreamTransient ? 'upstream_transient' : 'other',
            };
            if (transient) {
              logger.warn('scanner RPC transient (will retry next tick)', ctx);
            } else {
              logger.error('scanner RPC query failed', err as Error, ctx);
            }
          }
        }

        for (const event of allEvents) {
          const log = event as ethers.EventLog;
          if (!log.args) continue;

          const txHash = log.transactionHash;
          const logContract = (log.address || '').toLowerCase();
          const fromAddress = log.args.from;
          const toAddress = log.args.to?.toLowerCase();

          // Skip if already processed
          const existingTx = await db.transaction.findUnique({ where: { txHash } });
          if (existingTx) continue;

          // Find matching pending order for this address + token contract + amount.
          // customerWallet (the captured FROM) is a TIEBREAKER, not a hard filter: a customer who
          // connects wallet A to prove identity but pays from exchange/cold wallet B sent the
          // correct token+amount to the correct address — we must NOT drop that payment just
          // because FROM differs. Collect all (address+token+amount) candidates, then use FROM
          // only to disambiguate when MULTIPLE orders collide.
          // Actual token sent (the scanned contract that emitted this Transfer). On EVM we only scan
          // CHAIN_STABLES contracts, so this resolves to a known stable.
          const sentToken = reverseTokenLookup(chain, logContract);
          const candidates: { order: typeof pendingOrders[number]; txAmount: number; exact: boolean; underpaid: boolean }[] = [];
          // Wrong-token orders are collected here, then AT MOST ONE is flagged after the loop (the
          // amount-matched payer). Flagging inside the loop fanned one wrong-coin transfer across
          // every open order at the shared address — over-counting + firing duplicate webhooks.
          const wrongTokenOrders: (typeof pendingOrders[number])[] = [];
          for (const order of pendingOrders) {
            if (order.paymentAddress.toLowerCase() !== toAddress) continue;

            // Token must equal the order's expected stable — OR be its USD-stable counterpart
            // (USDC<->USDT ~1:1). EURC is never cross-accepted, so EURC-for-USDC still falls through
            // to the wrong-token path (different currency, real value mismatch).
            const expectedContract = (CHAIN_STABLES[chain]?.[order.token] || '').toLowerCase();
            const tokenMatches = !!expectedContract && logContract === expectedContract;
            const crossStableOk = !tokenMatches && isUsdStable(sentToken) && isUsdStable(order.token);
            if (!tokenMatches && !crossStableOk) {
              wrongTokenOrders.push(order);
              continue;
            }

            // Parse with the SENT token's decimals (correct for both exact and cross-stable matches).
            const decimals = getTokenDecimals(chain, sentToken || order.token);
            const txAmount = Number(ethers.formatUnits(log.args.value, decimals));
            const orderAmount = Number(order.amount);
            const acceptance = amountAcceptable(txAmount, orderAmount);
            if (!acceptance.ok) {
              logger.warn('scanner skipped amount outside tolerance', {
                event: txAmount > orderAmount ? 'scanner.skip.overpay' : 'scanner.skip.underpay',
                orderId: order.id,
                chain,
                orderAmount,
                txAmount,
                txHash,
              });
              continue;
            }

            candidates.push({ order, txAmount, exact: tokenMatches, underpaid: acceptance.underpaid });
          }

          // Wrong-token: flag only the single order whose amount matches this transfer (the real
          // payer), and only when nothing matched correctly. Prevents the fan-out and the spurious
          // flag on unrelated orders when a *correct* payment also landed.
          // Heuristic caveat: on a shared address with colliding amounts this advisory can attach to
          // the wrong order — acceptable because it's metadata-only (no money moves) and strictly
          // better than the old flag-every-open-order behavior.
          if (candidates.length === 0 && wrongTokenOrders.length > 0) {
            const received = reverseTokenLookup(chain, logContract);
            if (received) {
              const sentDecimals = getTokenDecimals(chain, received);
              const eventAmount = Number(ethers.formatUnits(log.args.value, sentDecimals));
              const best = wrongTokenOrders
                .map(o => ({ o, diff: Math.abs(Number(o.amount) - eventAmount) }))
                .sort((a, b) => a.diff - b.diff)[0];
              if (best && best.diff <= Math.max(0.05 * eventAmount, 0.01)) {
                logger.warn('scanner skipped wrong-token transfer', {
                  event: 'scanner.skip.wrong_token', orderId: best.o.id, chain,
                  expectedToken: best.o.token, receivedToken: received, txHash,
                });
                flagWrongToken(best.o.id, best.o.merchantId, best.o.token, received, txHash, chain);
              }
            }
          }

          // Disambiguate candidates by FROM (tiebreaker). When several pending orders collide on
          // the same (address, token, amount), prefer the one whose captured customerWallet matches
          // the actual sender; otherwise fall back to the first (preserves prior iteration order).
          let matchedOrder: typeof pendingOrders[number] | null = null;
          let matchedAmount: string | null = null;
          let senderMismatch = false;
          let matchedUnderpaid = false;
          if (candidates.length > 0) {
            const fromLower = (fromAddress || '').toLowerCase();
            // FROM-wallet is the strongest intent signal (the customer bound this order to their
            // wallet), so honor it FIRST; within the chosen tier prefer an exact-token match over a
            // cross-stable one. This avoids both crediting someone else's same-token order AND
            // overriding a payer's explicit wallet binding with a token-exactness heuristic.
            const fromCands = candidates.filter(c =>
              c.order.customerWallet && c.order.customerWallet.startsWith('0x') &&
              c.order.customerWallet.toLowerCase() === fromLower
            );
            const tier = fromCands.length > 0 ? fromCands : candidates;
            // Within the tier, the order whose amount is CLOSEST to the transfer wins — checkout
            // cent-jitter gives concurrent same-price orders unique amounts, so closeness is the
            // disambiguator. Exact-token beats cross-stable only among equally-close candidates.
            const chosen = [...tier].sort((a, b) =>
              Math.abs(a.txAmount - Number(a.order.amount)) - Math.abs(b.txAmount - Number(b.order.amount))
              || (b.exact ? 1 : 0) - (a.exact ? 1 : 0)
            )[0];
            matchedOrder = chosen.order;
            matchedAmount = chosen.txAmount.toString();
            matchedUnderpaid = chosen.underpaid;
            // Advisory flag (non-blocking): confirmed despite the sender differing from the captured wallet.
            if (chosen.order.customerWallet && chosen.order.customerWallet.startsWith('0x') &&
                chosen.order.customerWallet.toLowerCase() !== fromLower) {
              senderMismatch = true;
              logger.warn('scanner confirming FROM-mismatched payment (customerWallet is a tiebreaker, not a filter)', {
                event: 'scanner.sender_mismatch',
                orderId: chosen.order.id,
                chain,
                capturedWallet: chosen.order.customerWallet,
                actualFrom: fromAddress,
                txHash,
              });
            }
          }

          if (!matchedOrder || !matchedAmount) continue;
          const amount = matchedAmount;

          // Get block info
          const receipt = await provider.getTransactionReceipt(txHash);
          const block = await provider.getBlock(log.blockNumber);
          if (!receipt || !block) continue;

          const confirmations = currentBlock - log.blockNumber;

          // Create transaction record
          await db.transaction.create({
            data: {
              orderId: matchedOrder.id,
              txHash,
              chain,
              amount: new Decimal(amount),
              fromAddress,
              toAddress: log.args.to,
              blockNumber: BigInt(log.blockNumber),
              blockTimestamp: new Date(block.timestamp * 1000),
              status: receipt.status === 1 ? 'CONFIRMED' : 'FAILED',
              confirmations,
            },
          });

          // Compliance screening before confirmation
          if (receipt.status === 1 && confirmations >= config.requiredConfirms) {
            try {
              const { complianceService } = await import('./complianceService');
              const screening = await complianceService.screenTransaction(matchedOrder.id, fromAddress);

              if (screening.riskLevel === 'BLOCKED') {
                logger.warn('scanner blocked by compliance', {
                  event: 'scanner.compliance_blocked',
                  orderId: matchedOrder.id,
                  chain,
                  flags: screening.flags,
                  riskScore: screening.riskScore,
                });
                continue;
              }

              if (screening.riskLevel === 'HIGH') {
                logger.warn('scanner flagged high-risk payment', {
                  event: 'scanner.compliance_flagged',
                  orderId: matchedOrder.id,
                  chain,
                  flags: screening.flags,
                  riskScore: screening.riskScore,
                });
              }

              // Surface a non-blocking sender-mismatch flag for merchant compliance review when
              // we confirmed a payment whose FROM differs from the captured customerWallet.
              if (senderMismatch) {
                try {
                  const existing = await db.order.findUnique({ where: { id: matchedOrder.id }, select: { metadata: true } });
                  const meta = (existing?.metadata as Record<string, unknown>) || {};
                  await db.order.update({
                    where: { id: matchedOrder.id },
                    data: { metadata: { ...meta, senderMismatch: { capturedWallet: matchedOrder.customerWallet, actualFrom: fromAddress, txHash, chain, detectedAt: new Date().toISOString() } } },
                  });
                } catch (e) { logger.warn('failed to flag sender mismatch', { orderId: matchedOrder.id, error: (e as Error).message }); }
              }

              // Cross-stablecoin settlement: order was for one USD-stable, paid in the other (USDC<->USDT).
              if (sentToken && sentToken !== matchedOrder.token) {
                await flagSettledInToken(matchedOrder.id, matchedOrder.token, sentToken, txHash, chain);
                logger.warn('scanner cross-stable settlement', { event: 'scanner.cross_stable', orderId: matchedOrder.id, chain, expected: matchedOrder.token, received: sentToken, txHash });
              }

              // Accepted under the exchange-fee underpay rule — record the shortfall.
              if (matchedUnderpaid) {
                await flagUnderpaid(matchedOrder.id, Number(matchedOrder.amount), Number(matchedAmount), txHash, chain);
              }

              await this.orderService.confirmOrder(matchedOrder.id, {
                txHash,
                blockNumber: log.blockNumber,
                confirmations,
              });
              console.log(`[scanner] Confirmed order ${matchedOrder.id} — $${amount} on ${chain} (risk: ${screening.riskScore})`);
              matched++;
            } catch (err) {
              console.error(`[scanner] Failed to confirm order ${matchedOrder.id}:`, err);
            }
          }
        }
      }

      // Update scan position
      await db.chainConfig.update({
        where: { chain },
        data: { lastScannedBlock: BigInt(currentBlock) },
      });

      if (matched > 0) {
        console.log(`[scanner] ${chain}: ${matched} confirmed (targeted scan of ${uniqueAddresses.length} addresses)`);
      }

      return matched;
    } catch (error: any) {
      console.error(`[scanner] Error scanning ${chain}:`, error.message);
      return 0;
    }
  }

  async updatePendingConfirmations(chain: Chain): Promise<void> {
    try {
      const provider = this.providers[chain];
      if (!provider) return;

      const config = CHAIN_CONFIGS[chain];
      const currentBlock = await provider.getBlockNumber();

      // Find transactions confirmed on-chain whose order is still PENDING — or EXPIRED within
      // the late-payment grace window. Without the EXPIRED arm, an EVM payment detected with too
      // few confirmations gets its tx record created, the order expires while awaiting finality,
      // and nothing ever promotes it (the txHash dedup blocks rescans) — funds at the merchant,
      // order stuck EXPIRED forever.
      const pendingTxs = await db.transaction.findMany({
        where: {
          chain,
          status: 'CONFIRMED',
          order: { ...scannableOrderWhere() },
        },
        include: { order: true },
      });

      for (const tx of pendingTxs) {
        if (!tx.blockNumber) continue;

        const confirmations = currentBlock - Number(tx.blockNumber);

        await db.transaction.update({
          where: { id: tx.id },
          data: { confirmations },
        });

        if (confirmations >= config.requiredConfirms && (tx.order.status === 'PENDING' || tx.order.status === 'EXPIRED')) {
          try {
            await this.orderService.confirmOrder(tx.orderId, {
              txHash: tx.txHash,
              blockNumber: Number(tx.blockNumber),
              confirmations,
            });
            console.log(`[scanner] ✅ Late-confirmed order ${tx.orderId} (${confirmations} confirmations)`);
          } catch (err) {
            console.error(`[scanner] Failed late-confirm ${tx.orderId}:`, err);
          }
        }
      }
    } catch (error: any) {
      console.error(`[scanner] Error updating confirmations ${chain}:`, error.message);
    }
  }

  async scanAll(): Promise<void> {
    console.log('[scanner] scanAll starting...');

    // Global timeout wrapper — kill if any scan hangs
    const timeoutPromise = (p: Promise<any>, ms: number, label: string) =>
      Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms))]);

    // Run Solana + TRON in parallel with EVM (don't let EVM block them)
    const nonEvmScans = Promise.all([
      timeoutPromise(this.scanSolanaPayments(), 20000, 'Solana scan').catch(e => console.error('[scanner] Solana error:', e.message)),
      timeoutPromise(this.scanTronPayments(), 15000, 'TRON scan').catch(e => console.error('[scanner] TRON error:', e.message)),
    ]);

    // EVM chains — scan in parallel, skip chains with no pending orders
    const evmScans = SCAN_CHAINS.map(async (chain) => {
      const hasPending = await db.order.count({ where: { chain, ...scannableOrderWhere() } });
      if (hasPending > 0) {
        await timeoutPromise(this.scanForPayments(chain), 15000, `${chain} scan`).catch(e => console.error(`[scanner] ${chain} error:`, e.message));
        await this.updatePendingConfirmations(chain);
      }
    });

    await Promise.all([...evmScans, nonEvmScans]);
    await timeoutPromise(this.scanNativeTokenOrders(), 30000, 'native token scan')
      .catch(e => console.error('[scanner] native token scan error:', (e as Error).message));
    await this.expireStaleOrders();
  }

  async scanNativeTokenOrders(): Promise<void> {
    // ── EVM native (ETH / BNB / MATIC / ARB) ──────────────────────────────
    const evmNative = await db.order.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        nativeToken: { not: null },
        chain: { in: ['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'BNB_MAINNET'] as any[] },
      },
      select: { id: true, paymentAddress: true, amount: true, nativeToken: true, nativePriceSnapshot: true, conversionFeeAmount: true, chain: true },
    });

    for (const order of evmNative) {
      try {
        const { getHealthyProvider } = await import('./rpcProvider');
        const provider  = await getHealthyProvider(order.chain);
        const balWei    = await provider.getBalance(order.paymentAddress);
        const received  = Number(ethers.formatEther(balWei));
        if (received < 0.000001) continue;

        const price    = Number(order.nativePriceSnapshot ?? 0);
        const fee      = Number(order.conversionFeeAmount ?? 0);
        if (price === 0) continue;
        const expected = (Number(order.amount) + fee) / price;
        if (Math.abs(received - expected) / expected > 0.03) continue; // ±3% tolerance

        console.log(`[scanner] native ${order.nativeToken} payment detected for order ${order.id}, triggering swap`);
        await db.order.update({ where: { id: order.id }, data: { nativeTokenAmount: received } });

        const { swapAndForward } = await import('./swapService');
        let forwardTxHash = '';
        try {
          ({ forwardTxHash } = await swapAndForward(order.id));
        } catch (swapErr: any) {
          console.error(`[scanner] native EVM swap failed for order ${order.id}:`, swapErr.message);
          // Re-expose to the next scan ONLY if nothing was forwarded. Never revert a PAID order
          // (swap succeeded but confirm threw) — that would re-swap and double-pay the merchant.
          if (!swapErr.message.includes('already processing')) {
            await db.order.updateMany({ where: { id: order.id, status: 'PROCESSING' }, data: { status: 'PENDING' } });
          }
          continue;
        }
        // Forward SUCCEEDED — merchant paid. Persist the durable success marker BEFORE confirming so
        // a confirm failure can never revert/re-swap (auto-recovery reconciles via lastForwardTxHash).
        try {
          const o = await db.order.findUnique({ where: { id: order.id }, select: { metadata: true } });
          const m: any = (o?.metadata && typeof o.metadata === 'object') ? { ...(o.metadata as any) } : {};
          m.recovery = { ...(m.recovery || {}), lastForwardTxHash: forwardTxHash, resolved: 'swapped', resolvedAt: new Date().toISOString() };
          await db.order.update({ where: { id: order.id }, data: { metadata: m } });
        } catch { /* metadata best-effort */ }
        try {
          await this.orderService.confirmOrder(order.id, { txHash: forwardTxHash });
        } catch (confirmErr: any) {
          console.error(`[scanner] native EVM forwarded but confirm failed for order ${order.id} — will reconcile:`, confirmErr.message);
        }
      } catch (err: any) {
        console.error(`[scanner] native EVM scan error for order ${order.id}:`, err.message);
      }
    }

    // ── Solana native (SOL) ────────────────────────────────────────────────
    const solNative = await db.order.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        nativeToken: 'SOL',
        chain: 'SOLANA_MAINNET' as any,
      },
      select: { id: true, paymentAddress: true, amount: true, nativePriceSnapshot: true, conversionFeeAmount: true },
    });

    if (solNative.length === 0) return;

    const { Connection, PublicKey } = await import('@solana/web3.js');
    const conn = new Connection(process.env.SOLANA_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');

    for (const order of solNative) {
      try {
        const lamports = await conn.getBalance(new PublicKey(order.paymentAddress));
        const received = lamports / 1e9;
        if (received < 0.00001) continue;

        const price    = Number(order.nativePriceSnapshot ?? 0);
        const fee      = Number(order.conversionFeeAmount ?? 0);
        if (price === 0) continue;
        const expected = (Number(order.amount) + fee) / price;
        if (Math.abs(received - expected) / expected > 0.03) continue;

        console.log(`[scanner] native SOL payment detected for order ${order.id}, triggering swap`);
        await db.order.update({ where: { id: order.id }, data: { nativeTokenAmount: received } });

        const { swapAndForward } = await import('./swapService');
        let forwardTxHash = '';
        try {
          ({ forwardTxHash } = await swapAndForward(order.id));
        } catch (swapErr: any) {
          console.error(`[scanner] native SOL swap failed for order ${order.id}:`, swapErr.message);
          // Re-expose only if nothing was forwarded. Never revert a PAID order (double-pay).
          if (!swapErr.message.includes('already processing')) {
            await db.order.updateMany({ where: { id: order.id, status: 'PROCESSING' }, data: { status: 'PENDING' } });
          }
          continue;
        }
        // Forward SUCCEEDED — persist the success marker BEFORE confirming so a confirm failure
        // can never revert/re-swap (auto-recovery reconciles via lastForwardTxHash).
        try {
          const o = await db.order.findUnique({ where: { id: order.id }, select: { metadata: true } });
          const m: any = (o?.metadata && typeof o.metadata === 'object') ? { ...(o.metadata as any) } : {};
          m.recovery = { ...(m.recovery || {}), lastForwardTxHash: forwardTxHash, resolved: 'swapped', resolvedAt: new Date().toISOString() };
          await db.order.update({ where: { id: order.id }, data: { metadata: m } });
        } catch { /* metadata best-effort */ }
        try {
          await this.orderService.confirmOrder(order.id, { txHash: forwardTxHash });
        } catch (confirmErr: any) {
          console.error(`[scanner] native SOL forwarded but confirm failed for order ${order.id} — will reconcile:`, confirmErr.message);
        }
      } catch (err: any) {
        console.error(`[scanner] native SOL scan error for order ${order.id}:`, err.message);
      }
    }
  }

  private async expireStaleOrders(): Promise<void> {
    try {
      const stale = await db.order.findMany({
        where: { status: 'PENDING', expiresAt: { lt: new Date() } },
        select: { id: true },
        take: 50,
      });
      if (stale.length > 0) {
        const now = new Date();
        // status re-filter is load-bearing: between findMany and here the scanner can CONFIRM one
        // of these orders — without it the sweep clobbers CONFIRMED→EXPIRED, and the grace arm in
        // confirmOrder would then let it re-confirm (double fees, duplicate webhooks).
        await db.order.updateMany({
          where: { id: { in: stale.map(s => s.id) }, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
        console.log(`[scanner] Expired ${stale.length} stale orders`);
      }
    } catch (err: any) {
      console.error('[scanner] Order expiry error:', err.message);
    }
  }

  async scanSolanaPayments(): Promise<void> {
    const startTime = Date.now();
    console.log('[scanner] Solana scan starting...');
    try {
      const pendingOrders = await db.order.findMany({
        where: { chain: 'SOLANA_MAINNET', ...scannableOrderWhere() },
        select: { id: true, paymentAddress: true, amount: true, customerWallet: true, token: true, merchantId: true },
        orderBy: { createdAt: 'desc' },
      });

      if (pendingOrders.length === 0) {
        console.log('[scanner] Solana: no pending orders');
        return;
      }
      console.log(`[scanner] Solana: ${pendingOrders.length} pending order(s)`);

      // Mint → token name (for display/lookup only — authoritative validation uses SOLANA_TOKEN_MINTS reverse)
      const TOKEN_MINTS: Record<string, string> = Object.fromEntries(
        Object.entries(SOLANA_TOKEN_MINTS).map(([name, mint]) => [mint, name])
      );

      // Group by payment address
      const addressMap = new Map<string, typeof pendingOrders>();
      for (const order of pendingOrders) {
        const existing = addressMap.get(order.paymentAddress) || [];
        existing.push(order);
        addressMap.set(order.paymentAddress, existing);
      }

      const solRpc = process.env.SOLANA_MAINNET_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';

      for (const [address, orders] of addressMap) {
        try {
          // Step 1: Get ATAs (cached for 60s to save RPC calls)
          const cached = this.solanaATACache.get(address);
          let tokenAccounts: string[];
          if (cached && Date.now() - cached.fetchedAt < 60000) {
            tokenAccounts = cached.atas;
          } else {
            const ataRes = await fetch(solRpc, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0', id: 1,
                method: 'getTokenAccountsByOwner',
                params: [address, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]
              }),
              signal: AbortSignal.timeout(8000),
            });
            const ataData: any = await ataRes.json();
            tokenAccounts = (ataData.result?.value || []).map((a: any) => a.pubkey).filter(Boolean);
            this.solanaATACache.set(address, { atas: tokenAccounts, fetchedAt: Date.now() });
          }

          // Step 2: Get signatures — always include owner wallet (ATAs may be created mid-cache),
          // plus every known ATA. Fetch up to 100 sigs per address (was 25).
          const addressesToScan = Array.from(new Set([address, ...tokenAccounts]));
          const allSigs: any[] = [];
          for (const addr of addressesToScan) {
            try {
              const sigRes = await fetch(solRpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jsonrpc: '2.0', id: 2,
                  method: 'getSignaturesForAddress',
                  params: [addr, { limit: 100 }]
                }),
                signal: AbortSignal.timeout(8000),
              });
              const sigData: any = await sigRes.json();
              allSigs.push(...(sigData.result || []));
            } catch { /* skip failed ATA */ }
          }

          // Deduplicate
          const seen = new Set<string>();
          const signatures = allSigs.filter(s => { if (seen.has(s.signature)) return false; seen.add(s.signature); return true; });
          console.log(`[scanner] Solana: ${signatures.length} sigs (${tokenAccounts.length} ATAs) for ${address.slice(0, 8)}...`);

          let skipped = 0, checked = 0;
          for (const sigInfo of signatures) {
            if (sigInfo.err) continue;
            const txHash = sigInfo.signature;

            // Skip if already processed
            const existingTx = await db.transaction.findUnique({ where: { txHash } });
            if (existingTx) { skipped++; continue; }
            checked++;

            // Get parsed transaction via RPC
            const txRes = await fetch(solRpc, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0', id: 2,
                method: 'getTransaction',
                params: [txHash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
              }),
              signal: AbortSignal.timeout(8000),
            });
            const txData: any = await txRes.json();
            const tx = txData.result;
            if (!tx || tx.meta?.err) continue;

            // Extract all instructions (top-level + inner)
            const allIx: any[] = [
              ...(tx.transaction?.message?.instructions || []),
              ...(tx.meta?.innerInstructions?.flatMap((inner: any) => inner.instructions) || []),
            ];

            // Build token account → owner map
            const owners: Record<string, string> = {};
            for (const ix of allIx) {
              if (ix.parsed?.type === 'initializeAccount3' && ix.program === 'spl-token') {
                owners[ix.parsed.info.account] = ix.parsed.info.owner;
              }
            }

            // Find SPL token transfers
            for (const ix of allIx) {
              if (!ix.parsed || ix.program !== 'spl-token') continue;
              if (ix.parsed.type !== 'transferChecked' && ix.parsed.type !== 'transfer') continue;

              const info = ix.parsed.info;
              // `transfer` (legacy) has no mint field — we cannot validate token identity, so skip it.
              // All modern wallets/DEXes emit `transferChecked`. Rejecting legacy is safer than guessing.
              if (!info.mint) {
                logger.warn('scanner skipped legacy SPL transfer (no mint)', {
                  event: 'scanner.skip.spl_unchecked',
                  chain: 'SOLANA_MAINNET',
                  txHash,
                });
                continue;
              }
              const tokenName = TOKEN_MINTS[info.mint] || null;

              const amount = parseFloat(info.tokenAmount?.uiAmountString || '0');
              const from = info.authority || info.multisigAuthority || info.signers?.[0] || '';
              if (!from) continue;

              // Resolve destination — check if it's the wallet OR one of its ATAs
              const dest = info.destination;
              const destOwner = owners[dest] || dest;
              const isOurWallet = destOwner === address || dest === address || tokenAccounts.includes(dest);
              if (!isOurWallet) continue;

              // Match against pending orders. Collect every order matching token+amount first;
              // customerWallet (captured FROM) is a TIEBREAKER, not a hard filter — a payment from
              // a different wallet than the one the customer connected is still valid and must not
              // be dropped. FROM is used only to disambiguate colliding orders.
              // Actual token sent (USDC/USDT/EURC) or null for junk/unrecognized SPL.
              const sentTok = reverseSolanaMintLookup(info.mint);
              const solCandidates: typeof orders = [];
              const wrongTokenOrders: typeof orders = [];
              for (const order of orders) {
                // Mint must equal the order's expected token — OR be its USD-stable counterpart
                // (USDC<->USDT ~1:1). EURC is never cross-accepted.
                const expectedMint = SOLANA_TOKEN_MINTS[order.token];
                const mintMatches = !!expectedMint && info.mint === expectedMint;
                const crossStableOk = !mintMatches && isUsdStable(sentTok) && isUsdStable(order.token);
                if (!mintMatches && !crossStableOk) {
                  wrongTokenOrders.push(order);
                  continue;
                }

                const orderAmt = Number(order.amount);
                if (!amountAcceptable(amount, orderAmt).ok) {
                  logger.warn('scanner skipped amount outside tolerance', {
                    event: amount > orderAmt ? 'scanner.skip.overpay' : 'scanner.skip.underpay',
                    orderId: order.id,
                    chain: 'SOLANA_MAINNET',
                    orderAmount: orderAmt,
                    txAmount: amount,
                    txHash,
                  });
                  continue;
                }
                solCandidates.push(order);
              }

              // Wrong-token: flag only the amount-matched order, once, and only when nothing matched
              // correctly. Junk/airdrop SPL with an unrecognized mint is ignored (reverse lookup null).
              if (solCandidates.length === 0 && wrongTokenOrders.length > 0) {
                const receivedTok = sentTok;
                if (receivedTok) {
                  const best = wrongTokenOrders
                    .map(o => ({ o, diff: Math.abs(Number(o.amount) - amount) }))
                    .sort((a, b) => a.diff - b.diff)[0];
                  if (best && best.diff <= Math.max(0.05 * amount, 0.01)) {
                    logger.warn('scanner skipped wrong-token SPL transfer', {
                      event: 'scanner.skip.wrong_token', orderId: best.o.id, chain: 'SOLANA_MAINNET',
                      expectedToken: best.o.token, actualMint: info.mint, receivedToken: receivedTok, txHash,
                    });
                    flagWrongToken(best.o.id, best.o.merchantId, best.o.token, receivedTok, txHash, 'SOLANA_MAINNET');
                  }
                }
              }

              if (solCandidates.length > 0) {
                // FROM-wallet (explicit binding) wins first; within that tier prefer an exact-token
                // match over a cross-stable one, else the first.
                const fromCands = solCandidates.filter(o => o.customerWallet && o.customerWallet === from);
                const tier = fromCands.length > 0 ? fromCands : solCandidates;
                // Closest order amount wins (cent-jitter disambiguates same-price collisions);
                // exact-token beats cross-stable only among equally-close candidates.
                const order = [...tier].sort((a, b) =>
                  Math.abs(amount - Number(a.amount)) - Math.abs(amount - Number(b.amount))
                  || ((b.token === sentTok ? 1 : 0) - (a.token === sentTok ? 1 : 0))
                )[0];
                const senderMismatch = !!(order.customerWallet && order.customerWallet !== from);
                if (senderMismatch) {
                  logger.warn('scanner confirming FROM-mismatched payment (customerWallet is a tiebreaker, not a filter)', {
                    event: 'scanner.sender_mismatch',
                    orderId: order.id,
                    chain: 'SOLANA_MAINNET',
                    capturedWallet: order.customerWallet,
                    actualFrom: from,
                    txHash,
                  });
                }

                // Match! Create transaction + confirm
                await db.transaction.create({
                  data: {
                    orderId: order.id, txHash, chain: 'SOLANA_MAINNET',
                    amount, fromAddress: from, toAddress: address,
                    status: 'CONFIRMED', confirmations: 1,
                    blockTimestamp: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date(),
                  },
                });

                if (senderMismatch) {
                  try {
                    const existing = await db.order.findUnique({ where: { id: order.id }, select: { metadata: true } });
                    const meta = (existing?.metadata as Record<string, unknown>) || {};
                    await db.order.update({
                      where: { id: order.id },
                      data: { metadata: { ...meta, senderMismatch: { capturedWallet: order.customerWallet, actualFrom: from, txHash, chain: 'SOLANA_MAINNET', detectedAt: new Date().toISOString() } } },
                    });
                  } catch (e) { logger.warn('failed to flag sender mismatch', { orderId: order.id, error: (e as Error).message }); }
                }

                const { complianceService } = await import('./complianceService');
                const screening = await complianceService.screenTransaction(order.id, from);

                if (screening.riskLevel !== 'BLOCKED') {
                  // Cross-stablecoin settlement: order was for one USD-stable, paid in the other (USDC<->USDT).
                  if (sentTok && sentTok !== order.token) {
                    await flagSettledInToken(order.id, order.token, sentTok, txHash, 'SOLANA_MAINNET');
                    logger.warn('scanner cross-stable settlement', { event: 'scanner.cross_stable', orderId: order.id, chain: 'SOLANA_MAINNET', expected: order.token, received: sentTok, txHash });
                  }
                  // Accepted under the exchange-fee underpay rule — record the shortfall.
                  if (amountAcceptable(amount, Number(order.amount)).underpaid) {
                    await flagUnderpaid(order.id, Number(order.amount), amount, txHash, 'SOLANA_MAINNET');
                  }
                  await this.orderService.confirmOrder(order.id, { txHash });
                  console.log(`[scanner] ✅ Solana confirmed ${order.id} — ${amount} ${tokenName || 'SPL'}`);
                } else {
                  console.log(`[scanner] ❌ Solana BLOCKED ${order.id} — ${screening.flags.join(', ')}`);
                }
              }
            }
          }
          if (checked > 0 || skipped < signatures.length) {
            console.log(`[scanner] Solana ${address.slice(0, 8)}: ${checked} new, ${skipped} known`);
          }
        } catch (err: any) {
          console.error(`[scanner] Solana error for ${address.slice(0, 8)}:`, err.message);
        }
      }
      console.log(`[scanner] Solana scan done in ${Date.now() - startTime}ms`);
    } catch (error: any) {
      console.error('[scanner] Solana scan cycle error:', error.message);
    }
  }

  async scanTronPayments(): Promise<void> {
    try {
      const pendingOrders = await db.order.findMany({
        where: { chain: 'TRON_MAINNET', ...scannableOrderWhere() },
        select: { id: true, paymentAddress: true, amount: true, customerWallet: true, token: true, merchantId: true },
        orderBy: { createdAt: 'desc' },
      });

      if (pendingOrders.length === 0) return;

      // Contract address → token name (derived from TRON_TOKEN_CONTRACTS so there's one source of truth)
      const TOKEN_CONTRACTS: Record<string, string> = Object.fromEntries(
        Object.entries(TRON_TOKEN_CONTRACTS).map(([name, addr]) => [addr, name])
      );

      // Group by payment address
      const addressMap = new Map<string, typeof pendingOrders>();
      for (const order of pendingOrders) {
        const existing = addressMap.get(order.paymentAddress) || [];
        existing.push(order);
        addressMap.set(order.paymentAddress, existing);
      }

      for (const [address, orders] of addressMap) {
        try {
          // Query TronGrid for TRC-20 incoming transfers
          const apiKey = process.env.TRONGRID_API_KEY || '';
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;

          const url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?only_confirmed=true&only_to=true&limit=50`;
          const res = await fetch(url, { headers });
          const data = await res.json() as any;

          if (!data.data) continue;

          for (const tx of data.data) {
            const txHash = tx.transaction_id;
            const tokenAddr = tx.token_info?.address;
            const tokenName = TOKEN_CONTRACTS[tokenAddr];
            if (!tokenName) continue;

            // Skip if already processed
            const existing = await db.transaction.findUnique({ where: { txHash } });
            if (existing) continue;

            const amount = parseFloat(tx.value) / 1e6; // TRC-20 stables are 6 decimals
            const fromAddress = tx.from;

            // Match against pending orders. Collect every order matching token+amount first;
            // customerWallet (captured FROM) is a TIEBREAKER, not a hard filter — a payment from a
            // different wallet than the one captured is still valid and must not be dropped. FROM
            // is used only to disambiguate colliding orders.
            const tronCandidates: typeof orders = [];
            const wrongTokenOrders: typeof orders = [];
            for (const order of orders) {
              // Token must equal the order's expected stable — OR be its USD-stable counterpart
              // (USDC<->USDT ~1:1). EURC is never cross-accepted.
              const tokenMatches = tokenName === order.token;
              const crossStableOk = !tokenMatches && isUsdStable(tokenName) && isUsdStable(order.token);
              if (!tokenMatches && !crossStableOk) {
                wrongTokenOrders.push(order);
                continue;
              }

              const orderAmount = Number(order.amount);
              if (!amountAcceptable(amount, orderAmount).ok) {
                logger.warn('scanner skipped amount outside tolerance', {
                  event: amount > orderAmount ? 'scanner.skip.overpay' : 'scanner.skip.underpay',
                  orderId: order.id,
                  chain: 'TRON_MAINNET',
                  orderAmount,
                  txAmount: amount,
                  txHash,
                });
                continue;
              }
              tronCandidates.push(order);
            }

            // Wrong-token: flag only the amount-matched order, once, and only when nothing matched right.
            if (tronCandidates.length === 0 && wrongTokenOrders.length > 0) {
              const best = wrongTokenOrders
                .map(o => ({ o, diff: Math.abs(Number(o.amount) - amount) }))
                .sort((a, b) => a.diff - b.diff)[0];
              if (best && best.diff <= Math.max(0.05 * amount, 0.01)) {
                logger.warn('scanner skipped wrong-token TRC20 transfer', {
                  event: 'scanner.skip.wrong_token', orderId: best.o.id, chain: 'TRON_MAINNET',
                  expectedToken: best.o.token, actualToken: tokenName, txHash,
                });
                flagWrongToken(best.o.id, best.o.merchantId, best.o.token, tokenName, txHash, 'TRON_MAINNET');
              }
            }

            if (tronCandidates.length > 0) {
              // FROM-wallet (explicit binding) wins first; within that tier prefer an exact-token
              // match over a cross-stable one, else the first.
              const fromCands = tronCandidates.filter(o => o.customerWallet && o.customerWallet === fromAddress);
              const tier = fromCands.length > 0 ? fromCands : tronCandidates;
              // Closest order amount wins (cent-jitter disambiguates same-price collisions);
              // exact-token beats cross-stable only among equally-close candidates.
              const order = [...tier].sort((a, b) =>
                Math.abs(amount - Number(a.amount)) - Math.abs(amount - Number(b.amount))
                || ((b.token === tokenName ? 1 : 0) - (a.token === tokenName ? 1 : 0))
              )[0];
              const senderMismatch = !!(order.customerWallet && order.customerWallet !== fromAddress);
              if (senderMismatch) {
                logger.warn('scanner confirming FROM-mismatched payment (customerWallet is a tiebreaker, not a filter)', {
                  event: 'scanner.sender_mismatch',
                  orderId: order.id,
                  chain: 'TRON_MAINNET',
                  capturedWallet: order.customerWallet,
                  actualFrom: fromAddress,
                  txHash,
                });
              }

              // Match found
              await db.transaction.create({
                data: {
                  orderId: order.id,
                  txHash,
                  chain: 'TRON_MAINNET',
                  amount,
                  fromAddress,
                  toAddress: address,
                  status: 'CONFIRMED',
                  confirmations: 1,
                  blockTimestamp: new Date(tx.block_timestamp),
                },
              });

              if (senderMismatch) {
                try {
                  const existing = await db.order.findUnique({ where: { id: order.id }, select: { metadata: true } });
                  const meta = (existing?.metadata as Record<string, unknown>) || {};
                  await db.order.update({
                    where: { id: order.id },
                    data: { metadata: { ...meta, senderMismatch: { capturedWallet: order.customerWallet, actualFrom: fromAddress, txHash, chain: 'TRON_MAINNET', detectedAt: new Date().toISOString() } } },
                  });
                } catch (e) { logger.warn('failed to flag sender mismatch', { orderId: order.id, error: (e as Error).message }); }
              }

              // Compliance screening
              const { complianceService } = await import('./complianceService');
              const screening = await complianceService.screenTransaction(order.id, fromAddress);

              if (screening.riskLevel !== 'BLOCKED') {
                // Cross-stablecoin settlement: order was for one USD-stable, paid in the other (USDC<->USDT).
                if (tokenName && tokenName !== order.token) {
                  await flagSettledInToken(order.id, order.token, tokenName, txHash, 'TRON_MAINNET');
                  logger.warn('scanner cross-stable settlement', { event: 'scanner.cross_stable', orderId: order.id, chain: 'TRON_MAINNET', expected: order.token, received: tokenName, txHash });
                }
                // Accepted under the exchange-fee underpay rule — record the shortfall.
                if (amountAcceptable(amount, Number(order.amount)).underpaid) {
                  await flagUnderpaid(order.id, Number(order.amount), amount, txHash, 'TRON_MAINNET');
                }
                await this.orderService.confirmOrder(order.id, { txHash });
                console.log(`[scanner] ✅ TRON confirmed order ${order.id} — ${amount} ${tokenName}`);
              } else {
                console.log(`[scanner] ❌ TRON BLOCKED order ${order.id} — ${screening.flags.join(', ')}`);
              }
            }
          }
        } catch (err: any) {
          console.error(`[scanner] TRON scan error for ${address}:`, err.message);
        }
      }
    } catch (error: any) {
      console.error('[scanner] TRON scan cycle error:', error.message);
    }
  }

  private scanning = false;
  private lastPendingCount = 0;

  async startScanning(intervalMs = 15000): Promise<void> {
    console.log(`[scanner] Starting smart scanner — sleeps when idle, wakes on pending orders`);

    // Scanner heartbeat — written to system_config every cycle (idle or active) so the health
    // endpoint can prove "scanner is alive" without depending on webhook activity. Previously
    // the health check inferred liveness from "recent webhook log or order update" which
    // false-flags during quiet periods.
    const writeHeartbeat = async () => {
      const now = new Date().toISOString();
      try {
        await db.systemConfig.upsert({
          where: { key: 'scanner_heartbeat_at' },
          update: { value: now },
          create: { key: 'scanner_heartbeat_at', value: now },
        });
      } catch { /* best-effort, never break the scanner */ }
    };

    const runCycle = async () => {
      if (this.scanning) return;
      this.scanning = true;
      try {
        // Check how many pending orders exist
        const pendingCount = await db.order.count({
          where: { status: 'PENDING', expiresAt: { gt: new Date() } }
        });

        if (pendingCount === 0) {
          // No pending orders — just expire stale ones and sleep
          await this.expireStaleOrders();
          if (this.lastPendingCount > 0) {
            console.log('[scanner] No pending orders — sleeping');
          }
          this.lastPendingCount = 0;
          return;
        }

        if (this.lastPendingCount === 0) {
          console.log(`[scanner] Waking up — ${pendingCount} pending order(s)`);
        }
        this.lastPendingCount = pendingCount;

        await this.scanAll();
      } catch (error: any) {
        console.error('[scanner] Scan cycle error:', error.message);
      } finally {
        this.scanning = false;
      }
    };

    // Initial heartbeat + scan
    await writeHeartbeat();
    await runCycle();

    // Smart interval: 5s when pending orders exist, expire check every 6th cycle when idle.
    // Heartbeat fires EVERY tick regardless of pending state — the health endpoint needs to
    // see liveness during idle periods, not just when payments are flowing.
    let idleCycles = 0;
    setInterval(async () => {
      await writeHeartbeat();

      const hasPending = await db.order.count({
        where: { status: 'PENDING', expiresAt: { gt: new Date() } }
      }).catch(() => 0);

      if (hasPending > 0) {
        idleCycles = 0;
        await runCycle();
      } else {
        idleCycles++;
        if (idleCycles % 6 === 0) { // Every 30s when idle (6 × 5s)
          await this.expireStaleOrders().catch(() => {});
        }
      }
    }, 5000);
  }
}
