import { ethers } from 'ethers';
import crypto from 'crypto';
import { db } from '../config/database';
import { Decimal } from '@prisma/client/runtime/library';
import { logger } from '../utils/logger';

const CHAIN_RPC: Record<string, { rpc: string; tokens: Record<string, string> }> = {
  BASE_MAINNET: { rpc: process.env.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org', tokens: { USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42' } },
  ETHEREUM_MAINNET: { rpc: process.env.ETHEREUM_MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com', tokens: { USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7', EURC: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c' } },
  POLYGON_MAINNET: { rpc: process.env.POLYGON_MAINNET_RPC_URL || 'https://polygon-bor-rpc.publicnode.com', tokens: { USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', EURC: '0x390f28e7b2a5Ce76b67F0cD10EA0950A3a19F803' } },
  ARBITRUM_MAINNET: { rpc: process.env.ARBITRUM_MAINNET_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com', tokens: { USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', EURC: '0x7Cb7cA2D5c848a1b3e6eCc8De1d8E4F79dAF96c8' } },
  BNB_MAINNET: { rpc: process.env.BNB_MAINNET_RPC_URL || 'https://bsc-dataseed.binance.org', tokens: { USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', USDT: '0x55d398326f99059fF775485246999027B3197955' } },
};
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function transfer(address, uint256) returns (bool)'];
const ENCRYPTION_KEY = process.env.JWT_SECRET || process.env.AGENT_WALLET_KEY;
const AGENT_WALLET_KEY = process.env.AGENT_WALLET_KEY?.trim();

function decryptManagedKey(encrypted: string): string {
  if (!ENCRYPTION_KEY) throw new Error('Encryption key not configured');
  const [ivHex, encData] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export interface CreateRefundRequest {
  orderId: string;
  amount?: number;
  reason: string;
  customerWallet?: string; // Customer's wallet address for refund
}

export interface RefundPolicy {
  maxRefundDays: number;
  allowPartialRefunds: boolean;
  autoApproveThreshold: number; // Auto-approve small refunds
}

export class RefundService {
  private policy: RefundPolicy = {
    maxRefundDays: 30,
    allowPartialRefunds: true,
    autoApproveThreshold: 50, // Auto-approve refunds under $50
  };

  async createRefund(data: CreateRefundRequest): Promise<any> {
    const order = await db.order.findUnique({
      where: { id: data.orderId },
      include: {
        transactions: true,
        refunds: true,
        merchant: { select: { id: true, companyName: true, email: true } }
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    if (order.status !== 'CONFIRMED') {
      throw new Error('Order must be confirmed to request refund');
    }

    const orderAge = Date.now() - order.createdAt.getTime();
    const maxAge = this.policy.maxRefundDays * 24 * 60 * 60 * 1000;

    if (orderAge > maxAge) {
      throw new Error(`Refunds are only allowed within ${this.policy.maxRefundDays} days`);
    }

    const paidAmount = Number(order.amount);
    const refundAmount = data.amount || paidAmount;

    if (refundAmount > paidAmount) {
      throw new Error('Refund amount cannot exceed paid amount');
    }

    if (!this.policy.allowPartialRefunds && refundAmount !== paidAmount) {
      throw new Error('Partial refunds are not allowed');
    }

    const existingRefunds = order.refunds.filter(r => r.status !== 'REJECTED');
    const totalRefunded = existingRefunds.reduce((sum, r) => sum + Number(r.amount), 0);

    if (totalRefunded + refundAmount > paidAmount) {
      throw new Error('Total refund amount would exceed paid amount');
    }

    // Auto-approve small refunds. Merchant can override the platform-wide $50 default
    // via `refundAutoApproveThreshold` in merchant settings (0 = never auto-approve).
    const merchantThreshold = order.merchantId
      ? await db.merchant.findUnique({
          where: { id: order.merchantId },
          select: { refundAutoApproveThreshold: true },
        }).then(m => m?.refundAutoApproveThreshold != null ? Number(m.refundAutoApproveThreshold) : null)
      : null;
    const threshold = merchantThreshold != null ? merchantThreshold : this.policy.autoApproveThreshold;
    const shouldAutoApprove = refundAmount <= threshold;

    const refund = await db.refund.create({
      data: {
        orderId: data.orderId,
        amount: new Decimal(refundAmount),
        reason: data.reason,
        status: shouldAutoApprove ? 'APPROVED' : 'PENDING',
        approvedBy: shouldAutoApprove ? 'AUTO' : undefined,
      },
    });

    logger.info('Refund request created', {
      refundId: refund.id,
      orderId: data.orderId,
      amount: refundAmount,
      status: refund.status,
      merchantId: order.merchantId || undefined,
      event: 'refund.created'
    });

    return {
      ...refund,
      order: {
        id: order.id,
        amount: Number(order.amount),
        chain: order.chain,
        customerEmail: order.customerEmail
      },
      merchant: order.merchant
    };
  }

  async approveRefund(refundId: string, approvedBy: string): Promise<any> {
    const refund = await db.refund.update({
      where: { id: refundId },
      data: {
        status: 'APPROVED',
        approvedBy,
      },
      include: {
        order: {
          include: { merchant: true }
        }
      }
    });

    logger.info('Refund approved', {
      refundId,
      approvedBy,
      event: 'refund.approved'
    });

    // Don't auto-process - merchant must send funds and submit tx hash
    return refund;
  }

  async rejectRefund(refundId: string, rejectedBy: string, reason?: string): Promise<any> {
    const refund = await db.refund.update({
      where: { id: refundId },
      data: {
        status: 'REJECTED',
        approvedBy: rejectedBy,
      },
    });

    logger.info('Refund rejected', {
      refundId,
      rejectedBy,
      reason,
      event: 'refund.rejected'
    });

    return refund;
  }

  // Called when merchant submits the tx hash after sending funds
  async processRefund(refundId: string, txHash: string, processedBy: string): Promise<any> {
    const refund = await db.refund.findUnique({
      where: { id: refundId },
      include: { order: true },
    });

    if (!refund) {
      throw new Error('Refund not found');
    }

    if (refund.status !== 'APPROVED') {
      throw new Error('Refund must be approved before processing');
    }

    // Update refund with tx hash
    const updatedRefund = await db.refund.update({
      where: { id: refundId },
      data: {
        status: 'PROCESSED',
        refundTxHash: txHash,
      },
    });

    // Update order status to REFUNDED
    const now = new Date();
    await db.$executeRaw`UPDATE orders SET status = 'REFUNDED'::"OrderStatus", "updatedAt" = ${now} WHERE id = ${refund.orderId}`;

    logger.info('Refund processed', {
      refundId,
      txHash,
      processedBy,
      orderId: refund.orderId,
      amount: Number(refund.amount),
      event: 'refund.processed'
    });

    return updatedRefund;
  }

  // Get refund details with customer wallet info from transaction
  async getRefundDetails(refundId: string): Promise<any> {
    const refund = await db.refund.findUnique({
      where: { id: refundId },
      include: {
        order: {
          include: {
            transactions: true,
            merchant: {
              select: { id: true, companyName: true, email: true }
            }
          }
        }
      }
    });

    if (!refund) return null;

    // Get customer wallet from the payment transaction
    const paymentTx = refund.order.transactions.find(tx => tx.status === 'CONFIRMED');
    const customerWallet = paymentTx?.fromAddress;

    return {
      ...refund,
      amount: Number(refund.amount),
      customerWallet,
      order: {
        ...refund.order,
        amount: Number(refund.order.amount)
      }
    };
  }

  async getPendingRefunds(): Promise<any[]> {
    return db.refund.findMany({
      where: { status: 'PENDING' },
      include: { order: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getRefundStats() {
    const [total, pending, approved, rejected, processed] = await Promise.all([
      db.refund.count(),
      db.refund.count({ where: { status: 'PENDING' } }),
      db.refund.count({ where: { status: 'APPROVED' } }),
      db.refund.count({ where: { status: 'REJECTED' } }),
      db.refund.count({ where: { status: 'PROCESSED' } }),
    ]);

    const totalAmount = await db.refund.aggregate({
      where: { status: 'PROCESSED' },
      _sum: { amount: true },
    });

    return {
      total,
      pending,
      approved,
      rejected,
      processed,
      totalRefunded: Number(totalAmount._sum.amount || 0),
    };
  }

  /**
   * Process refund from managed wallet with gas sponsorship
   */
  async processManagedRefund(orderId: string, refundToAddress: string): Promise<{
    success: boolean; txHash?: string; gasTxHash?: string; amount?: string; error?: string;
  }> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { merchant: true },
    });

    if (!order) return { success: false, error: 'Order not found' };
    if (order.status !== 'CONFIRMED') {
      return { success: false, error: `Cannot refund order with status ${order.status}` };
    }
    if (!order.merchantId) return { success: false, error: 'No merchant on this order' };

    if (order.chain === 'TRON_MAINNET') {
      return { success: false, error: `Automated refunds on TRON coming soon. For now, send the refund manually from your wallet to the customer address.` };
    }

    const managedWallet = await db.managedWallet.findUnique({
      where: { merchantId_chain: { merchantId: order.merchantId!, chain: order.chain } },
    });

    // Solana SPL token refund
    if (order.chain === 'SOLANA_MAINNET') {
      if (!managedWallet) return { success: false, error: 'No managed wallet for Solana. Send refund manually.' };
      return this.processSolanaRefund(order, managedWallet, refundToAddress, Number(order.amount));
    }

    const chainConf = CHAIN_RPC[order.chain];
    if (!chainConf) return { success: false, error: `Refund not supported on ${order.chain}` };

    if (!managedWallet) {
      return { success: false, error: 'No managed wallet. Merchant must refund from their own wallet.' };
    }

    const tokenAddress = chainConf.tokens[order.token] || chainConf.tokens.USDC;
    const amount = Number(order.amount);
    const decimals = order.chain === 'BNB_MAINNET' ? 18 : 6;
    const amountRaw = ethers.parseUnits(amount.toString(), decimals);

    try {
      const privateKey = decryptManagedKey(managedWallet.encryptedKey);
      const provider = new ethers.JsonRpcProvider(chainConf.rpc);
      const merchantWallet = new ethers.Wallet(privateKey, provider);
      let gasTxHash: string | undefined;

      // Step 1: Sponsor gas if needed
      const gasBalance = await provider.getBalance(managedWallet.address);
      if (gasBalance < ethers.parseEther('0.0005')) {
        if (!AGENT_WALLET_KEY) {
          return { success: false, error: 'Agent wallet not configured — cannot sponsor gas' };
        }
        const agentWallet = new ethers.Wallet(AGENT_WALLET_KEY, provider);
        const agentBalance = await provider.getBalance(agentWallet.address);
        if (agentBalance < ethers.parseEther('0.0005')) {
          const native = order.chain.includes('POLYGON') ? 'MATIC' : 'ETH';
          return { success: false, error: `Agent wallet needs funding for gas on ${order.chain}. Address: ${agentWallet.address}, Balance: ${ethers.formatEther(agentBalance)} ${native}, Needed: ~0.002 ${native}` };
        }
        const gasTx = await agentWallet.sendTransaction({
          to: managedWallet.address,
          value: ethers.parseEther('0.0003'),
        });
        await gasTx.wait();
        gasTxHash = gasTx.hash;
        logger.info('Gas sponsored for refund', { orderId, gasTxHash, chain: order.chain });
      }

      // Step 2: Check token balance
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, merchantWallet);
      const tokenBalance = await tokenContract.balanceOf(managedWallet.address);
      if (tokenBalance < amountRaw) {
        const available = ethers.formatUnits(tokenBalance, decimals);
        return { success: false, error: `Insufficient ${order.token} for refund. Available: $${available}, needed: $${amount}` };
      }

      // Step 3: Send refund
      const refundTx = await tokenContract.transfer(refundToAddress, amountRaw);
      await refundTx.wait();

      // Step 4: Update order + create refund record
      const now = new Date();
      await db.$executeRaw`UPDATE orders SET status = 'REFUNDED'::"OrderStatus", "updatedAt" = ${now} WHERE id = ${orderId}`;

      await db.refund.create({
        data: {
          orderId,
          amount: order.amount,
          reason: 'Refund processed via managed wallet',
          status: 'PROCESSED',
          refundTxHash: refundTx.hash,
        },
      });

      // Record treasury move
      await db.treasuryMove.create({
        data: {
          merchantId: order.merchantId!,
          type: 'REFUND',
          chain: order.chain,
          token: order.token,
          amount,
          fromAddress: managedWallet.address,
          toAddress: refundToAddress,
          txHash: refundTx.hash,
          gasTxHash,
          status: 'COMPLETED',
        },
      });

      logger.info('Managed refund processed', {
        orderId, amount, token: order.token, chain: order.chain,
        refundTxHash: refundTx.hash, gasTxHash, to: refundToAddress,
      });

      return { success: true, txHash: refundTx.hash, gasTxHash, amount: amount.toString() };
    } catch (err: any) {
      logger.error('Managed refund failed', err, { orderId });
      return { success: false, error: 'Refund failed: ' + err.message };
    }
  }

  /**
   * Process Solana SPL token refund using @solana/web3.js
   */
  private async processSolanaRefund(
    order: any,
    managedWallet: any,
    refundToAddress: string,
    amount: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const { Connection, PublicKey, Keypair, Transaction } = await import('@solana/web3.js');

      const MINTS: Record<string, string> = {
        USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        EURC: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr',
      };

      const mintAddr = MINTS[order.token];
      if (!mintAddr) return { success: false, error: `Token ${order.token} not supported for Solana refunds` };

      const solRpc = process.env.SOLANA_MAINNET_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';
      const connection = new Connection(solRpc, 'confirmed');

      // Decrypt managed wallet key
      const privateKey = decryptManagedKey(managedWallet.encryptedKey).trim();
      // Handle both hex and base58 encoded keys
      const bs58 = await import('bs58');
      let secretKey: Uint8Array;
      if (/^[0-9a-fA-F]+$/.test(privateKey)) {
        secretKey = new Uint8Array(Buffer.from(privateKey, 'hex'));
      } else if (privateKey.startsWith('[')) {
        secretKey = new Uint8Array(JSON.parse(privateKey));
      } else {
        secretKey = bs58.default.decode(privateKey);
      }
      const keypair = Keypair.fromSecretKey(secretKey);

      const mint = new PublicKey(mintAddr);
      const recipient = new PublicKey(refundToAddress);
      const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

      // Derive ATAs
      const [senderAta] = PublicKey.findProgramAddressSync(
        [keypair.publicKey.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM
      );
      const [recipientAta] = PublicKey.findProgramAddressSync(
        [recipient.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM
      );

      const amountRaw = BigInt(Math.round(amount * 1e6)); // 6 decimals

      // Build transfer instruction using raw instruction data
      // SPL Token transfer instruction = index 3, then amount as u64
      const dataBuffer = Buffer.alloc(9);
      dataBuffer.writeUInt8(12, 0); // TransferChecked instruction
      dataBuffer.writeBigUInt64LE(amountRaw, 1);

      // Use createTransferCheckedInstruction equivalent via raw tx
      // Simpler: use the token program directly
      const { createTransferCheckedInstruction, getOrCreateAssociatedTokenAccount } = await import('@solana/spl-token');

      // Ensure recipient ATA exists
      await getOrCreateAssociatedTokenAccount(connection, keypair, mint, recipient);

      const tx = new Transaction().add(
        createTransferCheckedInstruction(senderAta, mint, recipientAta, keypair.publicKey, amountRaw, 6)
      );

      const sig = await connection.sendTransaction(tx, [keypair]);
      await connection.confirmTransaction(sig, 'confirmed');

      // Update order + create refund record
      const now = new Date();
      await db.$executeRaw`UPDATE orders SET status = 'REFUNDED'::"OrderStatus", "updatedAt" = ${now} WHERE id = ${order.id}`;
      await db.refund.create({
        data: {
          orderId: order.id, amount: order.amount,
          reason: 'Refund via managed Solana wallet',
          status: 'PROCESSED', refundTxHash: sig,
        },
      });

      logger.info('Solana refund processed', {
        orderId: order.id, amount, token: order.token, txHash: sig, to: refundToAddress,
      });

      return { success: true, txHash: sig };
    } catch (err: any) {
      logger.error('Solana refund failed', err, { orderId: order.id });
      return { success: false, error: 'Solana refund failed: ' + err.message };
    }
  }
}