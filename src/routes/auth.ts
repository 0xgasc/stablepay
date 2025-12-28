import { Router } from 'express';
import { db } from '../config/database';
import { rateLimit } from '../middleware/rateLimit';
import { logger } from '../utils/logger';
import { hashPassword, comparePassword, validatePassword } from '../utils/password';

const router = Router();

// Merchant login endpoint
router.post('/login', rateLimit({
  getMerchantId: async () => null, // Anonymous endpoint
  limitAnonymous: true,
  anonymousLimit: 20 // 20 login attempts per hour per IP
}), async (req, res) => {
  try {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({ error: 'Email and token are required' });
    }

    // Find merchant by email and token
    const merchant = await db.merchant.findFirst({
      where: {
        email,
        loginToken: token,
      },
    });

    if (!merchant) {
      logger.warn('Failed login attempt', {
        email,
        ip: req.ip,
        event: 'auth.login_failed'
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if token is expired
    if (merchant.tokenExpiresAt && new Date() > merchant.tokenExpiresAt) {
      return res.status(401).json({ error: 'Token expired' });
    }

    res.json({
      success: true,
      token: merchant.loginToken,
      merchantId: merchant.id,
      isActive: merchant.isActive,
      isPending: !merchant.isActive,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get merchant profile
router.get('/merchant-profile', async (req, res) => {
  try {
    const { id, token } = req.query;

    if (!id && !token) {
      return res.status(400).json({ error: 'Merchant ID or token is required' });
    }

    // Find merchant by ID or token
    const merchant = await db.merchant.findFirst({
      where: id
        ? { id: id as string }
        : { loginToken: token as string },
      include: {
        _count: {
          select: { orders: true },
        },
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
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update merchant profile
router.put('/merchant-profile', async (req, res) => {
  try {
    const { id, companyName, contactName, email, plan, networkMode, paymentMode } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Merchant ID is required' });
    }

    const updated = await db.merchant.update({
      where: { id },
      data: {
        ...(companyName && { companyName }),
        ...(contactName && { contactName }),
        ...(email && { email }),
        ...(plan && { plan }),
        ...(networkMode && { networkMode }),
        ...(paymentMode && { paymentMode }),
      },
    });

    res.json({ success: true, merchant: updated });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Merchant signup endpoint
// Test endpoint to verify database connection
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

// Simple signup test without rate limiting
router.post('/v1/signup-test', async (req, res) => {
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

    res.json({
      success: true,
      message: 'Test signup successful',
      merchantId: merchant.id,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown error');
    console.error('Test signup error:', err.message, err.stack);
    res.status(500).json({ error: 'Test signup failed', details: err.message });
  }
});

router.post('/v1/signup', rateLimit({
  getMerchantId: async () => null, // Anonymous endpoint
  limitAnonymous: true,
  anonymousLimit: 10 // 10 signup attempts per hour per IP
}), async (req, res) => {
  try {
    console.log('Signup attempt:', { email: req.body.email, hasPassword: !!req.body.password });
    const { email, companyName, contactName, password, plan } = req.body;

    if (!email || !companyName || !contactName) {
      return res.status(400).json({ error: 'Email, company name, and contact name are required' });
    }

    // Check if merchant already exists
    const existing = await db.merchant.findUnique({
      where: { email },
    });

    if (existing) {
      logger.warn('Duplicate signup attempt', {
        email,
        ip: req.ip,
        event: 'auth.signup_duplicate'
      });
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    // Create merchant in pending state (no login token yet)
    // Default to FREE tier for new signups
    const merchantPlan = plan || 'FREE';

    // Validate and hash password if provided
    let hashedPassword: string | undefined;
    if (password) {
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.isValid) {
        return res.status(400).json({
          error: 'Invalid password',
          message: passwordValidation.error
        });
      }
      hashedPassword = await hashPassword(password);
    }

    const merchant = await db.merchant.create({
      data: {
        email,
        companyName,
        contactName,
        plan: merchantPlan,
        networkMode: 'TESTNET',
        paymentMode: 'DIRECT',
        isActive: false, // Pending admin approval
        setupCompleted: false,
        ...(hashedPassword && { passwordHash: hashedPassword }),
      },
    });

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
      message: 'Account created successfully! Please wait for admin approval.',
      merchantId: merchant.id,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown error');
    logger.error('Signup error', err, {
      email: req.body.email,
      ip: req.ip,
      event: 'auth.signup_error'
    });
    console.error('Signup error details:', err.message, err.stack);
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

export const authRouter = router;
