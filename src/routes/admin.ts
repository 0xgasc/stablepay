import { Router } from 'express';
import { db } from '../config/database';
import { PRICING_TIERS } from '../config/pricing';
import { logger } from '../utils/logger';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

// Get the admin key from environment (support ADMIN_KEY, ADMIN_PASSWORD, or ADMIN_API_TOKEN)
const getAdminKey = () => process.env.ADMIN_KEY || process.env.ADMIN_PASSWORD || process.env.ADMIN_API_TOKEN;

// Helper to serialize BigInt values to strings for JSON
const serializeBigInt = (obj: any): any => {
  return JSON.parse(JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ));
};

// Middleware to check admin key - accepts x-admin-key header, Authorization Bearer, or body.adminKey
const requireAdminKey = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const providedKey = req.headers['x-admin-key'] || bearerToken || req.body?.adminKey;

  if (providedKey !== getAdminKey()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// GET admin resources (orders, wallets, merchants)
router.get('/', requireAdminKey, rateLimit({
  getMerchantId: async (req) => req.query.merchantId as string || null,
  limitAnonymous: true,
  anonymousLimit: 20
}), async (req, res) => {
  try {
    const { resource, merchantId } = req.query;

    if (!resource) {
      return res.status(400).json({ error: 'Resource parameter is required' });
    }

    switch (resource) {
      case 'orders':
        // If merchantId provided, filter by merchant; otherwise return all orders (admin view)
        const ordersWhere = merchantId && typeof merchantId === 'string'
          ? { merchantId }
          : {};

        const orders = await db.order.findMany({
          where: ordersWhere,
          include: {
            merchant: {
              select: { companyName: true, email: true, plan: true },
            },
            transactions: true,
            refunds: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        });

        // Format orders with fee info for display and serialize BigInt
        const ordersWithFees = orders.map(order => ({
          ...order,
          amount: Number(order.amount),
          feePercent: Number(order.feePercent) * 100, // Convert to percentage for display (0.005 -> 0.5%)
          feeAmount: Number(order.feeAmount),
        }));

        return res.json({ orders: serializeBigInt(ordersWithFees) });

      case 'wallets':
        if (merchantId && typeof merchantId === 'string') {
          // Get wallets for specific merchant
          const wallets = await db.merchantWallet.findMany({
            where: { merchantId },
            orderBy: { createdAt: 'desc' },
          });
          return res.json(wallets);
        } else {
          // Get all wallets (admin view)
          const wallets = await db.merchantWallet.findMany({
            include: {
              merchant: {
                select: {
                  companyName: true,
                  email: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          });
          return res.json(wallets);
        }

      case 'merchants':
        const merchants = await db.merchant.findMany({
          include: {
            wallets: true,
            _count: {
              select: { orders: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        });
        return res.json(merchants);

      default:
        return res.status(400).json({ error: `Unknown resource: ${resource}` });
    }
  } catch (error) {
    console.error('Admin API error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST create merchant or admin login
router.post('/', async (req, res) => {
  try {
    const { resource } = req.query;

    // Admin login - validates against ADMIN_KEY/ADMIN_PASSWORD env var (no auth required for login)
    if (resource === 'login') {
      const { email, password } = req.body;
      const expectedKey = getAdminKey();

      // Simple validation: check if password matches admin key
      if (password === expectedKey) {
        logger.info('Admin login successful', { email, event: 'admin.login_success' });
        return res.json({
          success: true,
          token: expectedKey // Return the key as the token for x-admin-key header
        });
      } else {
        logger.warn('Admin login failed', { email, event: 'admin.login_failed' });
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }

    // For non-login resources, verify admin key
    const authHeader = req.headers['authorization'] as string | undefined;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const providedKey = req.headers['x-admin-key'] || bearerToken || req.body?.adminKey;
    if (providedKey !== getAdminKey()) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (resource === 'merchants') {
      const { email, companyName, contactName, plan, networkMode, paymentMode, isActive } = req.body;

      if (!email || !companyName || !contactName) {
        return res.status(400).json({ error: 'Email, company name, and contact name are required' });
      }

      // Check if merchant already exists
      const existing = await db.merchant.findUnique({
        where: { email },
      });

      if (existing) {
        return res.status(400).json({ error: 'Merchant with this email already exists' });
      }

      // Create merchant - if admin creates and sets active immediately, generate token
      let loginToken = undefined;
      let tokenExpiresAt = undefined;

      if (isActive === true) {
        loginToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        tokenExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
        console.log(`🔑 Generated login token for ${email}: ${loginToken}`);
      }

      const merchant = await db.merchant.create({
        data: {
          email,
          companyName,
          contactName,
          plan: plan || 'STARTER',
          networkMode: networkMode || 'TESTNET',
          paymentMode: paymentMode || 'DIRECT',
          isActive: isActive || false,
          ...(loginToken && { loginToken }),
          ...(tokenExpiresAt && { tokenExpiresAt }),
        },
      });

      return res.json({ success: true, merchant, loginToken });
    }

    if (resource === 'wallets') {
      const { merchantId, wallets } = req.body;

      if (!merchantId || !Array.isArray(wallets)) {
        return res.status(400).json({ error: 'merchantId and wallets array are required' });
      }

      // Validate tier limits for multi-chain support
      const merchant = await db.merchant.findUnique({
        where: { id: merchantId },
        select: { plan: true, companyName: true },
      });

      if (!merchant) {
        return res.status(404).json({ error: 'Merchant not found' });
      }

      const plan = merchant.plan || 'FREE';
      const tier = PRICING_TIERS[plan];

      // Count unique chains being added
      const uniqueChains = new Set(wallets.map(w => w.chain));
      const chainCount = uniqueChains.size;

      // Check if merchant exceeds their blockchain limit
      if (chainCount > tier.features.blockchains) {
        logger.tierLimitExceeded(merchantId, plan, 'blockchains');
        return res.status(403).json({
          error: 'Blockchain limit exceeded',
          message: `Your ${tier.name} plan supports ${tier.features.blockchains} blockchain${tier.features.blockchains > 1 ? 's' : ''}. You're trying to add ${chainCount}.`,
          upgradeRequired: true,
          currentPlan: plan,
          currentLimit: tier.features.blockchains,
          requested: chainCount,
          upgradeUrl: '/pricing.html'
        });
      }

      // Delete existing wallets for this merchant
      await db.merchantWallet.deleteMany({
        where: { merchantId },
      });

      // Create new wallets
      const created = await Promise.all(
        wallets.map(wallet =>
          db.merchantWallet.create({
            data: {
              merchantId,
              chain: wallet.chain,
              address: wallet.address,
              isActive: true,
            },
          })
        )
      );

      logger.info('Wallets configured', {
        merchantId,
        companyName: merchant.companyName,
        chains: Array.from(uniqueChains),
        walletCount: created.length,
        event: 'wallets.configured'
      });

      return res.json({ success: true, wallets: created });
    }

    return res.status(400).json({ error: 'Invalid resource for POST' });
  } catch (error) {
    console.error('Admin POST error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// POST/PUT wallets
router.post('/wallets', requireAdminKey, async (req, res) => {
  try {
    const { merchantId, wallets } = req.body;

    if (!merchantId || !Array.isArray(wallets)) {
      return res.status(400).json({ error: 'merchantId and wallets array are required' });
    }

    // Validate tier limits for multi-chain support
    const merchant = await db.merchant.findUnique({
      where: { id: merchantId },
      select: { plan: true, companyName: true },
    });

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    const plan = merchant.plan || 'FREE';
    const tier = PRICING_TIERS[plan];

    // Count unique chains being added
    const uniqueChains = new Set(wallets.map(w => w.chain));
    const chainCount = uniqueChains.size;

    // Check if merchant exceeds their blockchain limit
    if (chainCount > tier.features.blockchains) {
      logger.tierLimitExceeded(merchantId, plan, 'blockchains');
      return res.status(403).json({
        error: 'Blockchain limit exceeded',
        message: `Your ${tier.name} plan supports ${tier.features.blockchains} blockchain${tier.features.blockchains > 1 ? 's' : ''}. You're trying to add ${chainCount}.`,
        upgradeRequired: true,
        currentPlan: plan,
        currentLimit: tier.features.blockchains,
        requested: chainCount,
        upgradeUrl: '/pricing.html'
      });
    }

    // Delete existing wallets for this merchant
    await db.merchantWallet.deleteMany({
      where: { merchantId },
    });

    // Create new wallets with supported tokens
    const created = await Promise.all(
      wallets.map(wallet =>
        db.merchantWallet.create({
          data: {
            merchantId,
            chain: wallet.chain,
            address: wallet.address,
            supportedTokens: wallet.supportedTokens || ['USDC'],
            isActive: true,
          },
        })
      )
    );

    logger.info('Wallets configured', {
      merchantId,
      companyName: merchant.companyName,
      chains: Array.from(uniqueChains),
      walletCount: created.length,
      event: 'wallets.configured'
    });

    res.json({ success: true, wallets: created });
  } catch (error) {
    console.error('Wallet save error:', error);
    const err = error instanceof Error ? error : new Error('Unknown error');
    logger.error('Failed to save wallets', err);
    res.status(500).json({
      error: 'Failed to save wallets',
      message: err.message
    });
  }
});

// PUT update merchant
router.put('/', requireAdminKey, async (req, res) => {
  try {
    const { resource } = req.query;

    if (resource === 'merchants') {
      const { merchantId, isActive, plan, networkMode, paymentMode } = req.body;

      if (!merchantId) {
        return res.status(400).json({ error: 'merchantId is required' });
      }

      // If activating merchant, generate login token
      let updateData: any = {
        ...(typeof isActive !== 'undefined' && { isActive }),
        ...(plan && { plan }),
        ...(networkMode && { networkMode }),
        ...(paymentMode && { paymentMode }),
      };

      // Generate token when activating a merchant
      if (isActive === true) {
        const merchant = await db.merchant.findUnique({
          where: { id: merchantId },
        });

        // Only generate token if merchant doesn't have one or wasn't active
        if (merchant && !merchant.isActive) {
          const loginToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
          updateData.loginToken = loginToken;
          updateData.tokenExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year

          console.log(`🔑 Generated login token for ${merchant.email}: ${loginToken}`);
        }
      }

      const updatedMerchant = await db.merchant.update({
        where: { id: merchantId },
        data: updateData,
      });

      // Auto-send activation email when merchant is activated with a new token
      if (updateData.loginToken && updatedMerchant.email) {
        try {
          const { emailService } = await import('../services/emailService');
          if (emailService.isConfigured()) {
            // Send activation notification (uses Resend)
            const { Resend } = await import('resend');
            const resend = new Resend(process.env.RESEND_API_KEY);
            const BASE_URL = process.env.BASE_URL || 'https://stablepay-nine.vercel.app';
            const FROM_EMAIL = process.env.FROM_EMAIL || 'StablePay <onboarding@resend.dev>';

            await resend.emails.send({
              from: FROM_EMAIL,
              to: updatedMerchant.email,
              subject: 'Your StablePay account has been activated!',
              html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                  <div style="background: #000; color: #fff; padding: 30px; text-align: center;">
                    <h1 style="margin: 0;">Welcome to StablePay</h1>
                  </div>
                  <div style="padding: 30px;">
                    <p>Hi ${updatedMerchant.contactName || 'there'},</p>
                    <p>Your StablePay merchant account for <strong>${updatedMerchant.companyName}</strong> has been activated.</p>
                    <p>You can now log in to your dashboard:</p>
                    <p style="margin: 20px 0;">
                      <a href="${BASE_URL}/login.html" style="background: #000; color: #fff; padding: 14px 28px; text-decoration: none; font-weight: bold;">
                        Log In to Dashboard
                      </a>
                    </p>
                    <p style="margin-top: 20px;"><strong>Your credentials:</strong></p>
                    <p>Email: <code>${updatedMerchant.email}</code><br>
                    Token: <code>${updateData.loginToken}</code></p>
                    <p style="color: #666; font-size: 12px; margin-top: 30px;">
                      Powered by StablePay - Stablecoin Payment Infrastructure
                    </p>
                  </div>
                </div>
              `,
            });

            logger.info('Activation email sent', {
              merchantId, email: updatedMerchant.email, event: 'merchant.activation_email_sent',
            });
          }
        } catch (emailError) {
          logger.error('Failed to send activation email', emailError as Error, { merchantId });
          // Don't fail the activation if email fails
        }
      }

      return res.json({
        success: true,
        merchant: updatedMerchant,
        loginToken: updateData.loginToken // Return token so admin can share it
      });
    }

    return res.status(400).json({ error: 'Invalid resource for PUT' });
  } catch (error) {
    console.error('Admin PUT error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// DELETE merchant
router.delete('/', requireAdminKey, async (req, res) => {
  try {
    const { resource } = req.query;
    const { merchantId } = req.body;

    if (resource === 'merchants' && merchantId) {
      await db.merchant.delete({
        where: { id: merchantId as string },
      });

      return res.json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid resource or missing merchantId for DELETE' });
  } catch (error) {
    console.error('Admin DELETE error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ============================================================================
// PLATFORM WALLETS (Fee Collection) - Protected by ADMIN_KEY
// ============================================================================

// Get all platform wallets (for fee collection)
// Admin view returns ALL wallets (including inactive) so admin can reactivate them
router.get('/platform-wallets', requireAdminKey, async (_req, res) => {
  try {
    const wallets = await db.platformWallet.findMany({
      orderBy: { chain: 'asc' }
    });
    res.json(wallets); // Return array directly for easier frontend handling
  } catch (error) {
    console.error('Platform wallets GET error:', error);
    logger.error('Error fetching platform wallets', error as Error, {});
    res.status(500).json({ error: 'Failed to fetch wallets', details: error instanceof Error ? error.message : String(error) });
  }
});

// Add or update a platform wallet
router.post('/platform-wallets', requireAdminKey, async (req, res) => {
  try {
    const { chain, address, label } = req.body;

    if (!chain || !address) {
      return res.status(400).json({ error: 'Chain and address required' });
    }

    const wallet = await db.platformWallet.upsert({
      where: { chain },
      update: { address, label, isActive: true, updatedAt: new Date() },
      create: { chain, address, label, isActive: true }
    });

    logger.info('Platform wallet updated', { chain, address, event: 'admin.platform_wallet_updated' });
    res.json({ success: true, wallet });
  } catch (error) {
    console.error('Platform wallets POST error:', error);
    logger.error('Error updating platform wallet', error as Error, {});
    res.status(500).json({ error: 'Failed to update wallet', details: error instanceof Error ? error.message : String(error) });
  }
});

// Deactivate a platform wallet
router.delete('/platform-wallets/:chain', requireAdminKey, async (req, res) => {
  try {
    const { chain } = req.params;
    await db.platformWallet.update({
      where: { chain: chain as any },
      data: { isActive: false }
    });
    logger.info('Platform wallet deactivated', { chain, event: 'admin.platform_wallet_deactivated' });
    res.json({ success: true });
  } catch (error) {
    console.error('Platform wallets DELETE error:', error);
    logger.error('Error deactivating platform wallet', error as Error, {});
    res.status(500).json({ error: 'Failed to deactivate wallet', details: error instanceof Error ? error.message : String(error) });
  }
});

// ============================================================================
// FEE PAYMENT VERIFICATION
// ============================================================================

// Get pending fee payments for admin review
router.get('/fee-payments', requireAdminKey, async (req, res) => {
  try {
    const { status = 'PENDING' } = req.query;
    const payments = await db.feePayment.findMany({
      where: { status: status as any },
      include: {
        merchant: {
          select: { id: true, email: true, companyName: true, plan: true, feesDue: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json({ payments });
  } catch (error) {
    logger.error('Error fetching fee payments', error as Error, {});
    res.status(500).json({ error: 'Failed to fetch fee payments' });
  }
});

// Verify a fee payment (admin confirms tx is valid)
router.post('/fee-payments/:id/verify', requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminId = 'admin' } = req.body;

    const payment = await db.feePayment.findUnique({
      where: { id },
      include: { merchant: true }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.status === 'CONFIRMED') {
      return res.status(400).json({ error: 'Payment already confirmed' });
    }

    // Update payment as verified
    await db.feePayment.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        verifiedBy: adminId,
        verifiedAt: new Date(),
        confirmedAt: new Date()
      }
    });

    // Update merchant's fee balance
    const paidAmount = Number(payment.amount);
    const currentFeesDue = Number(payment.merchant.feesDue) || 0;
    const newFeesDue = Math.max(0, currentFeesDue - paidAmount);

    await db.merchant.update({
      where: { id: payment.merchantId },
      data: {
        feesDue: newFeesDue,
        lastFeeCalculation: new Date(),
        isSuspended: newFeesDue > 0 ? payment.merchant.isSuspended : false,
        suspendedAt: newFeesDue > 0 ? payment.merchant.suspendedAt : null
      }
    });

    logger.info('Fee payment verified by admin', {
      paymentId: id, merchantId: payment.merchantId, amount: paidAmount, adminId,
      event: 'admin.fee_payment_verified'
    });

    res.json({
      success: true,
      payment: { id, status: 'CONFIRMED' },
      merchant: { id: payment.merchantId, previousBalance: currentFeesDue, newBalance: newFeesDue }
    });
  } catch (error) {
    logger.error('Error verifying fee payment', error as Error, {});
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// Reject a fee payment
router.post('/fee-payments/:id/reject', requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, adminId = 'admin' } = req.body;

    await db.feePayment.update({
      where: { id },
      data: { status: 'FAILED', verifiedBy: adminId, verifiedAt: new Date() }
    });

    logger.info('Fee payment rejected', { paymentId: id, reason, adminId, event: 'admin.fee_payment_rejected' });
    res.json({ success: true, reason });
  } catch (error) {
    logger.error('Error rejecting fee payment', error as Error, {});
    res.status(500).json({ error: 'Failed to reject payment' });
  }
});

// Admin dashboard stats
router.get('/stats', requireAdminKey, async (_req, res) => {
  try {
    const [totalMerchants, activeMerchants, suspendedMerchants, pendingFeePayments, totalFeesCollected, feesOwed] = await Promise.all([
      db.merchant.count(),
      db.merchant.count({ where: { isActive: true, isSuspended: false } }),
      db.merchant.count({ where: { isSuspended: true } }),
      db.feePayment.count({ where: { status: 'PENDING' } }),
      db.feePayment.aggregate({ where: { status: 'CONFIRMED' }, _sum: { amount: true } }),
      db.merchant.aggregate({ _sum: { feesDue: true } })
    ]);

    res.json({
      merchants: { total: totalMerchants, active: activeMerchants, suspended: suspendedMerchants },
      fees: {
        pendingPayments: pendingFeePayments,
        totalCollected: Number(totalFeesCollected._sum.amount) || 0,
        totalOwed: Number(feesOwed._sum.feesDue) || 0
      }
    });
  } catch (error) {
    logger.error('Error fetching admin stats', error as Error, {});
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ============================================================================
// REFUNDS (Admin manages all refunds across merchants)
// ============================================================================

// List all refunds
router.get('/refunds', requireAdminKey, async (req, res) => {
  try {
    const { status } = req.query;
    const where: any = {};
    if (status && typeof status === 'string') {
      where.status = status;
    }

    const refunds = await db.refund.findMany({
      where,
      include: {
        order: {
          include: {
            merchant: { select: { companyName: true, email: true } },
            transactions: { select: { fromAddress: true }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const formatted = refunds.map(r => ({
      ...r,
      amount: Number(r.amount),
      order: {
        ...r.order,
        amount: Number(r.order.amount),
      },
    }));

    res.json({ refunds: serializeBigInt(formatted) });
  } catch (error) {
    logger.error('Error fetching refunds', error as Error, {});
    res.status(500).json({ error: 'Failed to fetch refunds' });
  }
});

// Refund stats
router.get('/refunds/stats', requireAdminKey, async (_req, res) => {
  try {
    const [pending, processed, rejected, totalRefunded] = await Promise.all([
      db.refund.count({ where: { status: 'PENDING' } }),
      db.refund.count({ where: { status: 'PROCESSED' } }),
      db.refund.count({ where: { status: 'REJECTED' } }),
      db.refund.aggregate({ where: { status: 'PROCESSED' }, _sum: { amount: true } }),
    ]);

    res.json({
      pending,
      processed,
      rejected,
      totalRefunded: Number(totalRefunded._sum.amount) || 0,
    });
  } catch (error) {
    logger.error('Error fetching refund stats', error as Error, {});
    res.status(500).json({ error: 'Failed to fetch refund stats' });
  }
});

// Approve refund
router.post('/refunds/:id/approve', requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const refund = await db.refund.findUnique({ where: { id } });
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    if (refund.status !== 'PENDING') return res.status(400).json({ error: `Cannot approve refund with status ${refund.status}` });

    // Use $queryRawUnsafe to avoid Prisma @updatedAt trigger conflict with Supabase moddatetime
    await db.$queryRawUnsafe(
      `UPDATE refunds SET status = 'APPROVED', "approvedBy" = 'admin' WHERE id = $1`,
      id
    );

    const updated = await db.refund.findUnique({
      where: { id },
      include: { order: { include: { transactions: { select: { fromAddress: true }, take: 1 } } } },
    });

    const customerWallet = updated?.order?.transactions[0]?.fromAddress || null;

    res.json({
      success: true,
      refund: updated ? { ...updated, amount: Number(updated.amount) } : null,
      customerWallet,
      nextStep: 'Send funds to customer wallet and submit tx hash via process endpoint',
    });
  } catch (error) {
    logger.error('Error approving refund', error as Error, {});
    res.status(500).json({ error: 'Failed to approve refund', details: error instanceof Error ? error.message : String(error) });
  }
});

// Reject refund
router.post('/refunds/:id/reject', requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const refund = await db.refund.findUnique({ where: { id } });
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    if (refund.status !== 'PENDING') return res.status(400).json({ error: `Cannot reject refund with status ${refund.status}` });

    await db.$queryRawUnsafe(`UPDATE refunds SET status = 'REJECTED', "approvedBy" = 'admin' WHERE id = $1`, id);
    const updated = await db.refund.findUnique({ where: { id } });

    res.json({ success: true, refund: updated ? { ...updated, amount: Number(updated.amount) } : null, reason });
  } catch (error) {
    logger.error('Error rejecting refund', error as Error, {});
    res.status(500).json({ error: 'Failed to reject refund' });
  }
});

// Process refund (record tx hash) - includes fee reversal
router.post('/refunds/:id/process', requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { txHash } = req.body;
    if (!txHash) return res.status(400).json({ error: 'txHash is required' });

    const refund = await db.refund.findUnique({
      where: { id },
      include: { order: { select: { id: true, amount: true, feeAmount: true, merchantId: true } } },
    });
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    if (refund.status !== 'APPROVED') return res.status(400).json({ error: `Cannot process refund with status ${refund.status}` });

    await db.$queryRawUnsafe(`UPDATE refunds SET status = 'PROCESSED', "refundTxHash" = $1 WHERE id = $2`, txHash, id);
    const processNow = new Date();
    await db.$executeRaw`UPDATE orders SET status = 'REFUNDED'::"OrderStatus", "updatedAt" = ${processNow} WHERE id = ${refund.orderId}`;
    const updated = await db.refund.findUnique({ where: { id } });

    // Proportional fee reversal (match merchant refund route logic)
    let feeReversed = 0;
    if (refund.order?.merchantId && refund.order?.feeAmount) {
      const orderAmount = Number(refund.order.amount);
      const refundAmount = Number(refund.amount);
      const originalFee = Number(refund.order.feeAmount);
      feeReversed = (refundAmount / orderAmount) * originalFee;

      await db.merchant.update({
        where: { id: refund.order.merchantId },
        data: { feesDue: { decrement: feeReversed } },
      });

      logger.info('Fee reversed on admin refund', {
        refundId: id, orderId: refund.orderId, merchantId: refund.order.merchantId,
        refundAmount, feeReversed, event: 'admin.refund.fee_reversed',
      });
    }

    // Fire webhook
    if (refund.order?.merchantId) {
      try {
        const { webhookService } = await import('../services/webhookService');
        webhookService.sendWebhook(refund.order.merchantId, 'refund.processed', {
          refundId: id, orderId: refund.orderId, amount: Number(refund.amount), txHash,
        }).catch(() => {});
      } catch {}
    }

    res.json(serializeBigInt({ success: true, refund: updated ? { ...updated, amount: Number(updated.amount) } : null, feeReversed, message: 'Refund completed successfully' }));
  } catch (error) {
    logger.error('Error processing refund', error as Error, {});
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

// ============================================================================
// RECEIPTS (Admin views all receipts across merchants)
// ============================================================================

// List all receipts
router.get('/receipts', requireAdminKey, async (req, res) => {
  try {
    const { page = '1', limit = '50' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [receipts, total] = await Promise.all([
      db.receipt.findMany({
        include: {
          merchant: { select: { companyName: true, email: true } },
          order: { select: { id: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      db.receipt.count(),
    ]);

    const formatted = receipts.map(r => ({
      ...r,
      amount: Number(r.amount),
    }));

    res.json({
      receipts: formatted,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    logger.error('Error fetching receipts', error as Error, {});
    res.status(500).json({ error: 'Failed to fetch receipts', details: String(error) });
  }
});

// Receipt stats
router.get('/receipts/stats', requireAdminKey, async (_req, res) => {
  try {
    const [total, sent, pending, failed] = await Promise.all([
      db.receipt.count(),
      db.receipt.count({ where: { emailStatus: 'SENT' } }),
      db.receipt.count({ where: { emailStatus: 'PENDING' } }),
      db.receipt.count({ where: { emailStatus: 'FAILED' } }),
    ]);

    res.json({ total, sent, pending, failed });
  } catch (error) {
    logger.error('Error fetching receipt stats', error as Error, {});
    res.status(500).json({ error: 'Failed to fetch receipt stats', details: String(error) });
  }
});

// Resend receipt email
router.post('/receipts/:id/resend', requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const receipt = await db.receipt.findUnique({ where: { id } });
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    if (!receipt.customerEmail) return res.status(400).json({ error: 'No customer email on this receipt' });

    // Try to use the email service if available
    try {
      const { emailService } = await import('../services/emailService');
      await emailService.sendReceipt(id);
      res.json({ success: true, message: 'Receipt email sent' });
    } catch {
      // If email service not configured, just update the status
      await db.receipt.update({ where: { id }, data: { emailStatus: 'SENT', emailSentAt: new Date() } });
      res.json({ success: true, message: 'Receipt marked as sent' });
    }
  } catch (error) {
    logger.error('Error resending receipt', error as Error, {});
    res.status(500).json({ error: 'Failed to resend receipt' });
  }
});

// One-time fix: drop broken Supabase moddatetime triggers on tables with camelCase columns
router.post('/fix-triggers', requireAdminKey, async (_req, res) => {
  try {
    // List triggers on refunds table
    const triggers: any[] = await db.$queryRaw`
      SELECT trigger_name, event_manipulation, action_statement
      FROM information_schema.triggers
      WHERE event_object_table = 'refunds'
    `;

    // Drop any moddatetime triggers that reference updated_at (snake_case)
    const dropped: string[] = [];
    for (const t of triggers) {
      if (t.action_statement?.includes('updated_at') || t.trigger_name?.includes('moddatetime')) {
        await db.$queryRawUnsafe(`DROP TRIGGER IF EXISTS "${t.trigger_name}" ON refunds`);
        dropped.push(t.trigger_name);
      }
    }

    res.json({ success: true, triggers, dropped });
  } catch (error) {
    res.status(500).json({ error: 'Failed', details: error instanceof Error ? error.message : String(error) });
  }
});

// One-time migration: create receipts table if missing
router.post('/migrate-receipts', requireAdminKey, async (_req, res) => {
  try {
    // Create ReceiptDeliveryStatus enum if not exists
    await db.$executeRaw`
      DO $$ BEGIN
        CREATE TYPE "ReceiptDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `;

    // Create receipts table
    await db.$executeRaw`
      CREATE TABLE IF NOT EXISTS "receipts" (
        "id" TEXT NOT NULL,
        "orderId" TEXT NOT NULL,
        "merchantId" TEXT NOT NULL,
        "receiptNumber" TEXT NOT NULL,
        "amount" DECIMAL(18,6) NOT NULL,
        "token" TEXT NOT NULL DEFAULT 'USDC',
        "chain" "Chain" NOT NULL,
        "txHash" TEXT,
        "merchantName" TEXT NOT NULL,
        "customerEmail" TEXT,
        "customerName" TEXT,
        "emailStatus" "ReceiptDeliveryStatus" NOT NULL DEFAULT 'PENDING',
        "emailSentAt" TIMESTAMP(3),
        "paymentDate" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
      );
    `;

    // Create unique constraints and indexes
    await db.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "receipts_orderId_key" ON "receipts"("orderId")`;
    await db.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "receipts_receiptNumber_key" ON "receipts"("receiptNumber")`;
    await db.$executeRaw`CREATE INDEX IF NOT EXISTS "receipts_merchantId_idx" ON "receipts"("merchantId")`;
    await db.$executeRaw`CREATE INDEX IF NOT EXISTS "receipts_paymentDate_idx" ON "receipts"("paymentDate")`;

    // Add foreign keys if not exist
    await db.$executeRaw`
      DO $$ BEGIN
        ALTER TABLE "receipts" ADD CONSTRAINT "receipts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `;
    await db.$executeRaw`
      DO $$ BEGIN
        ALTER TABLE "receipts" ADD CONSTRAINT "receipts_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `;

    res.json({ success: true, message: 'Receipts table created/verified' });
  } catch (error) {
    res.status(500).json({ error: 'Migration failed', details: String(error) });
  }
});

export const adminRouter = router;
