import { ethers } from 'ethers';
import { db } from '../config/database';
import { CHAIN_CONFIGS } from '../config/chains';
import { Chain } from '../types';
import { Decimal } from '@prisma/client/runtime/library';
import { OrderService } from './orderService';

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

export class BlockchainService {
  private providers: Record<string, ethers.JsonRpcProvider> = {};
  private contracts: Record<string, ethers.Contract> = {};
  private orderService = new OrderService();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    for (const chain of SCAN_CHAINS) {
      const config = CHAIN_CONFIGS[chain];
      if (!config?.rpcUrl) continue;
      this.providers[chain] = new ethers.JsonRpcProvider(config.rpcUrl);
      this.contracts[chain] = new ethers.Contract(
        config.usdcAddress,
        USDC_ABI,
        this.providers[chain]
      );
    }
  }

  async scanForPayments(chain: Chain): Promise<number> {
    try {
      const provider = this.providers[chain];
      const contract = this.contracts[chain];
      const config = CHAIN_CONFIGS[chain];

      if (!provider || !contract) {
        console.log(`[scanner] Skipping ${chain} — no provider configured`);
        return 0;
      }

      // Get pending orders for this chain — these are the addresses we're watching
      const pendingOrders = await db.order.findMany({
        where: {
          chain,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        select: { id: true, paymentAddress: true, amount: true, customerWallet: true },
        orderBy: { createdAt: 'desc' }, // Most recent first — avoids matching stale orders
      });

      if (pendingOrders.length === 0) return 0;

      // Build set of addresses we're watching
      const watchAddresses = new Set(
        pendingOrders.map(o => o.paymentAddress.toLowerCase())
      );

      const currentBlock = await provider.getBlockNumber();

      // Get or create chain scan state
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
            lastScannedBlock: BigInt(currentBlock - 100), // Start 100 blocks back
          },
        });
      }

      const fromBlock = Number(chainConfig.lastScannedBlock);
      const toBlock = Math.min(fromBlock + 50, currentBlock); // Scan 50 blocks max per cycle (keeps scan fast)

      if (fromBlock >= toBlock) return 0;

      // Query ALL USDC Transfer events (no TO filter)
      const filter = contract.filters.Transfer();
      const events = await contract.queryFilter(filter, fromBlock, toBlock);

      let matched = 0;

      for (const event of events) {
        const log = event as ethers.EventLog;
        if (!log.args) continue;

        const toAddress = log.args.to?.toLowerCase();

        // Only process transfers TO our watched addresses
        if (!toAddress || !watchAddresses.has(toAddress)) continue;

        const txHash = log.transactionHash;
        // BNB stablecoins use 18 decimals, all others use 6
        const decimals = chain === 'BNB_MAINNET' ? 18 : 6;
        const amount = ethers.formatUnits(log.args.value, decimals);
        const fromAddress = log.args.from;

        // Skip if we already processed this tx
        const existingTx = await db.transaction.findUnique({ where: { txHash } });
        if (existingTx) continue;

        // Find matching pending order (FROM + TO + amount for precision)
        let matchedOrder = null;
        for (const order of pendingOrders) {
          if (order.paymentAddress.toLowerCase() !== toAddress) continue;
          const orderAmount = Number(order.amount);
          const txAmount = Number(amount);
          // Must be within 2% AND at least 95% of order amount
          if (txAmount < orderAmount * 0.999 || (orderAmount > 0 && Math.abs(txAmount - orderAmount) / orderAmount > 0.001)) continue;

          // If order has customerWallet AND it's a valid EVM address, require FROM match
          if (order.customerWallet && order.customerWallet.startsWith('0x')) {
            if (fromAddress.toLowerCase() !== order.customerWallet.toLowerCase()) continue;
          }

          matchedOrder = order;
          break;
        }

        if (!matchedOrder) continue;

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
            toAddress: log.args.to, // Original case
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
              console.log(`[scanner] ❌ BLOCKED order ${matchedOrder.id} — ${screening.flags.join(', ')}`);
              // Don't confirm — leave as PENDING with risk flags
              continue;
            }

            if (screening.riskLevel === 'HIGH') {
              console.log(`[scanner] ⚠️ FLAGGED order ${matchedOrder.id} — risk ${screening.riskScore}, ${screening.flags.join(', ')}`);
            }

            await this.orderService.confirmOrder(matchedOrder.id, {
              txHash,
              blockNumber: log.blockNumber,
              confirmations,
            });
            console.log(`[scanner] ✅ Confirmed order ${matchedOrder.id} — $${amount} USDC on ${chain} (risk: ${screening.riskScore})`);
            matched++;
          } catch (err) {
            console.error(`[scanner] Failed to confirm order ${matchedOrder.id}:`, err);
          }
        }
      }

      // Update scan position
      await db.chainConfig.update({
        where: { chain },
        data: { lastScannedBlock: BigInt(toBlock) },
      });

      if (events.length > 0 || matched > 0) {
        console.log(`[scanner] ${chain}: blocks ${fromBlock}→${toBlock}, ${events.length} transfers, ${matched} confirmed`);
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

    // EVM chains — only scan chains that have pending orders (skip idle chains)
    for (const chain of SCAN_CHAINS) {
      const hasPending = await db.order.count({ where: { chain, status: 'PENDING', expiresAt: { gt: new Date() } } });
      if (hasPending > 0) {
        await this.scanForPayments(chain);
        await this.updatePendingConfirmations(chain);
      }
    }

    await nonEvmScans;
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
        select: { id: true, paymentAddress: true, amount: true, customerWallet: true },
        orderBy: { createdAt: 'desc' },
      });

      if (pendingOrders.length === 0) {
        console.log('[scanner] Solana: no pending orders');
        return;
      }
      console.log(`[scanner] Solana: ${pendingOrders.length} pending order(s)`);

      const TOKEN_MINTS: Record<string, string> = {
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
        'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr': 'EURC',
      };

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
          // Step 1: Find all token accounts (ATAs) owned by this wallet
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
          const tokenAccounts = (ataData.result?.value || []).map((a: any) => a.pubkey).filter(Boolean);
          // Also include the wallet address itself
          const addressesToScan = [address, ...tokenAccounts];

          // Step 2: Get signatures from all addresses (wallet + ATAs)
          const allSigs: any[] = [];
          for (const addr of addressesToScan) {
            try {
              const sigRes = await fetch(solRpc, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jsonrpc: '2.0', id: 2,
                  method: 'getSignaturesForAddress',
                  params: [addr, { limit: 10 }]
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
              const tokenName = info.mint ? TOKEN_MINTS[info.mint] : null;
              if (ix.parsed.type === 'transferChecked' && !tokenName) continue;

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
                const orderAmt = Number(order.amount);
                // Must be within 2% AND at least 95% of order amount
                if (amount < orderAmt * 0.999 || (orderAmt > 0 && Math.abs(amount - orderAmt) / orderAmt > 0.001)) continue;
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
        select: { id: true, paymentAddress: true, amount: true, customerWallet: true },
        orderBy: { createdAt: 'desc' },
      });

      if (pendingOrders.length === 0) return;

      const TOKEN_CONTRACTS: Record<string, string> = {
        'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': 'USDT',
        'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8': 'USDC',
      };

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
              const orderAmount = Number(order.amount);
              if (Math.abs(orderAmount - amount) >= 0.01) continue;
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
