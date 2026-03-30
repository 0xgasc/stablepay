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

// Chains to scan (mainnet only)
const SCAN_CHAINS: Chain[] = [
  'BASE_MAINNET',
  'ETHEREUM_MAINNET',
  'POLYGON_MAINNET',
  'ARBITRUM_MAINNET',
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
      const toBlock = Math.min(fromBlock + 500, currentBlock); // Scan 500 blocks max per cycle

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
        const amount = ethers.formatUnits(log.args.value, 6);
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
          if (Math.abs(orderAmount - txAmount) >= 0.01) continue;

          // If order has customerWallet, require FROM match (prevents cross-matching)
          if (order.customerWallet) {
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
    for (const chain of SCAN_CHAINS) {
      await this.scanForPayments(chain);
      await this.updatePendingConfirmations(chain);
    }
    // Solana scanning (separate flow)
    await this.scanSolanaPayments();
    // Expire stale orders
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
    try {
      // Get pending Solana orders
      const pendingOrders = await db.order.findMany({
        where: {
          chain: 'SOLANA_MAINNET',
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        select: { id: true, paymentAddress: true, amount: true, customerWallet: true },
        orderBy: { createdAt: 'desc' },
      });

      if (pendingOrders.length === 0) return;

      const { Connection, PublicKey } = await import('@solana/web3.js');
      const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

      // USDC and USDT mint addresses on Solana
      const TOKEN_MINTS: Record<string, string> = {
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
        'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr': 'EURC',
      };

      // Group orders by payment address
      const addressMap = new Map<string, typeof pendingOrders>();
      for (const order of pendingOrders) {
        const existing = addressMap.get(order.paymentAddress) || [];
        existing.push(order);
        addressMap.set(order.paymentAddress, existing);
      }

      for (const [address, orders] of addressMap) {
        try {
          const pubkey = new PublicKey(address);
          // Get recent signatures for this address
          const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 20 });

          for (const sigInfo of sigs) {
            // Skip if already processed
            const existing = await db.transaction.findUnique({ where: { txHash: sigInfo.signature } });
            if (existing) continue;

            // Get parsed transaction
            const tx = await connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
            if (!tx || tx.meta?.err) continue;

            // Collect all SPL token transfers from both top-level and inner instructions
            const allInstructions: any[] = [
              ...tx.transaction.message.instructions,
              ...(tx.meta?.innerInstructions?.flatMap((inner: any) => inner.instructions) || []),
            ];

            // Build map of token account → owner from initializeAccount3 instructions
            const tokenAccountOwners: Record<string, string> = {};
            for (const ix of allInstructions) {
              if ('parsed' in ix && ix.parsed?.type === 'initializeAccount3' && ix.program === 'spl-token') {
                tokenAccountOwners[ix.parsed.info.account] = ix.parsed.info.owner;
              }
            }

            for (const ix of allInstructions) {
              if (!('parsed' in ix) || ix.program !== 'spl-token') continue;
              if (ix.parsed?.type !== 'transferChecked' && ix.parsed?.type !== 'transfer') continue;

              const info = ix.parsed.info;
              const mint = info.mint;
              const tokenName = mint ? TOKEN_MINTS[mint] : null;
              if (ix.parsed.type === 'transferChecked' && !tokenName) continue;

              const amount = parseFloat(info.tokenAmount?.uiAmountString || info.amount || '0');
              // Sender: authority OR multisigAuthority OR first signer
              const fromAuthority = info.authority || info.multisigAuthority || info.signers?.[0] || '';
              if (!fromAuthority) continue;

              // Destination could be a token account — resolve to wallet owner
              const destTokenAccount = info.destination;
              const destOwner = tokenAccountOwners[destTokenAccount] || destTokenAccount;

              // Check if destination resolves to our watched address
              if (destOwner !== address && destTokenAccount !== address) continue;

              // Match against pending orders
              for (const order of orders) {
                const orderAmount = Number(order.amount);
                if (Math.abs(orderAmount - amount) >= 0.01) continue;
                if (order.customerWallet && fromAuthority !== order.customerWallet) continue;

                // Match found — create transaction + confirm
                await db.transaction.create({
                  data: {
                    orderId: order.id,
                    txHash: sigInfo.signature,
                    chain: 'SOLANA_MAINNET',
                    amount: amount,
                    fromAddress: fromAuthority,
                    toAddress: address,
                    status: 'CONFIRMED',
                    confirmations: 1,
                    blockTimestamp: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date(),
                  },
                });

                // Compliance screening
                const { complianceService } = await import('./complianceService');
                const screening = await complianceService.screenTransaction(order.id, fromAuthority);

                if (screening.riskLevel !== 'BLOCKED') {
                  await this.orderService.confirmOrder(order.id, {
                    txHash: sigInfo.signature,
                  });
                  console.log(`[scanner] ✅ Solana confirmed order ${order.id} — ${amount} ${tokenName || 'SPL'}`);
                } else {
                  console.log(`[scanner] ❌ Solana BLOCKED order ${order.id} — ${screening.flags.join(', ')}`);
                }
                break;
              }
            }
          }
        } catch (err: any) {
          console.error(`[scanner] Solana scan error for ${address}:`, err.message);
        }
      }
    } catch (error: any) {
      console.error('[scanner] Solana scan cycle error:', error.message);
    }
  }

  private scanning = false;

  async startScanning(intervalMs = 15000): Promise<void> {
    console.log(`[scanner] Starting blockchain scanner — ${SCAN_CHAINS.length} chains, ${intervalMs}ms interval`);

    // Initial scan
    await this.scanAll();

    // Continuous scanning with lock to prevent overlap
    setInterval(async () => {
      if (this.scanning) {
        console.log('[scanner] Previous scan still running, skipping');
        return;
      }
      this.scanning = true;
      try {
        await this.scanAll();
      } catch (error: any) {
        console.error('[scanner] Scan cycle error:', error.message);
      } finally {
        this.scanning = false;
      }
    }, intervalMs);
  }
}
