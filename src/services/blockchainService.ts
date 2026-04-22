import { ethers } from 'ethers';
import { db } from '../config/database';
import { CHAIN_CONFIGS } from '../config/chains';
import { Chain } from '../types';
import { Decimal } from '@prisma/client/runtime/library';
import { OrderService } from './orderService';
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

// Accepts ±0.1% tolerance. Anything outside (under OR over) is rejected.
export function amountWithinTolerance(txAmount: number, orderAmount: number): boolean {
  if (orderAmount <= 0) return false;
  const diff = Math.abs(txAmount - orderAmount) / orderAmount;
  return diff <= 0.001;
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

      // Get pending orders for this chain
      const pendingOrders = await db.order.findMany({
        where: {
          chain,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        select: { id: true, paymentAddress: true, amount: true, customerWallet: true, createdAt: true, token: true },
        orderBy: { createdAt: 'desc' },
      });

      if (pendingOrders.length === 0) return 0;

      // Resilient provider — if primary RPC (often llamarpc) is Cloudflare-blocking us,
      // rotate to a public fallback. Previously we silently ate the 403 and lost real payments.
      const { getHealthyProvider } = await import('./rpcProvider');
      const provider = await getHealthyProvider(chain);
      const stables = CHAIN_STABLES[chain] || { USDC: config.usdcAddress };
      const contracts = Object.values(stables).map(addr => new ethers.Contract(addr, USDC_ABI, provider));

      const currentBlock = await provider.getBlockNumber();

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

      // Look back ~10 min on Base (300 blocks), ~2 min on Ethereum (10 blocks)
      const lookbackBlocks = Math.ceil(600 / (config.blockTimeSeconds || 2));
      const fromBlock = Math.max(0, currentBlock - lookbackBlocks);

      let matched = 0;

      for (const targetAddress of uniqueAddresses) {
        // Query ALL stablecoin contracts for transfers TO this specific address
        const allEvents: ethers.EventLog[] = [];
        for (const contract of contracts) {
          try {
            // Targeted filter: Transfer(anyone → targetAddress)
            const filter = contract.filters.Transfer(null, targetAddress);
            const events = await contract.queryFilter(filter, fromBlock, currentBlock);
            allEvents.push(...(events as ethers.EventLog[]));
          } catch (err: any) {
            // DO NOT silently swallow — this was the root cause of the UnlockRiver incident
            // on 2026-04-22: llamarpc returned 403 Cloudflare, we ate it, real payment went
            // unmatched. If it keeps failing, payments will land on the floor.
            logger.error('scanner RPC query failed', err as Error, {
              chain,
              contract: (contract as any)?.target || 'unknown',
              targetAddress,
              fromBlock,
              currentBlock,
              event: 'scanner.rpc_query_failed',
            });
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

          // Find matching pending order for this address + token contract + amount
          let matchedOrder = null;
          let matchedAmount: string | null = null;
          for (const order of pendingOrders) {
            if (order.paymentAddress.toLowerCase() !== toAddress) continue;

            // Enforce token match: the contract that emitted this Transfer MUST be the order's expected token.
            // Protects against USDT-for-USDC (or EURC-for-USDC, different currency) false positives.
            const expectedContract = (CHAIN_STABLES[chain]?.[order.token] || '').toLowerCase();
            if (!expectedContract || logContract !== expectedContract) {
              logger.warn('scanner skipped wrong-token transfer', {
                event: 'scanner.skip.wrong_token',
                orderId: order.id,
                chain,
                expectedToken: order.token,
                expectedContract,
                logContract,
                txHash,
              });
              continue;
            }

            const decimals = getTokenDecimals(chain, order.token);
            const txAmount = Number(ethers.formatUnits(log.args.value, decimals));
            const orderAmount = Number(order.amount);
            if (!amountWithinTolerance(txAmount, orderAmount)) {
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

            // If order has customerWallet, require FROM match
            if (order.customerWallet && order.customerWallet.startsWith('0x')) {
              if (fromAddress.toLowerCase() !== order.customerWallet.toLowerCase()) continue;
            }

            matchedOrder = order;
            matchedAmount = txAmount.toString();
            break;
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

      // Find transactions that are confirmed on-chain but order is still PENDING
      const pendingTxs = await db.transaction.findMany({
        where: {
          chain,
          status: 'CONFIRMED',
          order: { status: 'PENDING' },
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

        if (confirmations >= config.requiredConfirms && tx.order.status === 'PENDING') {
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
      const hasPending = await db.order.count({ where: { chain, status: 'PENDING', expiresAt: { gt: new Date() } } });
      if (hasPending > 0) {
        await timeoutPromise(this.scanForPayments(chain), 15000, `${chain} scan`).catch(e => console.error(`[scanner] ${chain} error:`, e.message));
        await this.updatePendingConfirmations(chain);
      }
    });

    await Promise.all([...evmScans, nonEvmScans]);
    await this.expireStaleOrders();
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
        await db.order.updateMany({
          where: { id: { in: stale.map(s => s.id) } },
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
        where: { chain: 'SOLANA_MAINNET', status: 'PENDING', expiresAt: { gt: new Date() } },
        select: { id: true, paymentAddress: true, amount: true, customerWallet: true, token: true },
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

              // Match against pending orders
              for (const order of orders) {
                // Token mint must match order's expected token
                const expectedMint = SOLANA_TOKEN_MINTS[order.token];
                if (!expectedMint || info.mint !== expectedMint) {
                  logger.warn('scanner skipped wrong-token SPL transfer', {
                    event: 'scanner.skip.wrong_token',
                    orderId: order.id,
                    chain: 'SOLANA_MAINNET',
                    expectedToken: order.token,
                    expectedMint,
                    actualMint: info.mint,
                    txHash,
                  });
                  continue;
                }

                const orderAmt = Number(order.amount);
                if (!amountWithinTolerance(amount, orderAmt)) {
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
                if (order.customerWallet && !order.customerWallet.startsWith('0x') && from !== order.customerWallet) continue;

                // Match! Create transaction + confirm
                await db.transaction.create({
                  data: {
                    orderId: order.id, txHash, chain: 'SOLANA_MAINNET',
                    amount, fromAddress: from, toAddress: address,
                    status: 'CONFIRMED', confirmations: 1,
                    blockTimestamp: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date(),
                  },
                });

                const { complianceService } = await import('./complianceService');
                const screening = await complianceService.screenTransaction(order.id, from);

                if (screening.riskLevel !== 'BLOCKED') {
                  await this.orderService.confirmOrder(order.id, { txHash });
                  console.log(`[scanner] ✅ Solana confirmed ${order.id} — ${amount} ${tokenName || 'SPL'}`);
                } else {
                  console.log(`[scanner] ❌ Solana BLOCKED ${order.id} — ${screening.flags.join(', ')}`);
                }
                break;
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
        where: {
          chain: 'TRON_MAINNET',
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        select: { id: true, paymentAddress: true, amount: true, customerWallet: true, token: true },
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

            // Match against pending orders
            for (const order of orders) {
              // Token must match (e.g. order for USDC should not confirm on USDT deposit)
              if (tokenName !== order.token) {
                logger.warn('scanner skipped wrong-token TRC20 transfer', {
                  event: 'scanner.skip.wrong_token',
                  orderId: order.id,
                  chain: 'TRON_MAINNET',
                  expectedToken: order.token,
                  actualToken: tokenName,
                  txHash,
                });
                continue;
              }

              const orderAmount = Number(order.amount);
              if (!amountWithinTolerance(amount, orderAmount)) {
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
              // Only enforce wallet match if it's a TRON address (starts with T)
              if (order.customerWallet && order.customerWallet.startsWith('T') && fromAddress !== order.customerWallet) continue;

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

              // Compliance screening
              const { complianceService } = await import('./complianceService');
              const screening = await complianceService.screenTransaction(order.id, fromAddress);

              if (screening.riskLevel !== 'BLOCKED') {
                await this.orderService.confirmOrder(order.id, { txHash });
                console.log(`[scanner] ✅ TRON confirmed order ${order.id} — ${amount} ${tokenName}`);
              } else {
                console.log(`[scanner] ❌ TRON BLOCKED order ${order.id} — ${screening.flags.join(', ')}`);
              }
              break;
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

    // Initial scan
    await runCycle();

    // Smart interval: 5s when pending orders exist, expire check every 6th cycle when idle
    let idleCycles = 0;
    setInterval(async () => {
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
