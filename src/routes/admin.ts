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

export const adminRouter = router;
