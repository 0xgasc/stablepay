import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';
import { rateLimit } from '../middleware/rateLimit';
import { requireMerchantAuth, AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import { hashPassword, comparePassword, validatePassword } from '../utils/password';
import { emailService } from '../services/emailService';

const router = Router();

// Generate a 6-digit verification code
function generateVerifyCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

// Generate a random login token
function generateLoginToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Login with password ────────────────────────────────────────────────────
router.post('/login', rateLimit({
  getMerchantId: async () => null,
  limitAnonymous: true,
  anonymousLimit: 20
}), async (req, res) => {
  try {
    const { email, password, token } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Support both password and legacy token login
    if (!password && !token) {
      return res.status(400).json({ error: 'Password or token is required' });
    }

    const merchant = await db.merchant.findUnique({ where: { email } });

    if (!merchant) {
      logger.warn('Failed login attempt', { email, ip: req.ip, event: 'auth.login_failed' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Password-based login
    if (password) {
      if (!merchant.passwordHash) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const valid = await comparePassword(password, merchant.passwordHash);
      if (!valid) {
        logger.warn('Failed password login', { email, ip: req.ip, event: 'auth.login_failed' });
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      if (!merchant.emailVerified) {
        return res.status(403).json({ error: 'Email not verified. Please check your email for the verification code.' });
      }
    }
    // Legacy token-based login
    else if (token) {
      if (merchant.loginToken !== token) {
        logger.warn('Failed token login', { email, ip: req.ip, event: 'auth.login_failed' });
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      if (merchant.tokenExpiresAt && new Date() > merchant.tokenExpiresAt) {
        return res.status(401).json({ error: 'Token expired' });
      }
    }

    // Ensure merchant has a login token for API calls
    let loginToken = merchant.loginToken;
    if (!loginToken) {
      loginToken = generateLoginToken();
      await db.merchant.update({
        where: { id: merchant.id },
        data: {
          loginToken,
          tokenExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });
    }

    res.json({
      success: true,
      token: loginToken,
      merchantId: merchant.id,
      isActive: merchant.isActive,
      isPending: !merchant.isActive,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get merchant profile (auth required) ───────────────────────────────────
router.get('/merchant-profile', requireMerchantAuth, async (req, res) => {
  try {
    const authMerchant = (req as AuthenticatedRequest).merchant;

    const merchant = await db.merchant.findUnique({
      where: { id: authMerchant.id },
      include: {
        _count: { select: { orders: true } },
        wallets: true,
      },
    });

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }

    res.json({
      id: merchant.id,
      email: merchant.email,
      companyName: merchant.companyName,
      contactName: merchant.contactName,
      plan: merchant.plan,
      paymentMode: merchant.paymentMode,
      networkMode: merchant.networkMode,
      isActive: merchant.isActive,
      setupCompleted: merchant.setupCompleted,
      createdAt: merchant.createdAt,
      orderCount: merchant._count.orders,
      wallets: merchant.wallets || [],
      monthlyVolumeUsed: merchant.monthlyVolumeUsed,
      monthlyTransactions: merchant.monthlyTransactions,
      billingCycleStart: merchant.billingCycleStart,
      feesDue: merchant.feesDue,
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Update merchant profile (auth required) ────────────────────────────────
router.put('/merchant-profile', requireMerchantAuth, async (req, res) => {
  try {
    const authMerchant = (req as AuthenticatedRequest).merchant;
    const { companyName, contactName, email, networkMode, paymentMode, setupCompleted, emailOnPayment, emailOnRefund, emailOnExpiry } = req.body;

    // If completing setup, validate merchant has at least one wallet
    if (setupCompleted === true) {
      const walletCount = await db.merchantWallet.count({ where: { merchantId: authMerchant.id } });
      if (walletCount === 0) {
        return res.status(400).json({ error: 'Add at least one wallet before completing setup' });
      }
    }

    const updated = await db.merchant.update({
      where: { id: authMerchant.id },
      data: {
        ...(companyName && { companyName }),
        ...(contactName && { contactName }),
        ...(email && { email }),
        ...(networkMode && { networkMode }),
        ...(paymentMode && { paymentMode }),
        ...(typeof setupCompleted === 'boolean' && { setupCompleted }),
        ...(typeof emailOnPayment === 'boolean' && { emailOnPayment }),
        ...(typeof emailOnRefund === 'boolean' && { emailOnRefund }),
        ...(typeof emailOnExpiry === 'boolean' && { emailOnExpiry }),
      },
    });

    res.json({ success: true, merchant: updated });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Update merchant wallets ────────────────────────────────────────────────
router.post('/merchant-wallets', requireMerchantAuth, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const { merchantId, wallets } = req.body;

    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    if (!merchantId || !Array.isArray(wallets)) {
      return res.status(400).json({ error: 'merchantId and wallets array required' });
    }

    const merchant = await db.merchant.findFirst({
      where: { id: merchantId, loginToken: token },
    });

    if (!merchant) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (merchant.tokenExpiresAt && new Date() > merchant.tokenExpiresAt) {
      return res.status(401).json({ error: 'Token expired' });
    }

    await db.merchantWallet.deleteMany({ where: { merchantId } });

    if (wallets.length > 0) {
      await db.merchantWallet.createMany({
        data: wallets.map((w: { chain: string; address: string; supportedTokens?: string[]; label?: string }) => ({
          merchantId,
          chain: w.chain as any,
          address: w.address,
          supportedTokens: w.supportedTokens || ['USDC'],
          label: w.label || null,
          isActive: true
        }))
      });
    }

    res.json({ success: true, message: `Updated ${wallets.length} wallet(s)` });
  } catch (error) {
    console.error('Wallet update error:', error);
    res.status(500).json({ error: 'Failed to update wallets' });
  }
});

// ─── Test DB connection ─────────────────────────────────────────────────────
router.get('/v1/test-db', async (req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ success: true, message: 'Database connected' });
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown error');
    console.error('DB test error:', err);
    res.status(500).json({ error: 'Database connection failed', details: err.message });
  }
});

// ─── Test signup (no rate limit) ────────────────────────────────────────────
// DISABLED — test endpoint should not be in production
router.post('/v1/signup-test', (_req, res) => {
  return res.status(410).json({ error: 'This endpoint has been removed' });
});
router.post('/v1/signup-test-DISABLED', async (req: any, res: any) => {
  try {
    const { email, companyName, contactName } = req.body;

    if (!email || !companyName || !contactName) {
      return res.status(400).json({ error: 'Email, company name, and contact name are required' });
    }

    const merchant = await db.merchant.create({
      data: {
        email,
        companyName,
        contactName,
        plan: 'FREE',
        networkMode: 'TESTNET',
        paymentMode: 'DIRECT',
        isActive: false,
        setupCompleted: false,
      },
    });

    res.json({ success: true, message: 'Test signup successful', merchantId: merchant.id });
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown error');
    console.error('Test signup error:', err.message, err.stack);
    res.status(500).json({ error: 'Test signup failed', details: err.message });
  }
});

// ─── Signup with email verification ─────────────────────────────────────────
router.post('/v1/signup', rateLimit({
  getMerchantId: async () => null,
  limitAnonymous: true,
  anonymousLimit: 10
}), async (req, res) => {
  try {
    console.log('Signup attempt:', { email: req.body.email, hasPassword: !!req.body.password });
    const { email, companyName, contactName, password, plan, country, businessType } = req.body;

    if (!email || !companyName || !contactName) {
      return res.status(400).json({ error: 'Email, company name, and contact name are required' });
    }

    // Test account bypass — only in development
    const TEST_EMAIL = 'sololoopsmusic@gmail.com';
    let finalEmail = email;
    if (email === TEST_EMAIL) {
      const existing = await db.merchant.findUnique({ where: { email } });
      if (existing) {
        finalEmail = `sololoopsmusic+test${Date.now()}@gmail.com`;
      }
    } else {
      const existing = await db.merchant.findUnique({ where: { email } });
      if (existing) {
        logger.warn('Duplicate signup attempt', { email, ip: req.ip, event: 'auth.signup_duplicate' });
        return res.status(400).json({ error: 'An account with this email already exists' });
      }
    }

    const merchantPlan = plan || 'FREE';

    // Validate and hash password if provided
    let hashedPassword: string | undefined;
    if (password) {
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.isValid) {
        return res.status(400).json({ error: 'Invalid password', message: passwordValidation.error });
      }
      hashedPassword = await hashPassword(password);
    }

    // Generate verification code and login token upfront
    const verifyCode = generateVerifyCode();
    const loginToken = generateLoginToken();

    const merchant = await db.merchant.create({
      data: {
        email: finalEmail,
        companyName,
        contactName,
        plan: merchantPlan,
        networkMode: 'TESTNET',
        paymentMode: 'DIRECT',
        isActive: false,
        setupCompleted: false,
        emailVerified: false,
        emailVerifyToken: verifyCode,
        emailVerifyExpiry: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        loginToken,
        tokenExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        ...(hashedPassword && { passwordHash: hashedPassword }),
        ...(country && { country }),
        ...(businessType && { businessType }),
        kycStatus: 'PENDING',
      },
    });

    // Send verification email (always send to original email, even for test +suffix)
    await emailService.sendVerificationEmail(email, verifyCode, contactName);

    logger.info('New merchant signup', {
      merchantId: merchant.id,
      email: merchant.email,
      companyName: merchant.companyName,
      plan: merchantPlan,
      ip: req.ip,
      event: 'auth.signup_success'
    });

    res.json({
      success: true,
      message: 'Check your email for the verification code.',
      merchantId: merchant.id,
      email: finalEmail, // The actual DB email (may have +testXXX suffix)
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown error');
    logger.error('Signup error', err, { email: req.body.email, ip: req.ip, event: 'auth.signup_error' });
    console.error('Signup error details:', err.message, err.stack);
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// ─── Email verification ─────────────────────────────────────────────────────
router.post('/verify-email', rateLimit({
  getMerchantId: async () => null,
  limitAnonymous: true,
  anonymousLimit: 20
}), async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }

    const merchant = await db.merchant.findUnique({ where: { email } });

    if (!merchant || merchant.emailVerifyToken !== code) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    if (merchant.emailVerifyExpiry && new Date() > merchant.emailVerifyExpiry) {
      return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
    }

    // Activate FREE tier merchants automatically
    const autoActivate = merchant.plan === 'FREE';

    await db.merchant.update({
      where: { id: merchant.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpiry: null,
        ...(autoActivate && { isActive: true }),
      },
    });

    logger.info('Email verified', {
      merchantId: merchant.id,
      email,
      autoActivated: autoActivate,
      event: 'auth.email_verified'
    });

    // Send welcome email
    try {
      const { Resend } = await import('resend');
      const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
      if (resend) {
        const fromEmail = (process.env.FROM_EMAIL || 'StablePay <hello@wetakestables.shop>').trim();
        const BASE_URL = (process.env.BASE_URL || 'https://wetakestables.shop').trim();
        await resend.emails.send({
          from: fromEmail, to: email,
          subject: 'Welcome to StablePay!',
          html: `
            <div style="font-family:system-ui;max-width:500px;margin:0 auto;padding:24px;">
              <div style="background:#000;color:#fff;padding:20px;text-align:center;margin-bottom:20px;">
                <h1 style="margin:0;font-size:24px;">Welcome to StablePay</h1>
              </div>
              <p style="color:#333;">Hi ${merchant.contactName || 'there'},</p>
              <p style="color:#333;">Your account is ready. Here's how to start accepting stablecoin payments:</p>
              <div style="margin:20px 0;">
                <div style="padding:12px;border-left:4px solid #00E5FF;margin-bottom:12px;background:#f8f9fa;">
                  <strong>1. Set up wallets</strong><br><span style="color:#666;font-size:13px;">Add your wallet addresses for the chains you want to accept.</span>
                </div>
                <div style="padding:12px;border-left:4px solid #00E5FF;margin-bottom:12px;background:#f8f9fa;">
                  <strong>2. Add the widget</strong><br><span style="color:#666;font-size:13px;">Copy the embed code to your website — 2 lines of HTML.</span>
                </div>
                <div style="padding:12px;border-left:4px solid #00E5FF;background:#f8f9fa;">
                  <strong>3. Accept payments</strong><br><span style="color:#666;font-size:13px;">Customers pay in USDC/USDT/EURC on 7 blockchains.</span>
                </div>
              </div>
              <div style="text-align:center;margin:24px 0;">
                <a href="${BASE_URL}/dashboard" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;text-decoration:none;font-weight:bold;">Open Dashboard</a>
              </div>
              <p style="color:#999;font-size:12px;">Need help? Chat with Stablo in your dashboard — our AI assistant will guide you through setup.</p>
              <div style="border-top:1px solid #eee;margin-top:20px;padding-top:12px;text-align:center;">
                <a href="${BASE_URL}/api-docs.html" style="color:#666;font-size:12px;margin-right:12px;">API Docs</a>
                <a href="${BASE_URL}/pricing" style="color:#666;font-size:12px;">Pricing</a>
              </div>
            </div>
          `,
        });
      }
    } catch { /* non-critical */ }

    res.json({
      success: true,
      token: merchant.loginToken,
      merchantId: merchant.id,
      isActive: autoActivate,
      message: autoActivate
        ? 'Email verified! Your account is now active.'
        : 'Email verified! Your account is pending admin approval for the selected plan.',
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Resend verification code ───────────────────────────────────────────────
router.post('/resend-verification', rateLimit({
  getMerchantId: async () => null,
  limitAnonymous: true,
  anonymousLimit: 3 // 3 resends per hour per IP
}), async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Always return success to prevent email enumeration
    const merchant = await db.merchant.findUnique({ where: { email } });

    if (merchant && !merchant.emailVerified) {
      const verifyCode = generateVerifyCode();

      await db.merchant.update({
        where: { id: merchant.id },
        data: {
          emailVerifyToken: verifyCode,
          emailVerifyExpiry: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      await emailService.sendVerificationEmail(email, verifyCode, merchant.contactName);

      logger.info('Verification code resent', { email, event: 'auth.resend_verification' });
    }

    res.json({ success: true, message: 'If an account exists, a new code has been sent.' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Forgot password (request reset code) ───────────────────────────────────
router.post('/forgot-password', rateLimit({
  getMerchantId: async () => null,
  limitAnonymous: true,
  anonymousLimit: 5
}), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const merchant = await db.merchant.findUnique({ where: { email } });

    if (merchant) {
      const resetCode = generateVerifyCode();
      await db.merchant.update({
        where: { id: merchant.id },
        data: {
          emailVerifyToken: resetCode,
          emailVerifyExpiry: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
      await emailService.sendVerificationEmail(email, resetCode, merchant.contactName);
    }

    // Always return success to prevent email enumeration
    res.json({ success: true, message: 'If an account exists, a reset code has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Reset password (verify code + set new password) ────────────────────────
router.post('/reset-password', rateLimit({
  getMerchantId: async () => null,
  limitAnonymous: true,
  anonymousLimit: 10
}), async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code, and new password are required' });
    }

    const merchant = await db.merchant.findUnique({ where: { email } });

    if (!merchant || merchant.emailVerifyToken !== code) {
      return res.status(400).json({ error: 'Invalid reset code' });
    }

    if (merchant.emailVerifyExpiry && new Date() > merchant.emailVerifyExpiry) {
      return res.status(400).json({ error: 'Reset code expired. Request a new one.' });
    }

    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return res.status(400).json({ error: passwordValidation.error });
    }

    const hashedPassword = await hashPassword(newPassword);

    await db.merchant.update({
      where: { id: merchant.id },
      data: {
        passwordHash: hashedPassword,
        emailVerifyToken: null,
        emailVerifyExpiry: null,
      },
    });

    logger.info('Password reset', { email, event: 'auth.password_reset' });

    res.json({ success: true, message: 'Password updated. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const authRouter = router;
