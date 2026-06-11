import { Router } from 'express';
import { ethers } from 'ethers';
import bcrypt from 'bcryptjs';
import { db } from '../config/database';
import { PRICING_TIERS } from '../config/pricing';
import { logger } from '../utils/logger';
import { rateLimit } from '../middleware/rateLimit';
import { logAdminAction } from '../utils/audit';

const router = Router();
const crypto = require('crypto');

// 2FA code store (in-memory, 10-min TTL)
const pending2FA: Map<string, { code: string; expiresAt: number; email: string }> = new Map();

// Raw stored secret (hash if bcrypt-prefixed, plaintext legacy otherwise).
// getAdminKey always returns the LIVE session token — which after bootstrap = the ADMIN_KEY env
// value. The DB value is used ONLY for verifying admin login (see verifyAdminPassword).
const getAdminKey = async (): Promise<string> => {
  return (process.env.ADMIN_KEY || process.env.ADMIN_PASSWORD || process.env.ADMIN_API_TOKEN || '').trim();
};

const getAdminKeySync = () => (process.env.ADMIN_KEY || process.env.ADMIN_PASSWORD || process.env.ADMIN_API_TOKEN || '').trim();

// Compare a plaintext admin password attempt against the stored secret.
// Order of precedence: DB (systemConfig.admin_password) → env (ADMIN_KEY / ADMIN_PASSWORD).
// Supports silent-upgrade: if DB row stores plaintext, rewrites it as bcrypt after a successful match.
async function verifyAdminPassword(plaintext: string): Promise<boolean> {
  if (!plaintext) return false;
  let stored = '';
  let source: 'db' | 'env' = 'env';
  try {
    const config = await db.systemConfig.findUnique({ where: { key: 'admin_password' } });
    if (config?.value) { stored = config.value; source = 'db'; }
  } catch { /* DB offline — fall through to env */ }
  if (!stored) {
    stored = process.env.ADMIN_KEY || process.env.ADMIN_PASSWORD || process.env.ADMIN_API_TOKEN || '';
  }
  if (!stored) return false;

  const isBcrypt = stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$');
  const matched = isBcrypt ? await bcrypt.compare(plaintext, stored) : plaintext === stored;
  if (!matched) return false;

  // Silent upgrade: re-hash plaintext DB values on successful login.
  if (!isBcrypt && source === 'db') {
    try {
      const hash = await bcrypt.hash(plaintext, 12);
      await db.systemConfig.upsert({
        where: { key: 'admin_password' },
        update: { value: hash },
        create: { key: 'admin_password', value: hash },
      });
      logger.security('Admin password silently upgraded to bcrypt', { event: 'admin.password_hashed' });
    } catch (err) {
      logger.error('Failed to upgrade admin password to bcrypt', err as Error);
    }
  }
  return true;
}

// Helper to serialize BigInt values to strings for JSON
const serializeBigInt = (obj: any): any => {
  return JSON.parse(JSON.stringify(obj, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ));
};

// Middleware to check admin key. Auth is HEADER-ONLY — never accept the key from
// the request body or query string. Body values get logged in request logs / proxies /
// error tracking, so leaking the key there would be a real risk.
const requireAdminKey = async (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const providedKey = req.headers['x-admin-key'] || bearerToken;

  const expectedKey = await getAdminKey();
  // Timing-safe compare — `!==` leaks key prefix length/content through response timing.
  // Hash both sides first so timingSafeEqual gets equal-length buffers regardless of input size.
  const ok = !!providedKey && !!expectedKey && (() => {
    const nodeCrypto = require('crypto') as typeof import('crypto');
    const a = nodeCrypto.createHash('sha256').update(String(providedKey)).digest();
    const b = nodeCrypto.createHash('sha256').update(String(expectedKey)).digest();
    return nodeCrypto.timingSafeEqual(a, b);
  })();
  if (!ok) {
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

        // Format orders with fee info for display and serialize BigInt.
        // feePercent stays in decimal-fraction form (0.005 = 0.5%); UI handles *100.
        const ordersWithFees = orders.map(order => ({
          ...order,
          amount: Number(order.amount),
          feePercent: Number(order.feePercent),
          feeAmount: Number(order.feeAmount),
        }));

        return res.json({ orders: serializeBigInt(ordersWithFees) });

      case 'stats': {
        // Aggregate across ALL orders (not just the most-recent 100).
        // Filterable by merchantId if provided.
        const where = merchantId && typeof merchantId === 'string' ? { merchantId } : {};
        const [totalOrders, confirmedAgg, merchantsTotal, merchantsActive] = await Promise.all([
          db.order.count({ where }),
          db.order.aggregate({
            where: { ...where, status: 'CONFIRMED' },
            _sum: { amount: true, feeAmount: true },
            _count: { _all: true },
          }),
          db.merchant.count(),
          db.merchant.count({ where: { isActive: true } }),
        ]);
        return res.json({
          totalOrders,
          confirmedOrders: confirmedAgg._count._all,
          totalVolume: Number(confirmedAgg._sum.amount || 0),
          totalFeesEarned: Number(confirmedAgg._sum.feeAmount || 0),
          totalMerchants: merchantsTotal,
          activeMerchants: merchantsActive,
        });
      }

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
        // By default hide soft-deleted merchants (tombstoned email prefix). Pass ?includeDeleted=true to see them.
        const includeDeleted = req.query.includeDeleted === 'true';
        const merchants = await db.merchant.findMany({
          where: includeDeleted ? undefined : { email: { not: { startsWith: 'deleted+' } } },
          include: {
            wallets: true,
            _count: {
              select: { orders: true, stores: { where: { isArchived: false } } },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        // Aggregate confirmed order volume per merchant in one query
        const volumes = await db.order.groupBy({
          by: ['merchantId'],
          where: { status: 'CONFIRMED', merchantId: { not: null } },
          _sum: { amount: true },
          _count: { _all: true },
        });
        const volumeMap = new Map<string, { totalVolume: number; orderCount: number }>();
        for (const v of volumes) {
          if (!v.merchantId) continue;
          volumeMap.set(v.merchantId, {
            totalVolume: Number(v._sum.amount || 0),
            orderCount: v._count._all,
          });
        }

        const enrichedMerchants = merchants.map(m => ({
          ...m,
          totalVolume: volumeMap.get(m.id)?.totalVolume || 0,
          orderCount: volumeMap.get(m.id)?.orderCount || 0,
          storeCount: (m as any)._count?.stores ?? 0,
        }));
        return res.json(enrichedMerchants);

      case 'stores':
        if (!merchantId || typeof merchantId !== 'string') {
          return res.status(400).json({ error: 'merchantId query param required' });
        }
        const stores = await db.store.findMany({
          where: { merchantId },
          orderBy: [{ isArchived: 'asc' }, { createdAt: 'desc' }],
          include: { _count: { select: { orders: true, paymentLinks: true, wallets: true } } },
        });
        // Never return webhookSecret to admin UI either.
        return res.json({ stores: stores.map(({ webhookSecret, ...rest }) => rest) });

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

    // Admin login — Step 1: validate password, send 2FA code
    if (resource === 'login') {
      const { email, password } = req.body;
      const matched = await verifyAdminPassword(password);

      if (matched) {
        // Generate 6-digit 2FA code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const sessionId = crypto.randomBytes(16).toString('hex');
        pending2FA.set(sessionId, { code, expiresAt: Date.now() + 10 * 60 * 1000, email });

        // Send code via email
        const adminEmail = process.env.ADMIN_EMAIL || email;
        try {
          const { Resend } = await import('resend');
          const resend = new Resend(process.env.RESEND_API_KEY);
          const fromEmail = (process.env.FROM_EMAIL || 'StablePay <hello@wetakestables.shop>').trim();
          await resend.emails.send({
            from: fromEmail, to: adminEmail,
            subject: `StablePay Admin: ${code}`,
            html: `<div style="font-family:system-ui;max-width:400px;margin:0 auto;padding:24px;text-align:center;"><h2 style="margin-bottom:8px;">Admin Login Code</h2><div style="font-size:36px;font-weight:900;letter-spacing:8px;background:#f1f5f9;padding:16px;border:2px solid #000;margin:16px 0;">${code}</div><p style="color:#666;font-size:13px;">Expires in 10 minutes. Don't share this code.</p></div>`,
          });
        } catch (emailErr) {
          console.error('2FA email send error:', emailErr);
          console.log(`[2FA] Code for ${adminEmail}: ${code}`);
        }

        logger.info('Admin 2FA code sent', { email: adminEmail, event: 'admin.2fa_sent' });
        return res.json({ success: true, requires2FA: true, sessionId, message: 'Verification code sent to your email' });
      } else {
        logger.warn('Admin login failed', { email, event: 'admin.login_failed' });
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }

    // Admin login — Step 2: verify 2FA code
    if (resource === 'verify-2fa') {
      const { sessionId, code } = req.body;
      const pending = pending2FA.get(sessionId);

      if (!pending) return res.status(400).json({ error: 'Invalid or expired session' });
      if (Date.now() > pending.expiresAt) {
        pending2FA.delete(sessionId);
        return res.status(400).json({ error: 'Code expired. Please login again.' });
      }
      if (pending.code !== code) {
        return res.status(401).json({ error: 'Invalid code' });
      }

      pending2FA.delete(sessionId);
      const token = await getAdminKey();
      logger.info('Admin 2FA verified', { email: pending.email, event: 'admin.2fa_verified' });
      return res.json({ success: true, token });
    }

    // For non-login resources, verify admin key.
    // Bug fix: getAdminKey is async — comparing a string to a Promise always diverges, so the old
    // check silently 401'd every non-login POST. Await the expected key before comparing.
    const authHeader = req.headers['authorization'] as string | undefined;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    // Header-only: never accept admin key from req.body (would leak in logs).
    const providedKey = req.headers['x-admin-key'] || bearerToken;
    const expectedAdminKey = await getAdminKey();
    if (!providedKey || providedKey !== expectedAdminKey) {
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
          networkMode: networkMode || 'MAINNET', // full production — testnet retired
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
      const { merchantId, isActive, plan, networkMode, paymentMode, customFeePercent } = req.body;

      if (!merchantId) {
        return res.status(400).json({ error: 'merchantId is required' });
      }

      // If activating merchant, generate login token
      let updateData: any = {
        ...(typeof isActive !== 'undefined' && { isActive }),
        ...(plan && { plan }),
        ...(networkMode && { networkMode }),
        ...(paymentMode && { paymentMode }),
        ...(customFeePercent !== undefined && { customFeePercent: customFeePercent }),
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
            const BASE_URL = process.env.BASE_URL || 'https://wetakestables.shop';
            const FROM_EMAIL = process.env.FROM_EMAIL || 'StablePay <hello@wetakestables.shop>';

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

// DELETE merchant — soft delete (preserves order/refund/wallet history).
// Set ?hard=true to force a real delete, which fails if any FK references exist.
router.delete('/', requireAdminKey, async (req, res) => {
  try {
    const { resource, hard } = req.query;
    const { merchantId } = req.body;

    if (resource === 'merchants' && merchantId) {
      const id = merchantId as string;

      if (hard === 'true') {
        await db.merchant.delete({ where: { id } });
        return res.json({ success: true, mode: 'hard' });
      }

      // Soft delete: deactivate + tombstone identifying fields so a new merchant can reuse the email.
      const existing = await db.merchant.findUnique({ where: { id }, select: { email: true, isActive: true } });
      if (!existing) return res.status(404).json({ error: 'Merchant not found' });

      // Strip any prior tombstone prefixes so we don't keep nesting on repeated deletes.
      const cleanEmail = existing.email.replace(/^(deleted\+\d+\+)+/, '');
      const tombstone = `deleted+${Date.now()}+${cleanEmail}`;
      await db.merchant.update({
        where: { id },
        data: {
          isActive: false,
          email: tombstone, // free up email for reuse; original email is preserved as suffix
        },
      });

      logger.info('Merchant soft-deleted', { merchantId: id, originalEmail: existing.email, event: 'admin.merchant_deleted' });
      return res.json({ success: true, mode: 'soft' });
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

    await logAdminAction(req, 'admin', {
      action: 'refund.approve',
      resource: 'refund',
      resourceId: id,
      before: { status: refund.status },
      after: { status: 'APPROVED', approvedBy: 'admin' },
    });

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

    await logAdminAction(req, 'admin', {
      action: 'refund.reject',
      resource: 'refund',
      resourceId: id,
      before: { status: refund.status },
      after: { status: 'REJECTED', approvedBy: 'admin' },
      reason,
    });

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

    await logAdminAction(req, 'admin', {
      action: 'refund.process',
      resource: 'refund',
      resourceId: id,
      before: { status: refund.status },
      after: { status: 'PROCESSED', refundTxHash: txHash },
    });

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
// ADMIN MANUAL ORDER CONFIRMATION
// ============================================================================

// Manually confirm a stuck PENDING order. Use when scanner missed a TX (e.g. lookback expired,
// merchant's scanner was offline). Mirrors the confirmOrder path: writes Transaction, flips status,
// fires webhook, accrues fees. Every call is audited.
router.post('/orders/:orderId/confirm', requireAdminKey, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { txHash, reason } = req.body as { txHash?: string; reason?: string };
    if (!reason || reason.trim().length < 3) {
      return res.status(400).json({ error: 'reason (≥3 chars) required for audit trail' });
    }

    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'PENDING') {
      return res.status(400).json({ error: `Order is ${order.status}, cannot manually confirm` });
    }

    // Extend expiry if already past, so the atomic guard inside confirmOrder accepts it.
    if (order.expiresAt < new Date()) {
      await db.order.update({
        where: { id: orderId },
        data: { expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
    }

    const { OrderService } = await import('../services/orderService');
    const result = await new OrderService().confirmOrder(orderId, txHash ? { txHash } : undefined);

    await logAdminAction(req, 'admin', {
      action: 'order.confirm_manual',
      resource: 'order',
      resourceId: orderId,
      before: { status: order.status },
      after: { status: 'CONFIRMED', txHash: txHash || null },
      reason,
    });

    logger.security('Order manually confirmed by admin', {
      orderId,
      txHash,
      reason,
      event: 'admin.order_manual_confirm',
    });

    res.json({ success: true, order: serializeBigInt(result) });
  } catch (error) {
    logger.error('Admin manual confirm error', error as Error, { orderId: req.params.orderId });
    res.status(500).json({ error: 'Failed to confirm order', details: error instanceof Error ? error.message : String(error) });
  }
});

// List admin audit trail (paginated, filterable)
router.get('/audit', requireAdminKey, async (req, res) => {
  try {
    const { actor, resource, resourceId, action, limit = '100' } = req.query as Record<string, string>;
    const take = Math.min(parseInt(limit) || 100, 500);

    const actions = await db.adminAction.findMany({
      where: {
        ...(actor && { actor }),
        ...(resource && { resource }),
        ...(resourceId && { resourceId }),
        ...(action && { action }),
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    res.json({ actions });
  } catch (error) {
    logger.error('Audit list error', error as Error);
    res.status(500).json({ error: 'Failed to list audit events' });
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

// One-time fix (RETIRED): the moddatetime trigger cleanup ran long ago. The handler held the
// repo's only $queryRawUnsafe (interpolated trigger name) — removed rather than parameterized.
router.post('/fix-triggers', requireAdminKey, async (_req, res) => {
  res.status(410).json({ error: 'Retired — one-time migration already applied' });
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

// ─── Managed Wallets Admin ──────────────────────────────────────────────────

// List all managed wallets with merchant info
router.get('/managed-wallets', requireAdminKey, async (req, res) => {
  try {
    const wallets = await db.managedWallet.findMany({
      where: { isActive: true },
      include: {
        merchant: {
          select: { id: true, email: true, companyName: true, plan: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      total: wallets.length,
      wallets: wallets.map(w => ({
        id: w.id,
        merchantId: w.merchantId,
        merchantEmail: w.merchant.email,
        merchantName: w.merchant.companyName,
        chain: w.chain,
        address: w.address,
        migratedToOwn: w.migratedToOwn,
        createdAt: w.createdAt,
      }))
    });
  } catch (error) {
    console.error('Admin managed wallets error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sweep funds from a managed wallet to a destination address
router.post('/managed-wallets/:walletId/sweep', requireAdminKey, async (req, res) => {
  try {
    const { walletId } = req.params;
    const { toAddress, chain, token } = req.body;

    if (!toAddress) {
      return res.status(400).json({ error: 'toAddress required' });
    }

    const managedWallet = await db.managedWallet.findUnique({
      where: { id: walletId },
    });

    if (!managedWallet) {
      return res.status(404).json({ error: 'Managed wallet not found' });
    }

    // Decrypt and sweep
    const { ethers } = await import('ethers');
    const crypto = await import('crypto');

    // See refundService.ts for the rationale on the dedicated wallet-encryption key.
    const ENCRYPTION_KEY = process.env.MANAGED_WALLET_ENCRYPTION_KEY
      || process.env.JWT_SECRET
      || process.env.AGENT_WALLET_KEY;
    if (!ENCRYPTION_KEY) {
      return res.status(500).json({ error: 'Encryption key not configured' });
    }

    function decryptKey(encrypted: string): string {
      const [ivHex, encData] = encrypted.split(':');
      const iv = Buffer.from(ivHex, 'hex');
      const key = crypto.scryptSync(ENCRYPTION_KEY!, 'salt', 32);
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }

    const CHAIN_RPC: Record<string, { rpc: string; usdc: string }> = {
      BASE_MAINNET: { rpc: process.env.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
      ETHEREUM_MAINNET: { rpc: process.env.ETHEREUM_MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com', usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
      POLYGON_MAINNET: { rpc: process.env.POLYGON_MAINNET_RPC_URL || 'https://polygon-bor-rpc.publicnode.com', usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
      ARBITRUM_MAINNET: { rpc: process.env.ARBITRUM_MAINNET_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com', usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
    };

    const sweepChain = chain || managedWallet.chain;
    const chainConf = CHAIN_RPC[sweepChain];
    if (!chainConf) {
      return res.status(400).json({ error: `Unsupported chain: ${sweepChain}` });
    }

    const privateKey = decryptKey(managedWallet.encryptedKey);
    const provider = new ethers.JsonRpcProvider(chainConf.rpc);
    const wallet = new ethers.Wallet(privateKey, provider);
    const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function transfer(address, uint256) returns (bool)'];
    const tokenContract = new ethers.Contract(chainConf.usdc, ERC20_ABI, wallet);

    // Get full balance
    const balance = await tokenContract.balanceOf(managedWallet.address);
    if (balance === 0n) {
      return res.json({ success: true, message: 'No balance to sweep', amount: '0' });
    }

    // Transfer all
    const tx = await tokenContract.transfer(toAddress, balance);
    const formatted = ethers.formatUnits(balance, 6);

    logger.info('Admin sweep executed', {
      walletId,
      from: managedWallet.address,
      to: toAddress,
      amount: formatted,
      chain: sweepChain,
      txHash: tx.hash,
    });

    res.json({
      success: true,
      txHash: tx.hash,
      amount: formatted,
      from: managedWallet.address,
      to: toAddress,
      chain: sweepChain,
    });
  } catch (error: any) {
    console.error('Admin sweep error:', error);
    res.status(500).json({ error: 'Sweep failed: ' + error.message });
  }
});

// Change admin password in-app
router.post('/change-password', requireAdminKey, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both currentPassword and newPassword required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const currentMatched = await verifyAdminPassword(currentPassword);
    if (!currentMatched) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await db.systemConfig.upsert({
      where: { key: 'admin_password' },
      update: { value: hash },
      create: { key: 'admin_password', value: hash },
    });

    await logAdminAction(req, 'admin', {
      action: 'admin.password_changed',
      resource: 'system',
      resourceId: 'admin_password',
    });
    logger.info('Admin password changed', { event: 'admin.password_changed' });
    res.json({ success: true, message: 'Password changed. Use new password on next login.' });
  } catch (error) {
    logger.error('Change password error', error as Error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// GET agent wallet status — balances across all chains
router.get('/agent-wallets', requireAdminKey, async (req, res) => {
  try {
    const evmAddress = process.env.AGENT_WALLET_ADDRESS?.trim();
    const solAddress = process.env.AGENT_SOLANA_ADDRESS?.trim();

    const CHAINS: Record<string, { rpc: string; native: string; tokens: Record<string, string> }> = {
      BASE: { rpc: process.env.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org', native: 'ETH', tokens: { USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2' } },
      ETHEREUM: { rpc: process.env.ETHEREUM_MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com', native: 'ETH', tokens: { USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7' } },
      POLYGON: { rpc: process.env.POLYGON_MAINNET_RPC_URL || 'https://polygon-bor-rpc.publicnode.com', native: 'MATIC', tokens: { USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' } },
      ARBITRUM: { rpc: process.env.ARBITRUM_MAINNET_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com', native: 'ETH', tokens: { USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' } },
      BNB: { rpc: process.env.BNB_MAINNET_RPC_URL || 'https://bsc-dataseed.binance.org', native: 'BNB', tokens: { USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', USDT: '0x55d398326f99059fF775485246999027B3197955' } },
    };

    const ERC20 = ['function balanceOf(address) view returns (uint256)'];
    const evmChains: any[] = [];

    if (evmAddress) {
      for (const [chain, conf] of Object.entries(CHAINS)) {
        try {
          const provider = new ethers.JsonRpcProvider(conf.rpc);
          const nativeRaw = await provider.getBalance(evmAddress);
          const nativeBalance = ethers.formatEther(nativeRaw);

          const tokens: Record<string, string> = {};
          for (const [token, addr] of Object.entries(conf.tokens)) {
            try {
              const contract = new ethers.Contract(addr, ERC20, provider);
              const raw = await contract.balanceOf(evmAddress);
              tokens[token] = ethers.formatUnits(raw, 6);
            } catch { tokens[token] = '0'; }
          }

          evmChains.push({ chain, native: conf.native, nativeBalance, tokens });
        } catch (err: any) {
          evmChains.push({ chain, error: err.message });
        }
      }
    }

    // Solana balances
    let solana: any = null;
    if (solAddress) {
      try {
        const solRes = await fetch('https://api.mainnet-beta.solana.com', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [solAddress] })
        });
        const solData: any = await solRes.json();
        const solBalance = (solData.result?.value || 0) / 1e9;

        // SPL token balances
        const tokenRes = await fetch('https://api.mainnet-beta.solana.com', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 2, method: 'getTokenAccountsByOwner',
            params: [solAddress, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]
          })
        });
        const tokenData: any = await tokenRes.json();

        const MINTS: Record<string, string> = {
          'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
          'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
          'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr': 'EURC',
        };

        const tokens: Record<string, number> = {};
        for (const acc of (tokenData.result?.value || [])) {
          const info = acc.account?.data?.parsed?.info;
          if (info) {
            const name = MINTS[info.mint];
            if (name) tokens[name] = (tokens[name] || 0) + (info.tokenAmount?.uiAmount || 0);
          }
        }

        solana = { address: solAddress, solBalance, tokens };
      } catch (err: any) {
        solana = { address: solAddress, error: err.message };
      }
    }

    // Managed wallets count
    const managedWalletCount = await db.managedWallet.count();

    res.json({
      evm: { address: evmAddress || 'NOT SET', chains: evmChains },
      solana: solana || { address: 'NOT SET' },
      managedWallets: managedWalletCount,
      configured: { evmKey: !!process.env.AGENT_WALLET_KEY, solKey: !!process.env.AGENT_SOLANA_KEY },
    });
  } catch (error: any) {
    console.error('Agent wallet status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GROWTH TASKS (admin-only personal accountability tracker)
// ═══════════════════════════════════════════════════════════════════

// GET growth tasks — optionally filtered by status/category
router.get('/growth-tasks', requireAdminKey, async (req, res) => {
  try {
    const { status, category } = req.query;
    const where: any = {};
    if (status) where.status = status as string;
    if (category) where.category = category as string;
    const tasks = await db.growthTask.findMany({
      where,
      orderBy: [{ status: 'asc' }, { priority: 'asc' }, { week: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ tasks, count: tasks.length });
  } catch (err) {
    logger.error('GET growth tasks failed', err as Error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// POST create a new task
router.post('/growth-tasks', requireAdminKey, async (req, res) => {
  try {
    const { title, description, category, week, priority, dueDate } = req.body;
    if (!title || !category) return res.status(400).json({ error: 'title and category required' });
    const task = await db.growthTask.create({
      data: {
        title,
        description: description || null,
        category,
        week: week ?? null,
        priority: priority ?? 3,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
    });
    res.json(task);
  } catch (err) {
    logger.error('POST growth task failed', err as Error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// PATCH update a task — mostly used for marking done, status change, adding notes
router.patch('/growth-tasks/:id', requireAdminKey, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, week, priority, status, notes, dueDate } = req.body;
    const data: any = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (category !== undefined) data.category = category;
    if (week !== undefined) data.week = week;
    if (priority !== undefined) data.priority = priority;
    if (notes !== undefined) data.notes = notes;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (status !== undefined) {
      data.status = status;
      // Stamp completedAt when marking done
      if (status === 'done') data.completedAt = new Date();
      // Clear completedAt if un-doing
      if (status === 'todo' || status === 'doing') data.completedAt = null;
    }
    const task = await db.growthTask.update({ where: { id }, data });
    res.json(task);
  } catch (err) {
    logger.error('PATCH growth task failed', err as Error, { taskId: req.params.id });
    res.status(500).json({ error: 'Internal error' });
  }
});

// DELETE a task (soft via archive)
router.delete('/growth-tasks/:id', requireAdminKey, async (req, res) => {
  try {
    await db.growthTask.update({ where: { id: req.params.id }, data: { status: 'archived' } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// FEE RATE MATRIX
// ═══════════════════════════════════════════════════════════════════

// GET fee tiers (current config)
router.get('/fee-tiers', requireAdminKey, async (_req, res) => {
  try {
    const config = await db.systemConfig.findUnique({ where: { key: 'fee_tiers' } });
    const { DEFAULT_VOLUME_TIERS, VOLUME_TIERS } = await import('../config/pricing');
    res.json({
      current: VOLUME_TIERS,
      defaults: DEFAULT_VOLUME_TIERS,
      source: config ? 'database' : 'default',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load fee tiers' });
  }
});

// PUT fee tiers (update all 4 brackets)
router.put('/fee-tiers', requireAdminKey, async (req, res) => {
  try {
    const { tiers } = req.body;
    if (!Array.isArray(tiers) || tiers.length !== 4) {
      return res.status(400).json({ error: 'Must provide exactly 4 tiers' });
    }
    // Validate each tier has feePercent as number between 0 and 1
    for (const t of tiers) {
      if (typeof t.feePercent !== 'number' || t.feePercent < 0 || t.feePercent > 1) {
        return res.status(400).json({ error: `Invalid feePercent: ${t.feePercent}. Must be 0-1 (e.g. 0.025 = 2.5%)` });
      }
    }

    await db.systemConfig.upsert({
      where: { key: 'fee_tiers' },
      update: { value: JSON.stringify(tiers) },
      create: { key: 'fee_tiers', value: JSON.stringify(tiers) },
    });

    // Reload in-memory tiers
    const { loadFeeTiersFromDB } = await import('../config/pricing');
    await loadFeeTiersFromDB();

    logger.info('Fee tiers updated', { tiers, event: 'admin.fee_tiers_updated' });
    res.json({ success: true, tiers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update fee tiers' });
  }
});

// PUT custom fee rate for a specific merchant
router.put('/merchant-fee/:merchantId', requireAdminKey, async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { customFeePercent } = req.body; // null to remove, or decimal like 0.015

    if (customFeePercent !== null && customFeePercent !== undefined) {
      if (typeof customFeePercent !== 'number' || customFeePercent < 0 || customFeePercent > 1) {
        return res.status(400).json({ error: 'customFeePercent must be 0-1 (e.g. 0.015 = 1.5%) or null to remove' });
      }
    }

    const updated = await db.merchant.update({
      where: { id: merchantId },
      data: { customFeePercent: customFeePercent ?? null },
      select: { id: true, companyName: true, customFeePercent: true },
    });

    logger.info('Merchant custom fee updated', { merchantId, customFeePercent, event: 'admin.merchant_fee_updated' });
    res.json({ success: true, merchant: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update merchant fee' });
  }
});

// ─── Stablo chat logs ─────────────────────────────────────────────────────
// GET /api/v1/admin/stablo/chats — recent conversations grouped by order
router.get('/stablo/chats', requireAdminKey, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    // Get distinct conversations (order-bound OR pre-order session chats), most recent first
    const recentConvos = await db.stabloChat.groupBy({
      by: ['orderId', 'sessionId'],
      orderBy: { _max: { createdAt: 'desc' } },
      take: limit,
      skip: offset,
    });

    if (!recentConvos.length) return res.json({ conversations: [], total: 0 });

    const orderIds = [...new Set(recentConvos.map(r => r.orderId).filter((x): x is string => !!x))];
    const sessionIds = [...new Set(recentConvos.map(r => r.sessionId).filter((x): x is string => !!x))];
    const chatFilters = [];
    if (orderIds.length) chatFilters.push({ orderId: { in: orderIds } });
    if (sessionIds.length) chatFilters.push({ sessionId: { in: sessionIds } });

    const [chats, orders, total] = await Promise.all([
      db.stabloChat.findMany({
        where: { OR: chatFilters },
        orderBy: { createdAt: 'asc' },
      }),
      db.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, amount: true, token: true, chain: true, status: true, customerEmail: true, createdAt: true, merchantId: true },
      }),
      db.stabloChat.groupBy({ by: ['orderId', 'sessionId'] }).then(r => r.length),
    ]);

    const orderMap = new Map(orders.map(o => [o.id, o]));
    // Conversation key: order-bound chats group by order; pre-order chats group by session.
    const keyOf = (m: { orderId: string | null; sessionId: string | null }) =>
      m.orderId ? `o:${m.orderId}` : `s:${m.sessionId || 'anon'}`;
    const chatMap = new Map<string, typeof chats>();
    for (const msg of chats) {
      const k = keyOf(msg);
      if (!chatMap.has(k)) chatMap.set(k, []);
      chatMap.get(k)!.push(msg);
    }

    const seen = new Set<string>();
    const conversations = recentConvos.flatMap(rc => {
      const k = keyOf(rc);
      if (seen.has(k)) return []; // same order with/without sessionId rows — one conversation
      seen.add(k);
      return [{
        orderId: rc.orderId || null,
        sessionId: rc.sessionId || null,
        order: rc.orderId ? (orderMap.get(rc.orderId) || null) : null,
        messages: chatMap.get(k) || [],
      }];
    });

    res.json({ conversations, total });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Stablo chats' });
  }
});

// ─── Conversion Funnel & Native Token Activity ─────────────────────────────
// GET /api/v1/admin/funnel?days=7 — order conversion breakdown by merchant + chain
router.get('/funnel', requireAdminKey, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 90);
    const since = new Date(Date.now() - days * 86_400_000);

    // Aggregate orders by merchant, chain, status
    const rows = await db.order.groupBy({
      by: ['merchantId', 'chain', 'status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { amount: true },
    });

    // Pull merchant names
    const merchantIds = [...new Set(rows.map(r => r.merchantId).filter((x): x is string => !!x))];
    const merchants = await db.merchant.findMany({
      where: { id: { in: merchantIds } },
      select: { id: true, companyName: true, email: true },
    });
    const mMap = new Map(merchants.map(m => [m.id, m]));

    // Pivot: { merchantId, chain } → { confirmed, expired, cancelled, pending, ... }
    type Key = string;
    const pivot = new Map<Key, { merchantId: string | null; chain: string; companyName: string; email: string; counts: Record<string, number>; volume: number }>();
    for (const r of rows) {
      const key = `${r.merchantId}|${r.chain}`;
      if (!pivot.has(key)) {
        const m = r.merchantId ? mMap.get(r.merchantId) : null;
        pivot.set(key, {
          merchantId: r.merchantId, chain: r.chain,
          companyName: m?.companyName ?? 'DEMO/Unknown',
          email:       m?.email ?? '—',
          counts: {}, volume: 0,
        });
      }
      const cell = pivot.get(key)!;
      cell.counts[r.status] = r._count._all;
      if (r.status === 'CONFIRMED') cell.volume = Number(r._sum.amount ?? 0);
    }

    // Compute conversion rate and sort by total volume of attempts
    const result = [...pivot.values()].map(r => {
      const total     = Object.values(r.counts).reduce((s, n) => s + n, 0);
      const confirmed = r.counts.CONFIRMED ?? 0;
      const expired   = r.counts.EXPIRED   ?? 0;
      const cancelled = r.counts.CANCELLED ?? 0;
      const pending   = r.counts.PENDING   ?? 0;
      const processing= r.counts.PROCESSING?? 0;
      const conversionPct = total > 0 ? (confirmed / total) * 100 : 0;
      return { ...r, total, confirmed, expired, cancelled, pending, processing, conversionPct };
    }).sort((a, b) => b.total - a.total);

    res.json({ since: since.toISOString(), days, rows: result });
  } catch (error) {
    logger.error('funnel endpoint error', error as Error, {});
    res.status(500).json({ error: 'Failed to compute funnel' });
  }
});

// GET /api/v1/admin/native-activity?days=14 — native token order timeline
router.get('/native-activity', requireAdminKey, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 14, 1), 90);
    const since = new Date(Date.now() - days * 86_400_000);

    const orders = await db.order.findMany({
      where: { nativeToken: { not: null }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, status: true, chain: true, nativeToken: true,
        amount: true, conversionFeeAmount: true, nativePriceSnapshot: true,
        nativeTokenAmount: true, paymentAddress: true,
        createdAt: true, updatedAt: true, expiresAt: true,
        merchantId: true,
      },
    });

    const merchantIds = [...new Set(orders.map(o => o.merchantId).filter((x): x is string => !!x))];
    const merchants = await db.merchant.findMany({
      where: { id: { in: merchantIds } },
      select: { id: true, companyName: true, email: true },
    });
    const mMap = new Map(merchants.map(m => [m.id, m]));

    // Aggregate stats
    const byStatus: Record<string, number> = {};
    for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

    res.json({
      days, since: since.toISOString(),
      total: orders.length,
      byStatus,
      orders: orders.map(o => ({
        ...o,
        merchant: o.merchantId ? mMap.get(o.merchantId) ?? null : null,
        amount: Number(o.amount),
        conversionFeeAmount: o.conversionFeeAmount ? Number(o.conversionFeeAmount) : null,
        nativePriceSnapshot: o.nativePriceSnapshot ? Number(o.nativePriceSnapshot) : null,
        nativeTokenAmount:   o.nativeTokenAmount   ? Number(o.nativeTokenAmount)   : null,
      })),
    });
  } catch (error) {
    logger.error('native-activity endpoint error', error as Error, {});
    res.status(500).json({ error: 'Failed to fetch native activity' });
  }
});

// ─── Widget Events (session-level telemetry) ──────────────────────────────
router.get('/widget-events', requireAdminKey, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
    const action = (req.query.action as string) || undefined;
    const merchantId = (req.query.merchantId as string) || undefined;
    const hours = parseInt(req.query.hours as string) || 24;

    const where: any = { createdAt: { gte: new Date(Date.now() - hours * 3600_000) } };
    if (action) where.action = action;
    if (merchantId) where.merchantId = merchantId;

    const events = await db.widgetEvent.findMany({
      where, orderBy: { createdAt: 'desc' }, take: limit,
    });

    // Aggregate by action
    const counts: Record<string, number> = {};
    const allCounts = await db.widgetEvent.groupBy({
      by: ['action'],
      where: { createdAt: { gte: new Date(Date.now() - hours * 3600_000) } },
      _count: true,
    });
    for (const r of allCounts) counts[r.action] = r._count;

    // Pull merchant names
    const mids = [...new Set(events.map(e => e.merchantId).filter((x): x is string => !!x))];
    const ms = mids.length > 0
      ? await db.merchant.findMany({ where: { id: { in: mids } }, select: { id: true, companyName: true } })
      : [];
    const mMap = new Map(ms.map(m => [m.id, m.companyName]));

    res.json({
      hours, counts,
      events: events.map(e => ({ ...e, merchantName: e.merchantId ? mMap.get(e.merchantId) ?? null : null })),
    });
  } catch (error) {
    logger.error('widget-events endpoint', error as Error, {});
    res.status(500).json({ error: 'Failed to load events' });
  }
});

// ─── Email Logs ───────────────────────────────────────────────────────────
router.get('/email-logs', requireAdminKey, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const status = (req.query.status as string) || undefined;
    const days = parseInt(req.query.days as string) || 30;

    const where: any = { createdAt: { gte: new Date(Date.now() - days * 86400_000) } };
    if (status) where.status = status;

    const [logs, summary] = await Promise.all([
      db.emailLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
      db.emailLog.groupBy({
        by: ['status'],
        where: { createdAt: { gte: new Date(Date.now() - days * 86400_000) } },
        _count: true,
      }),
    ]);

    const counts: Record<string, number> = {};
    for (const r of summary) counts[r.status] = r._count;

    res.json({ days, counts, logs });
  } catch (error) {
    logger.error('email-logs endpoint', error as Error, {});
    res.status(500).json({ error: 'Failed to load logs' });
  }
});

// ─── Stranded Native-Token Funds ──────────────────────────────────────────
// Lists NativeReceiveWallets whose order is not CONFIRMED but on-chain balance > 0.
// Slow endpoint (one RPC call per wallet) — bounded to recent 7 days.
router.get('/stranded-funds', requireAdminKey, async (_req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 86400_000);
    const wallets = await db.nativeReceiveWallet.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { order: { select: { id: true, status: true, chain: true, nativeToken: true, amount: true, customerEmail: true, customerName: true, customerWallet: true, merchantId: true, createdAt: true, expiresAt: true, paymentAddress: true, nativeTokenAmount: true, nativePriceSnapshot: true, conversionFeeAmount: true } } },
    });

    const { ethers } = await import('ethers');
    const RPC: Record<string, string> = {
      BASE_MAINNET:     'https://mainnet.base.org',
      ETHEREUM_MAINNET: 'https://ethereum-rpc.publicnode.com',
      POLYGON_MAINNET:  'https://polygon-bor-rpc.publicnode.com',
      ARBITRUM_MAINNET: 'https://arbitrum-one-rpc.publicnode.com',
      BNB_MAINNET:      'https://bsc-dataseed.binance.org',
    };

    const rows = await Promise.all(wallets.map(async (w) => {
      const chain = w.chain;
      let balance = 0;
      try {
        if (chain.startsWith('SOLANA')) {
          const r = await fetch('https://api.mainnet-beta.solana.com', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [w.address] }),
            signal: AbortSignal.timeout(5_000),
          });
          const j = await r.json() as any;
          balance = (j?.result?.value ?? 0) / 1e9;
        } else if (RPC[chain]) {
          const p = new ethers.JsonRpcProvider(RPC[chain]);
          const wei = await p.getBalance(w.address);
          balance = Number(ethers.formatEther(wei));
          p.destroy();
        }
      } catch { /* RPC error → skip */ }
      return { wallet: w, balance };
    }));

    // Only return ones with real funds (above dust) AND not CONFIRMED
    const stranded = rows.filter(r => r.balance > 0.0001 && r.wallet.order.status !== 'CONFIRMED');

    res.json({
      total: stranded.length,
      stranded: stranded.map(r => ({
        orderId:    r.wallet.order.id,
        address:    r.wallet.address,
        chain:      r.wallet.chain,
        balance:    r.balance,
        nativeToken: r.wallet.order.nativeToken,
        orderStatus: r.wallet.order.status,
        amount:      Number(r.wallet.order.amount),
        expectedAmt: r.wallet.order.nativeTokenAmount ? Number(r.wallet.order.nativeTokenAmount) : null,
        customerEmail: r.wallet.order.customerEmail,
        customerWallet: r.wallet.order.customerWallet,
        createdAt:   r.wallet.createdAt,
        expiresAt:   r.wallet.order.expiresAt,
      })),
    });
  } catch (error) {
    logger.error('stranded-funds endpoint', error as Error, {});
    res.status(500).json({ error: 'Failed to scan stranded funds' });
  }
});

// Force-trigger swap + forward for a specific order (admin override; bypasses scanner timing).
router.post('/orders/:orderId/force-swap', requireAdminKey, async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.nativeToken) return res.status(400).json({ error: 'Not a native token order' });

    // Allow force-swap even for EXPIRED orders (admin override for late payments)
    if (!['PENDING', 'EXPIRED', 'PROCESSING'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot force-swap order in status ${order.status}` });
    }
    // Re-mark as PENDING so swapAndForward's PROCESSING claim succeeds — but CONDITIONALLY, guarded
    // on the snapshot status+updatedAt, so we never stomp a swap the live scanner / recovery loop is
    // running right now (an unconditional flip would re-open the double-swap window).
    if (order.status !== 'PENDING') {
      const reopened = await db.order.updateMany({
        where: { id: orderId, status: order.status as any, updatedAt: order.updatedAt },
        data: { status: 'PENDING' },
      });
      if (reopened.count === 0) {
        return res.status(409).json({ error: 'Order is actively processing or just changed — retry in a moment' });
      }
    }
    const { swapAndForward } = await import('../services/swapService');
    const result = await swapAndForward(orderId);

    // Forward succeeded (merchant paid). Persist the durable success marker BEFORE confirming so a
    // confirm failure leaves an AUTO-RECONCILABLE order (recovery branch A) instead of a false 500 —
    // mirrors the scanner + recovery loop.
    try {
      const o = await db.order.findUnique({ where: { id: orderId }, select: { metadata: true } });
      const m: any = (o?.metadata && typeof o.metadata === 'object') ? { ...(o.metadata as any) } : {};
      m.recovery = { ...(m.recovery || {}), lastForwardTxHash: result.forwardTxHash, resolved: 'swapped', resolvedAt: new Date().toISOString() };
      await db.order.update({ where: { id: orderId }, data: { metadata: m } });
    } catch { /* metadata best-effort */ }

    const { OrderService } = await import('../services/orderService');
    try {
      await new OrderService().confirmOrder(orderId, { txHash: result.forwardTxHash });
    } catch (confirmErr: any) {
      logger.error('Admin force-swap: forwarded but confirm failed — will auto-reconcile', confirmErr as Error, { orderId, txHash: result.forwardTxHash });
    }

    logger.security('Admin force-swap', { orderId, txHash: result.forwardTxHash, event: 'admin.force_swap' });
    res.json({ success: true, txHash: result.forwardTxHash });
  } catch (error: any) {
    logger.error('force-swap', error as Error, {});
    res.status(500).json({ error: error.message || 'Force swap failed' });
  }
});

// Refund customer's native token from the NativeReceiveWallet back to a destination address.
// Sweeps everything (minus tx fee) — used when swap is impossible (e.g. token de-listed, customer requested cancellation).
router.post('/orders/:orderId/refund-native', requireAdminKey, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { destinationAddress } = req.body || {};
    if (!destinationAddress || typeof destinationAddress !== 'string') {
      return res.status(400).json({ error: 'destinationAddress required' });
    }

    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.nativeToken) return res.status(400).json({ error: 'Not a native token order' });

    const wallet = await db.nativeReceiveWallet.findUnique({ where: { orderId } });
    if (!wallet) return res.status(404).json({ error: 'No receive wallet found' });

    // Decrypt + sweep via the shared helper (uses decryptWalletKey/scrypt — the inline
    // sha256 decrypt here was wrong and never decrypted the stored key). Marks REFUNDED.
    const { refundNativeToAddress, isValidNativeAddress } = await import('../services/swapService');
    // Validate destination up front for a clean 400 (the helper also asserts before claiming REFUNDED).
    if (!isValidNativeAddress(destinationAddress, String(order.chain))) {
      return res.status(400).json({ error: `Invalid destination address for ${order.chain}` });
    }
    const { txHash, amount } = await refundNativeToAddress(orderId, destinationAddress);

    logger.security('Admin native refund', { orderId, destinationAddress, txHash, amount, event: 'admin.native_refund' });
    res.json({ success: true, txHash, amount });
  } catch (error: any) {
    logger.error('refund-native', error as Error, {});
    res.status(500).json({ error: error.message || 'Refund failed' });
  }
});

// ─── A/B test results: conversion rate by variant ─────────────────────────
// Aggregates WidgetEvent rows: for each session, find the assigned variant and
// whether the session ever fired a terminal action (PAY_CLICKED or NATIVE_TX_BROADCAST).
// Returns sessions per variant + conversion rate.
router.get('/ab-results', requireAdminKey, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 30);
    const since = new Date(Date.now() - days * 86_400_000);

    // Pull every event in window — we'll bucket per session in JS to keep query simple.
    const events = await db.widgetEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { sessionId: true, action: true, details: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Two conversion metrics:
    //  - "click rate":     pay attempt (PAY_CLICKED / NATIVE_TX_BROADCAST). Intent signal.
    //  - "purchase rate":  ORDER_CONFIRMED. True conversion (settled on-chain).
    const CLICK_ACTIONS    = new Set(['PAY_CLICKED', 'NATIVE_TX_BROADCAST']);
    const PURCHASE_ACTIONS = new Set(['ORDER_CONFIRMED']);

    type Sess = {
      variant: string | null; surface: string | null;
      opened: boolean; clicked: boolean; purchased: boolean;
      // wizardAnswered = pre-payment intent (wizard questions done).
      // wizardCompleted = post-payment success (order CONFIRMED while wizard active).
      // Drop-off = wizardAnswered - wizardCompleted.
      wizardAnswered: boolean; wizardCompleted: boolean; wizardSkipped: boolean;
      fastTxPasted: boolean; fastWalletPasted: boolean; fastEmailGiven: boolean;
    };
    const sessions = new Map<string, Sess>();
    for (const e of events) {
      const s = sessions.get(e.sessionId) ?? { variant: null, surface: null, opened: false, clicked: false, purchased: false, wizardAnswered: false, wizardCompleted: false, wizardSkipped: false, fastTxPasted: false, fastWalletPasted: false, fastEmailGiven: false };
      const det = (e.details || {}) as any;
      if (e.action === 'VARIANT_ASSIGNED') s.variant = det.variant ?? s.variant;
      if (det.surface && !s.surface) s.surface = det.surface; // 'widget' or 'page'
      if (e.action === 'WIDGET_OPENED') s.opened = true;
      if (CLICK_ACTIONS.has(e.action))    s.clicked = true;
      if (PURCHASE_ACTIONS.has(e.action)) s.purchased = true;
      if (e.action === 'WIZARD_ANSWERED')  s.wizardAnswered  = true;
      if (e.action === 'WIZARD_COMPLETED') s.wizardCompleted = true;
      if (e.action === 'WIZARD_SKIPPED')   s.wizardSkipped   = true;
      if (e.action === 'FAST_CONFIRMATION_PROVIDED') {
        const t = det.type;
        if (t === 'tx_hash') s.fastTxPasted = true;
        if (t === 'wallet')  s.fastWalletPasted = true;
        if (t === 'email')   s.fastEmailGiven = true;
      }
      sessions.set(e.sessionId, s);
    }

    const empty = () => ({ total: 0, clicked: 0, purchased: 0, wizardAnswered: 0, wizardCompleted: 0, wizardSkipped: 0, fastTxPasted: 0, fastWalletPasted: 0, fastEmailGiven: 0 });
    const VARIANTS = ['control', 'guided', 'fast'] as const;
    const buckets: any = { control: empty(), guided: empty(), fast: empty() };
    const bySurface: any = {
      widget: { control: empty(), guided: empty(), fast: empty() },
      page:   { control: empty(), guided: empty(), fast: empty() },
    };
    let unassigned = 0;
    for (const s of sessions.values()) {
      if (!s.variant || !VARIANTS.includes(s.variant as any)) { unassigned++; continue; }
      const v = s.variant as keyof typeof buckets;
      buckets[v].total++;
      if (s.clicked)          buckets[v].clicked++;
      if (s.purchased)        buckets[v].purchased++;
      if (s.wizardAnswered)   buckets[v].wizardAnswered++;
      if (s.wizardCompleted)  buckets[v].wizardCompleted++;
      if (s.wizardSkipped)    buckets[v].wizardSkipped++;
      if (s.fastTxPasted)     buckets[v].fastTxPasted++;
      if (s.fastWalletPasted) buckets[v].fastWalletPasted++;
      if (s.fastEmailGiven)   buckets[v].fastEmailGiven++;
      const surf = s.surface === 'page' ? 'page' : 'widget';
      bySurface[surf][v].total++;
      if (s.clicked)   bySurface[surf][v].clicked++;
      if (s.purchased) bySurface[surf][v].purchased++;
    }

    const pct = (n: number, d: number) => d > 0 ? +(100 * n / d).toFixed(2) : 0;
    const summarize = (b: any) => ({
      total: b.total,
      clicked: b.clicked,
      purchased: b.purchased,
      clickRatePct: pct(b.clicked, b.total),
      purchaseRatePct: pct(b.purchased, b.total),
      // wizardAnsweredPct: % who finished wizard answers (pre-payment intent).
      // wizardCompletionPct: % who actually purchased AFTER finishing the wizard.
      // Gap between these two = drop-off between intent and conversion.
      wizardAnswered: b.wizardAnswered,
      wizardCompleted: b.wizardCompleted,
      wizardSkipped: b.wizardSkipped,
      wizardAnsweredPct: pct(b.wizardAnswered, b.total),
      wizardCompletionPct: pct(b.wizardCompleted, b.total),
      skipPct: pct(b.wizardSkipped, b.total),
      // fast-variant signals (always present, zero for control/guided)
      fastTxPasted: b.fastTxPasted,
      fastWalletPasted: b.fastWalletPasted,
      fastEmailGiven: b.fastEmailGiven,
      fastTxPastedPct: pct(b.fastTxPasted, b.total),
      fastWalletPastedPct: pct(b.fastWalletPasted, b.total),
      fastEmailGivenPct: pct(b.fastEmailGiven, b.total),
    });

    res.json({
      days, since: since.toISOString(),
      totalSessions: sessions.size,
      unassigned,
      variants: {
        control: summarize(buckets.control),
        guided:  summarize(buckets.guided),
        fast:    summarize(buckets.fast),
      },
      bySurface: {
        widget: { control: summarize(bySurface.widget.control), guided: summarize(bySurface.widget.guided), fast: summarize(bySurface.widget.fast) },
        page:   { control: summarize(bySurface.page.control),   guided: summarize(bySurface.page.guided),   fast: summarize(bySurface.page.fast)   },
      },
    });
  } catch (error) {
    logger.error('ab-results endpoint', error as Error, {});
    res.status(500).json({ error: 'Failed to compute A/B results' });
  }
});

export const adminRouter = router;
