import { Router } from 'express';
import { db } from '../config/database';

const router = Router();

// Merchant login endpoint
router.post('/login', async (req, res) => {
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

export const authRouter = router;
