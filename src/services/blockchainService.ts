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
