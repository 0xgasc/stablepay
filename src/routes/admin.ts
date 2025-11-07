import { Router } from 'express';
import { db } from '../config/database';

const router = Router();

// GET admin resources (orders, wallets, merchants)
router.get('/', async (req, res) => {
  try {
    const { resource, merchantId } = req.query;

    if (!resource) {
      return res.status(400).json({ error: 'Resource parameter is required' });
    }

    switch (resource) {
      case 'orders':
        if (!merchantId || typeof merchantId !== 'string') {
          return res.status(400).json({ error: 'merchantId is required for orders' });
        }

        const orders = await db.order.findMany({
          where: { merchantId },
          include: {
            transactions: true,
            refunds: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        return res.json({ orders });

      case 'wallets':
        if (merchantId && typeof merchantId === 'string') {
          // Get wallets for specific merchant
          const wallets = await db.merchantWallet.findMany({
            where: { merchantId },
            orderBy: { createdAt: 'desc' },
          });
          return res.json({ wallets });
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
          return res.json({ wallets });
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
        return res.json({ merchants });

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

// POST create merchant
router.post('/', async (req, res) => {
  try {
    const { resource } = req.query;

    if (resource === 'merchants') {
      const { email, companyName, contactName, plan, networkMode, paymentMode, isActive } = req.body;

      if (!email || !companyName || !contactName) {
        return res.status(400).json({ error: 'Email, company name, and contact name are required' });
      }

      // Generate login token
      const loginToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

      const merchant = await db.merchant.create({
        data: {
          email,
          companyName,
          contactName,
          plan: plan || 'STARTER',
          networkMode: networkMode || 'TESTNET',
          paymentMode: paymentMode || 'DIRECT',
          isActive: isActive || false,
          loginToken,
          tokenExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        },
      });

      return res.json({ success: true, merchant, loginToken });
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
router.post('/wallets', async (req, res) => {
  try {
    const { merchantId, wallets } = req.body;

    if (!merchantId || !Array.isArray(wallets)) {
      return res.status(400).json({ error: 'merchantId and wallets array are required' });
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

    res.json({ success: true, wallets: created });
  } catch (error) {
    console.error('Wallet save error:', error);
    res.status(500).json({
      error: 'Failed to save wallets',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// PUT update merchant
router.put('/', async (req, res) => {
  try {
    const { resource } = req.query;

    if (resource === 'merchants') {
      const { merchantId, isActive, plan, networkMode, paymentMode } = req.body;

      if (!merchantId) {
        return res.status(400).json({ error: 'merchantId is required' });
      }

      const merchant = await db.merchant.update({
        where: { id: merchantId },
        data: {
          ...(typeof isActive !== 'undefined' && { isActive }),
          ...(plan && { plan }),
          ...(networkMode && { networkMode }),
          ...(paymentMode && { paymentMode }),
        },
      });

      return res.json({ success: true, merchant });
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
router.delete('/', async (req, res) => {
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

export const adminRouter = router;
