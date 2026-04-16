import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database';
import { rateLimit } from '../middleware/rateLimit';
import { requireMerchantAuth } from '../middleware/auth';
import { logger } from '../utils/logger';
import { webhookService } from '../services/webhookService';

const router = Router();

// CORS headers for embed endpoints (allow cross-origin)
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Validation schema for checkout
const checkoutSchema = z.object({
  merchantId: z.string().min(1),
  amount: z.number().positive(),
  chain: z.string().min(1),
  token: z.enum(['USDC', 'USDT', 'EURC']).default('USDC'),
  customerEmail: z.string().email().optional().or(z.literal('')),
  customerName: z.string().optional(),
  customerWallet: z.string().optional(),  // Customer's wallet for precise FROM matching
  paymentMethod: z.enum(['WALLET_CONNECT', 'MANUAL_SEND']).optional(),
  source: z.enum(['EMBED_WIDGET', 'CHECKOUT_LINK', 'DASHBOARD', 'API', 'INVOICE']).optional(),
  productName: z.string().optional(),
  externalId: z.string().optional(),   // Merchant's own order/reference ID
  metadata: z.record(z.any()).optional()
});

/**
 * Get available chains for a merchant
 * Used by widget to show chain selector
 */
router.get('/chains', async (req, res) => {
  try {
    const { merchantId } = req.query;

    if (!merchantId) {
      return res.status(400).json({ error: 'merchantId is required' });
    }

    // Get merchant + wallets in one query
    const merchant = await db.merchant.findUnique({
      where: { id: merchantId as string },
      select: {
        id: true, isActive: true, isSuspended: true, companyName: true, plan: true, widgetConfig: true,
        wallets: {
          where: { isActive: true },
          orderBy: { priority: 'asc' },
          select: { chain: true, address: true, supportedTokens: true }
        }
      }
    });

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    if (merchant.isSuspended) {
      return res.status(503).json({ error: 'Merchant temporarily unavailable' });
    }

    // Gate hideFooter to GROWTH+ plans
    const widgetConfig = (merchant.widgetConfig as any) || {};
    const canHideFooter = ['GROWTH', 'SCALE', 'ENTERPRISE'].includes(merchant.plan);
    if (!canHideFooter) delete widgetConfig.hideFooter;

    res.json({
      merchantId,
      merchantName: merchant.companyName,
      chains: merchant.wallets.map(w => w.chain),
      wallets: merchant.wallets,
      widgetConfig,
    });
  } catch (error) {
    console.error('Get embed chains error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Create order from embed widget
 * Called when customer initiates payment
 */
router.post('/checkout', rateLimit({
  getMerchantId: async (req) => req.body.merchantId || null,
  limitAnonymous: true,
  anonymousLimit: 100
}), async (req, res) => {
  try {
    const data = checkoutSchema.parse(req.body);

    // Verify merchant
    const merchant = await db.merchant.findUnique({
      where: { id: data.merchantId },
      include: {
        wallets: {
          where: { chain: data.chain as any, isActive: true },
          take: 1
        }
      }
    });

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    if (merchant.isSuspended) {
      return res.status(503).json({
        error: 'Payment unavailable',
        message: 'This merchant is temporarily unavailable'
      });
    }

    const wallet = merchant.wallets[0];
    if (!wallet) {
      return res.status(400).json({
        error: 'No wallet configured',
        message: `Merchant has no wallet for ${data.chain}`
      });
    }

    // Create order
    // Cancel any existing pending orders for this merchant + customer wallet combo
    // Prevents duplicate order matching confusion
    if (data.customerWallet) {
      await db.order.updateMany({
        where: {
          merchantId: data.merchantId,
          customerWallet: data.customerWallet,
          status: 'PENDING',
        },
        data: { status: 'CANCELLED' },
      });
    }

    const order = await db.order.create({
      data: {
        merchantId: data.merchantId,
        amount: data.amount,
        token: data.token,
        chain: data.chain as any,
        customerEmail: data.customerEmail || null,
        customerName: data.customerName || data.productName || null,
        paymentAddress: wallet.address,
        customerWallet: data.customerWallet || null,
        paymentMethod: data.paymentMethod || null,
        source: data.source || 'EMBED_WIDGET',
        externalId: data.externalId || null,
        metadata: data.metadata || undefined,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });

    // Rewind scanner for this chain — payment may have landed before order was created
    // (deferred order creation means tx often arrives before we start watching)
    if (['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'BNB_MAINNET'].includes(data.chain)) {
      try {
        const chainConfig = await db.chainConfig.findUnique({ where: { chain: data.chain as any } });
        if (chainConfig && chainConfig.lastScannedBlock) {
          // Go back 150 blocks (~5 min on Base) to catch recent payments
          const rewindTo = BigInt(chainConfig.lastScannedBlock.toString()) - BigInt(150);
          await db.chainConfig.update({
            where: { chain: data.chain as any },
            data: { lastScannedBlock: rewindTo > 0n ? rewindTo : 0n },
          });
        }
      } catch { /* non-critical */ }
    }

    logger.info('Embed order created', {
      orderId: order.id,
      merchantId: data.merchantId,
      amount: data.amount,
      chain: data.chain,
      externalId: data.externalId,
      source: 'embed_widget'
    });

    // Send webhook
    webhookService.sendWebhook(data.merchantId, 'order.created', {
      orderId: order.id,
      externalId: data.externalId || null,
      amount: data.amount,
      token: data.token,
      chain: data.chain,
      paymentAddress: wallet.address,
      customerEmail: data.customerEmail || null,
      source: data.source || 'EMBED_WIDGET',
      productName: data.productName,
      metadata: data.metadata,
    }).catch(err => {
      logger.error('Failed to send order.created webhook', err as Error, { orderId: order.id });
    });

    res.status(201).json({
      success: true,
      order: {
        id: order.id,
        externalId: order.externalId || null,
        amount: Number(order.amount),
        token: order.token,
        chain: order.chain,
        paymentAddress: order.paymentAddress,
        expiresAt: order.expiresAt.toISOString(),
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      console.error('Embed checkout error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
});

/**
 * Get order status (for polling)
 */
router.get('/order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        transactions: {
          where: { status: 'CONFIRMED' },
          take: 1,
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const txHash = order.transactions[0]?.txHash || null;
    const explorerUrls: Record<string, string> = {
      BASE_MAINNET: 'https://basescan.org/tx/',
      ETHEREUM_MAINNET: 'https://etherscan.io/tx/',
      POLYGON_MAINNET: 'https://polygonscan.com/tx/',
      ARBITRUM_MAINNET: 'https://arbiscan.io/tx/',
      BNB_MAINNET: 'https://bscscan.com/tx/',
      SOLANA_MAINNET: 'https://solscan.io/tx/',
      TRON_MAINNET: 'https://tronscan.org/#/transaction/',
      BASE_SEPOLIA: 'https://sepolia.basescan.org/tx/',
      ETHEREUM_SEPOLIA: 'https://sepolia.etherscan.io/tx/',
    };

    res.json({
      id: order.id,
      status: order.status,
      amount: Number(order.amount),
      token: order.token,
      chain: order.chain,
      paymentAddress: order.paymentAddress,
      merchantId: order.merchantId,
      productName: order.customerName, // productName is stored in customerName when set via embed
      customerEmail: order.customerEmail,
      txHash,
      explorerLink: txHash && explorerUrls[order.chain] ? explorerUrls[order.chain] + txHash : null,
      confirmedAt: order.transactions[0]?.blockTimestamp?.toISOString() || null,
      expiresAt: order.expiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Get embed order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Manual TX submission — customer enters txHash when scanner doesn't catch it
 * Auto-verifies on-chain, falls back to manual review
 */
router.post('/order/:orderId/tx', async (req, res) => {
  try {
    const { orderId } = req.params;
    let { txHash, explorerLink } = req.body;

    // Parse txHash from explorer link if provided
    if (!txHash && explorerLink) {
      // Extract hash from URLs like https://basescan.org/tx/0x123... or https://solscan.io/tx/abc...
      const match = explorerLink.match(/(?:\/tx\/|\/transaction\/)([a-zA-Z0-9]+)/);
      if (match) txHash = match[1];
    }

    if (!txHash) {
      return res.status(400).json({ error: 'txHash or explorerLink required' });
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { merchant: { select: { id: true, email: true } } },
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'PENDING') {
      return res.status(400).json({ error: `Order status is ${order.status}`, status: order.status });
    }

    // Check expiry
    if (order.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Order has expired', status: 'EXPIRED' });
    }

    // Check if TX already recorded (duplicate prevention — across ALL orders)
    const existingTx = await db.transaction.findUnique({ where: { txHash } });
    if (existingTx) {
      if (existingTx.orderId === orderId && existingTx.status === 'CONFIRMED') {
        return res.json({ success: true, status: 'CONFIRMED', message: 'Already confirmed' });
      }
      return res.status(400).json({ error: 'This transaction has already been used for another order' });
    }

    // Check if order already has a pending manual submission
    const pendingManualTx = await db.transaction.findFirst({
      where: { orderId, status: 'PENDING' },
    });
    if (pendingManualTx) {
      return res.status(400).json({ error: 'A transaction is already pending review for this order', txHash: pendingManualTx.txHash });
    }

    // Try auto-verification on-chain — MUST verify destination, token, and amount
    let verified = false;
    let verifyError = '';
    try {
      if (order.chain === 'SOLANA_MAINNET') {
        const solRpc = process.env.SOLANA_MAINNET_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com';

        // Get merchant's ATAs to match against
        const ataRes = await fetch(solRpc, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'getTokenAccountsByOwner',
            params: [order.paymentAddress, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }] }),
          signal: AbortSignal.timeout(8000),
        });
        const ataData: any = await ataRes.json();
        const merchantATAs = new Set((ataData.result?.value || []).map((a: any) => a.pubkey));
        merchantATAs.add(order.paymentAddress); // Also check wallet itself

        // Get the transaction
        const solRes = await fetch(solRpc, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction',
            params: [txHash, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] }),
          signal: AbortSignal.timeout(10000),
        });
        const solData: any = await solRes.json();
        const tx = solData.result;

        if (!tx) { verifyError = 'Transaction not found on Solana'; }
        else if (tx.meta?.err) { verifyError = 'Transaction failed on-chain'; }
        else {
          // Parse SPL transfers — verify destination is our ATA and amount matches
          // Valid token mints we accept
          const VALID_MINTS: Record<string, string> = {
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
            'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
            'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr': 'EURC',
          };

          const allIx = [...(tx.transaction?.message?.instructions || []), ...(tx.meta?.innerInstructions?.flatMap((i: any) => i.instructions) || [])];
          let matchedAmount = 0;
          let matchedFrom = '';

          for (const ix of allIx) {
            if (!ix.parsed || ix.program !== 'spl-token') continue;
            if (ix.parsed.type !== 'transferChecked' && ix.parsed.type !== 'transfer') continue;
            const dest = ix.parsed.info.destination;
            if (!merchantATAs.has(dest)) continue; // Not to our wallet!
            // Verify it's a stablecoin we accept (not a random SPL token)
            const mint = ix.parsed.info.mint;
            if (mint && !VALID_MINTS[mint]) continue;
            const amt = parseFloat(ix.parsed.info.tokenAmount?.uiAmountString || '0');
            matchedAmount += amt;
            matchedFrom = ix.parsed.info.authority || ix.parsed.info.multisigAuthority || ix.parsed.info.signers?.[0] || '';
          }

          const orderAmt = Number(order.amount);
          // Use percentage tolerance: must be within 2% of order amount, AND at least 95% paid
          const pctDiff = orderAmt > 0 ? Math.abs(matchedAmount - orderAmt) / orderAmt : 1;
          if (matchedAmount === 0) {
            verifyError = 'This transaction does not send tokens to the merchant wallet';
          } else if (matchedAmount < orderAmt * 0.999 || pctDiff > 0.001) {
            verifyError = `Amount mismatch: TX sends $${matchedAmount.toFixed(6)} but order requires $${orderAmt.toFixed(6)}`;
          } else {
            verified = true;
            await db.transaction.create({
              data: { orderId, txHash, chain: order.chain, amount: matchedAmount,
                fromAddress: matchedFrom || 'verified', toAddress: order.paymentAddress,
                status: 'CONFIRMED', confirmations: 1,
                blockTimestamp: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date() },
            });
            const { OrderService } = await import('../services/orderService');
            await new OrderService().confirmOrder(orderId, { txHash });
          }
        }
      } else if (['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'BNB_MAINNET'].includes(order.chain)) {
        const { ethers } = await import('ethers');
        const { CHAIN_CONFIGS } = await import('../config/chains');
        const config = CHAIN_CONFIGS[order.chain as keyof typeof CHAIN_CONFIGS];
        if (!config?.rpcUrl) { verifyError = 'Chain not configured'; }
        else {
          const provider = new ethers.JsonRpcProvider(config.rpcUrl);
          const receipt = await provider.getTransactionReceipt(txHash);
          if (!receipt) { verifyError = 'Transaction not found on this chain'; }
          else if (receipt.status !== 1) { verifyError = 'Transaction failed on-chain'; }
          else {
            // Known stablecoin contracts per chain
            const VALID_TOKENS: Record<string, string[]> = {
              BASE_MAINNET: ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42'],
              ETHEREUM_MAINNET: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0xdAC17F958D2ee523a2206206994597C13D831ec7', '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c'],
              POLYGON_MAINNET: ['0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'],
              ARBITRUM_MAINNET: ['0xaf88d065e77c8cC2239327C5EDb3A432268e5831', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'],
              BNB_MAINNET: ['0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', '0x55d398326f99059fF775485246999027B3197955'],
            };
            const validContracts = new Set((VALID_TOKENS[order.chain] || []).map(a => a.toLowerCase()));

            // Parse ERC20 Transfer logs — verify TO is our address AND from a valid stablecoin contract
            const transferTopic = ethers.id('Transfer(address,address,uint256)');
            const matchingLog = receipt.logs.find(log =>
              log.topics[0] === transferTopic &&
              validContracts.has(log.address.toLowerCase()) && // Must be a known stablecoin
              log.topics[2] && ethers.getAddress('0x' + log.topics[2].slice(26)).toLowerCase() === order.paymentAddress.toLowerCase()
            );
            if (!matchingLog) {
              verifyError = 'This transaction does not send tokens to the merchant wallet';
            } else {
              const decimals = order.chain === 'BNB_MAINNET' ? 18 : 6;
              const txAmount = parseFloat(ethers.formatUnits(BigInt(matchingLog.data), decimals));
              const evmOrderAmt = Number(order.amount);
              const evmPctDiff = evmOrderAmt > 0 ? Math.abs(txAmount - evmOrderAmt) / evmOrderAmt : 1;
              if (txAmount < evmOrderAmt * 0.999 || evmPctDiff > 0.001) {
                verifyError = `Amount mismatch: TX sends $${txAmount.toFixed(6)} but order requires $${evmOrderAmt.toFixed(6)}`;
              } else {
                verified = true;
                await db.transaction.create({
                  data: { orderId, txHash, chain: order.chain, amount: txAmount,
                    fromAddress: receipt.from, toAddress: order.paymentAddress,
                    blockNumber: BigInt(receipt.blockNumber),
                    status: 'CONFIRMED', confirmations: 1, blockTimestamp: new Date() },
                });
                const { OrderService } = await import('../services/orderService');
                await new OrderService().confirmOrder(orderId, { txHash, blockNumber: receipt.blockNumber });
              }
            }
          }
        }
      }
    } catch (verifyErr: any) {
      console.error(`[manual-tx] Auto-verify failed for ${orderId}:`, verifyErr.message);
      verifyError = 'Verification failed: ' + verifyErr.message;
    }

    if (verified) {
      return res.json({ success: true, status: 'CONFIRMED', message: 'Payment verified and confirmed!' });
    }

    // Verification failed with a specific reason — reject, don't queue
    if (verifyError) {
      return res.status(400).json({ error: verifyError, status: 'REJECTED' });
    }

    // Unknown failure — queue for manual review
    await db.transaction.create({
      data: {
        orderId, txHash, chain: order.chain,
        amount: Number(order.amount),
        fromAddress: order.customerWallet || 'manual_submission',
        toAddress: order.paymentAddress,
        status: 'PENDING', confirmations: 0,
        blockTimestamp: new Date(),
      },
    });

    // Notify merchant + admin
    if (order.merchant?.id) {
      webhookService.sendWebhook(order.merchant.id, 'order.created', {
        orderId, txHash, status: 'PENDING_REVIEW',
        message: 'Customer submitted TX hash manually — please verify',
      }).catch(() => {});
    }

    logger.info('Manual TX submitted for review', {
      orderId, txHash, chain: order.chain, event: 'order.manual_tx_submitted',
    });

    res.json({
      success: true,
      status: 'PENDING_REVIEW',
      message: 'Transaction submitted for review. You\'ll be notified once confirmed.',
    });
  } catch (error) {
    console.error('Manual TX submission error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Save widget configuration (merchant auth required)
 */
router.put('/widget-config', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const config = req.body;

    // Validate allowed keys
    const allowed = ['borderStyle', 'theme', 'headerColor', 'headerTextColor', 'logoUrl', 'buttonText', 'fontFamily', 'hideFooter'];
    const clean: Record<string, any> = {};
    for (const key of allowed) {
      if (config[key] !== undefined) clean[key] = config[key];
    }

    // Gate hideFooter
    const canHideFooter = ['GROWTH', 'SCALE', 'ENTERPRISE'].includes(merchant.plan);
    if (!canHideFooter) delete clean.hideFooter;

    await db.merchant.update({
      where: { id: merchant.id },
      data: { widgetConfig: clean },
    });

    res.json({ success: true, widgetConfig: clean });
  } catch (error) {
    console.error('Save widget config error:', error);
    res.status(500).json({ error: 'Failed to save widget config' });
  }
});

/**
 * Get widget configuration (public)
 */
router.get('/widget-config', async (req, res) => {
  try {
    const { merchantId } = req.query;
    if (!merchantId) return res.status(400).json({ error: 'merchantId required' });

    const merchant = await db.merchant.findUnique({
      where: { id: merchantId as string },
      select: { widgetConfig: true, plan: true },
    });

    if (!merchant) return res.status(404).json({ error: 'Merchant not found' });

    const config = (merchant.widgetConfig as any) || {};
    const canHideFooter = ['GROWTH', 'SCALE', 'ENTERPRISE'].includes(merchant.plan);
    if (!canHideFooter) delete config.hideFooter;

    res.json({ widgetConfig: config });
  } catch (error) {
    console.error('Get widget config error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as embedRouter };
