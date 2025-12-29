import { ethers } from 'ethers';
import { db } from '../config/database';
import { CHAIN_CONFIGS } from '../config/chains';
import { Chain } from '../types';
import { Decimal } from '@prisma/client/runtime/library';

const USDC_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)"
];

export class BlockchainService {
  private providers: Record<Chain, ethers.JsonRpcProvider> = {} as any;
  private contracts: Record<Chain, ethers.Contract> = {} as any;

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    Object.entries(CHAIN_CONFIGS).forEach(([chain, config]) => {
      this.providers[chain as Chain] = new ethers.JsonRpcProvider(config.rpcUrl);
      this.contracts[chain as Chain] = new ethers.Contract(
        config.usdcAddress,
        USDC_ABI,
        this.providers[chain as Chain]
      );
    });
  }

  async scanForPayments(chain: Chain): Promise<void> {
    try {
      const provider = this.providers[chain];
      const contract = this.contracts[chain];
      const config = CHAIN_CONFIGS[chain];
      
      const currentBlock = await provider.getBlockNumber();
      
      let chainConfig = await db.chainConfig.findUnique({
        where: { chain },
      });

      if (!chainConfig) {
        chainConfig = await db.chainConfig.create({
          data: {
            chain,
            rpcUrl: config.rpcUrl,
            usdcAddress: config.usdcAddress,
            paymentAddress: config.paymentAddress,
            requiredConfirms: config.requiredConfirms,
            blockTimeSeconds: config.blockTimeSeconds,
            lastScannedBlock: BigInt(currentBlock - 1000),
          },
        });
      }

      const fromBlock = Number(chainConfig.lastScannedBlock);
      const toBlock = Math.min(fromBlock + 1000, currentBlock);

      if (fromBlock >= toBlock) return;

      const filter = contract.filters.Transfer(null, config.paymentAddress);
      const events = await contract.queryFilter(filter, fromBlock, toBlock);

      for (const event of events) {
        await this.processTransferEvent(chain, event);
      }

      await db.chainConfig.update({
        where: { chain },
        data: { lastScannedBlock: BigInt(toBlock) },
      });

      console.log(`Scanned ${chain} blocks ${fromBlock} to ${toBlock}, found ${events.length} transfers`);
    } catch (error) {
      console.error(`Error scanning ${chain}:`, error);
    }
  }

  private async processTransferEvent(chain: Chain, event: any): Promise<void> {
    const txHash = event.transactionHash;
    const amount = ethers.formatUnits(event.args.value, 6);
    const fromAddress = event.args.from;
    const toAddress = event.args.to;

    const existingTx = await db.transaction.findUnique({
      where: { txHash },
    });

    if (existingTx) return;

    const receipt = await event.getTransactionReceipt();
    const block = await event.getBlock();

    const pendingOrders = await db.order.findMany({
      where: {
        chain,
        status: 'PENDING',
        paymentAddress: toAddress,
        expiresAt: { gt: new Date() },
      },
    });

    let matchedOrder = null;
    for (const order of pendingOrders) {
      const orderAmount = Number(order.amount);
      const txAmount = Number(amount);
      
      if (Math.abs(orderAmount - txAmount) < 0.01) {
        matchedOrder = order;
        break;
      }
    }

    const transaction = await db.transaction.create({
      data: {
        orderId: matchedOrder?.id || 'unmatched',
        txHash,
        chain,
        amount: new Decimal(amount),
        fromAddress,
        toAddress,
        blockNumber: BigInt(receipt.blockNumber),
        blockTimestamp: new Date(block.timestamp * 1000),
        status: receipt.status === 1 ? 'CONFIRMED' : 'FAILED',
        confirmations: await this.getConfirmations(chain, receipt.blockNumber),
      },
    });

    if (matchedOrder && receipt.status === 1) {
      const confirmations = await this.getConfirmations(chain, receipt.blockNumber);
      const requiredConfirms = CHAIN_CONFIGS[chain].requiredConfirms;

      if (confirmations >= requiredConfirms) {
        const now = new Date();
        await db.$executeRaw`UPDATE orders SET status = 'PAID'::"OrderStatus", "updatedAt" = ${now} WHERE id = ${matchedOrder.id}`;
      }
    }

    console.log(`Processed transaction ${txHash} on ${chain}, amount: ${amount} USDC`);
  }

  private async getConfirmations(chain: Chain, blockNumber: number): Promise<number> {
    const currentBlock = await this.providers[chain].getBlockNumber();
    return Math.max(0, currentBlock - blockNumber);
  }

  async updateTransactionConfirmations(chain: Chain): Promise<void> {
    const pendingTransactions = await db.transaction.findMany({
      where: {
        chain,
        status: 'CONFIRMED',
      },
      include: { order: true },
    });

    for (const tx of pendingTransactions) {
      if (!tx.blockNumber) continue;

      const confirmations = await this.getConfirmations(chain, Number(tx.blockNumber));
      const requiredConfirms = CHAIN_CONFIGS[chain].requiredConfirms;

      await db.transaction.update({
        where: { id: tx.id },
        data: { confirmations },
      });

      if (
        confirmations >= requiredConfirms &&
        tx.order &&
        tx.order.status === 'PENDING'
      ) {
        const now = new Date();
        await db.$executeRaw`UPDATE orders SET status = 'PAID'::"OrderStatus", "updatedAt" = ${now} WHERE id = ${tx.orderId}`;
      }
    }
  }

  async startScanning(): Promise<void> {
    const chains: Chain[] = ['BASE_SEPOLIA', 'ETHEREUM_SEPOLIA'];
    
    const scanAll = async () => {
      for (const chain of chains) {
        await this.scanForPayments(chain);
        await this.updateTransactionConfirmations(chain);
      }
    };

    scanAll();
    setInterval(scanAll, 30000);
    console.log('Blockchain scanner started for all chains');
  }
}