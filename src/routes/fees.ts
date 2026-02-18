import { Router } from 'express';
import { db } from '../config/database';
import { rateLimit } from '../middleware/rateLimit';
import { logger } from '../utils/logger';
import {
  getTransactionFeePercent,
  getBillingConfig,
  isBillingDue,
  shouldSuspend,
  PLAN_CONFIG
} from '../config/pricing';

const router = Router();

// Default fee wallet (fallback if no platform wallets configured)
const DEFAULT_FEE_WALLET = process.env.STABLEPAY_FEE_WALLET || '0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF';

// Get platform fee wallets (per-chain) from database
async function getFeeWallets(): Promise<{ chain: string; address: string; label?: string | null }[]> {
  try {
    // @ts-ignore - platformWallet will exist after Prisma regeneration
    const wallets = await db.platformWallet?.findMany({
      where: { isActive: true },
      select: { chain: true, address: true, label: true }
    });

    if (wallets && wallets.length > 0) {
      return wallets;
    }
  } catch {
    // Table might not exist yet, use fallback
  }

  // Fallback: return default wallet for supported chains
  return [
    { chain: 'BASE_SEPOLIA', address: DEFAULT_FEE_WALLET },
    { chain: 'BASE_MAINNET', address: DEFAULT_FEE_WALLET },
    { chain: 'ETHEREUM_MAINNET', address: DEFAULT_FEE_WALLET },
  ];
}

// Get merchant's fee balance and transaction summary
router.get('/balance', async (req, res) => {
  try {
    const { merchantId } = req.query;
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!merchantId || !token) {
      return res.status(400).json({ error: 'Merchant ID and auth token required' });
    }

    // Verify merchant token
    const merchant = await db.merchant.findFirst({
      where: { id: merchantId as string, loginToken: token }
    });

    if (!merchant) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get confirmed orders for this merchant since last fee calculation
    const orders = await db.order.findMany({
      where: {
        merchantId: merchant.id,
        status: { in: ['PAID', 'CONFIRMED'] },
        createdAt: { gte: merchant.lastFeeCalculation || merchant.billingCycleStart }
      },
      include: { transactions: true }
    });

    // Calculate fees using standardized decimal format from pricing.ts
    const customFee = merchant.customFeePercent ? Number(merchant.customFeePercent) : null;
    const monthlyVolume = Number(merchant.monthlyVolumeUsed) || 0;
    const feePercent = getTransactionFeePercent(monthlyVolume, customFee);
    const feePercentDisplay = feePercent * 100; // For display (0.005 -> 0.5%)

    let totalVolume = 0;
    let totalFees = 0;
    const orderSummary: any[] = [];

    for (const order of orders) {
      const amount = Number(order.amount);
      // Use stored feeAmount if available, otherwise calculate
      const fee = order.feeAmount ? Number(order.feeAmount) : amount * feePercent;
      totalVolume += amount;
      totalFees += fee;

      orderSummary.push({
        orderId: order.id,
        amount,
        fee,
        date: order.createdAt,
        chain: order.chain,
        token: 'USDC'
      });
    }

    // Add any previously unpaid fees
    const previousFees = Number(merchant.feesDue) || 0;
    const totalOwed = previousFees + totalFees;

    // Get fee payment history
    const feePayments = await db.feePayment.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    // Get billing cycle config for merchant's plan
    const billingConfig = getBillingConfig(merchant.plan);
    const lastBillingDate = merchant.lastFeeCalculation || merchant.billingCycleStart;
    const billingStatus = isBillingDue(merchant.plan, lastBillingDate, totalOwed);

    // Calculate next billing date
    const nextBillingDate = billingConfig.billingCycleDays
      ? new Date(lastBillingDate.getTime() + billingConfig.billingCycleDays * 24 * 60 * 60 * 1000)
      : null;

    res.json({
      merchantId: merchant.id,
      companyName: merchant.companyName,
      plan: merchant.plan,

      // Billing cycle info
      billing: {
        cycleDays: billingConfig.billingCycleDays,
        cycleLabel: billingConfig.billingCycleDays === 7 ? 'Weekly' :
                    billingConfig.billingCycleDays === 14 ? 'Bi-weekly' :
                    billingConfig.billingCycleDays === 30 ? 'Monthly' : 'N/A',
        gracePeriodDays: billingConfig.gracePeriodDays,
        minInvoiceAmount: billingConfig.minInvoiceAmount,
        lastBillingDate,
        nextBillingDate,
        isDue: billingStatus.due,
        daysOverdue: billingStatus.daysOverdue,
        inGracePeriod: billingStatus.inGracePeriod,
      },

      // Current billing period
      currentPeriod: {
        start: lastBillingDate,
        transactions: orders.length,
        volume: totalVolume,
        feesGenerated: totalFees,
        feePercent: feePercentDisplay // Display as percentage (0.5 = 0.5%)
      },

      // Total balance
      previousBalance: previousFees,
      currentFees: totalFees,
      totalOwed,

      // Status
      isSuspended: merchant.isSuspended,
      suspendedAt: merchant.suspendedAt,

      // Payment info - fetch platform wallets from DB
      feeWallets: await getFeeWallets(),
      acceptedTokens: ['USDC', 'USDT'],

      // Recent transactions (for detail view)
      recentOrders: orderSummary.slice(0, 20),

      // Payment history
      paymentHistory: feePayments.map(p => ({
        id: p.id,
        amount: Number(p.amount),
        chain: p.chain,
        token: p.token,
        txHash: p.txHash,
        status: p.status,
        date: p.createdAt
      }))
    });

  } catch (error) {
    logger.error('Error fetching fee balance', error as Error, {});
    res.status(500).json({ error: 'Failed to fetch fee balance' });
  }
});

// Record a fee payment
router.post('/pay', async (req, res) => {
  try {
    const { merchantId, txHash, chain, token, amount } = req.body;
    const authHeader = req.headers.authorization;
    const authToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!merchantId || !authToken || !txHash || !chain || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify merchant token
    const merchant = await db.merchant.findFirst({
      where: { id: merchantId, loginToken: authToken }
    });

    if (!merchant) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if payment already exists
    const existingPayment = await db.feePayment.findFirst({
      where: { txHash }
    });

    if (existingPayment) {
      return res.status(400).json({ error: 'Payment already recorded' });
    }

    // Create fee payment record
    const feePayment = await db.feePayment.create({
      data: {
        merchantId: merchant.id,
        amount: parseFloat(amount),
        token: token || 'USDC',
        chain,
        txHash,
        status: 'PENDING',
        periodStart: merchant.lastFeeCalculation || merchant.billingCycleStart,
        periodEnd: new Date()
      }
    });

    // NOTE: Do NOT update merchant feesDue here. Balance is only adjusted
    // after admin verifies the payment via /admin/fee-payments/:id/verify.
    // This prevents merchants from getting credit for unverified/fake payments.

    logger.info('Fee payment submitted (pending verification)', {
      merchantId: merchant.id,
      amount: parseFloat(amount),
      txHash,
      event: 'fees.payment_submitted'
    });

    const currentFeesDue = Number(merchant.feesDue) || 0;

    res.json({
      success: true,
      paymentId: feePayment.id,
      status: 'PENDING',
      remainingBalance: currentFeesDue,
      message: 'Payment submitted. Balance will be updated after admin verification.'
    });

  } catch (error) {
    logger.error('Error recording fee payment', error as Error, {});
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

// Confirm a fee payment (called after tx confirmed on-chain)
router.post('/confirm', async (req, res) => {
  try {
    const { paymentId, txHash } = req.body;

    const payment = await db.feePayment.findFirst({
      where: {
        OR: [
          { id: paymentId },
          { txHash }
        ]
      }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    await db.feePayment.update({
      where: { id: payment.id },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date()
      }
    });

    res.json({ success: true });

  } catch (error) {
    logger.error('Error confirming fee payment', error as Error, {});
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// Admin: Check and suspend merchants with overdue fees
// This should be called by a cron job or admin panel
// Uses plan-based billing cycles (STARTER=weekly, GROWTH=bi-weekly, PRO/ENTERPRISE=monthly)
router.post('/check-overdue', async (req, res) => {
  try {
    const { adminKey } = req.body;

    // Simple admin key check (in production, use proper auth)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get all non-suspended merchants with fees due
    const merchantsWithFees = await db.merchant.findMany({
      where: {
        isSuspended: false,
        feesDue: { gt: 0 },
        plan: { not: 'FREE' } // FREE plan doesn't have billing
      },
      select: {
        id: true,
        email: true,
        companyName: true,
        plan: true,
        feesDue: true,
        lastFeeCalculation: true,
        billingCycleStart: true
      }
    });

    const suspended: string[] = [];
    const warnings: { id: string; email: string; daysOverdue: number }[] = [];

    for (const merchant of merchantsWithFees) {
      const lastBillingDate = merchant.lastFeeCalculation || merchant.billingCycleStart;
      const feesDue = Number(merchant.feesDue);

      // Check if this merchant should be suspended based on their plan's billing cycle
      if (shouldSuspend(merchant.plan, lastBillingDate, feesDue)) {
        await db.merchant.update({
          where: { id: merchant.id },
          data: {
            isSuspended: true,
            suspendedAt: new Date()
          }
        });

        logger.info('Merchant suspended for unpaid fees', {
          merchantId: merchant.id,
          plan: merchant.plan,
          feesDue,
          event: 'fees.merchant_suspended'
        });

        suspended.push(merchant.id);
      } else {
        // Check if they're in grace period (warning)
        const billingStatus = isBillingDue(merchant.plan, lastBillingDate, feesDue);
        if (billingStatus.inGracePeriod) {
          warnings.push({
            id: merchant.id,
            email: merchant.email,
            daysOverdue: billingStatus.daysOverdue
          });
        }
      }
    }

    res.json({
      checked: merchantsWithFees.length,
      suspended: suspended.length,
      suspendedIds: suspended,
      inGracePeriod: warnings.length,
      warnings
    });

  } catch (error) {
    logger.error('Error checking overdue fees', error as Error, {});
    res.status(500).json({ error: 'Failed to check overdue fees' });
  }
});

// Admin: Manually suspend or unsuspend a merchant
router.post('/suspend', async (req, res) => {
  try {
    const { adminKey, merchantId, suspend } = req.body;

    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!merchantId) {
      return res.status(400).json({ error: 'Merchant ID required' });
    }

    await db.merchant.update({
      where: { id: merchantId },
      data: {
        isSuspended: suspend,
        suspendedAt: suspend ? new Date() : null
      }
    });

    logger.info(`Merchant ${suspend ? 'suspended' : 'unsuspended'}`, {
      merchantId,
      event: suspend ? 'fees.merchant_suspended' : 'fees.merchant_unsuspended'
    });

    res.json({ success: true, merchantId, isSuspended: suspend });

  } catch (error) {
    logger.error('Error updating merchant suspension', error as Error, {});
    res.status(500).json({ error: 'Failed to update suspension status' });
  }
});

// Public: Get pricing tiers and billing info
router.get('/pricing', (_req, res) => {
  const tiers = Object.entries(PLAN_CONFIG).map(([key, config]) => ({
    plan: key,
    name: config.name,
    description: config.description,
    feePercent: config.feePercent,
    feeDisplay: `${(config.feePercent * 100).toFixed(1)}%`,
    volumeLimit: config.volumeLimit,
    volumeLimitDisplay: config.volumeLimit
      ? `$${config.volumeLimit.toLocaleString()}/mo`
      : 'Unlimited',
    billingCycle: config.billingCycleDays
      ? config.billingCycleDays === 7 ? 'Weekly'
        : config.billingCycleDays === 14 ? 'Bi-weekly'
        : 'Monthly'
      : 'N/A',
    billingCycleDays: config.billingCycleDays,
    gracePeriodDays: config.gracePeriodDays,
  }));

  res.json({
    model: 'invoice',
    description: 'Merchants receive 100% of payments. Fees are invoiced based on billing cycle.',
    tiers,
    feeWallet: process.env.STABLEPAY_FEE_WALLET || '0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF',
    acceptedTokens: ['USDC', 'USDT'],
    acceptedChains: ['BASE_SEPOLIA', 'BASE_MAINNET', 'ETHEREUM_MAINNET'],
  });
});

export const feesRouter = router;
