import { PrismaClient } from '@prisma/client';

let prisma;
function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

// CORS setup
function setupCORS(req, res) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'https://stablepay-nine.vercel.app'
  ];
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

export default async function handler(req, res) {
  setupCORS(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const db = getPrisma();

  try {
    // GET admin resources
    if (req.method === 'GET') {
      const { resource, merchantId } = req.query;

      if (!resource) {
        return res.status(400).json({ error: 'Resource parameter is required' });
      }

      switch (resource) {
        case 'orders':
          if (!merchantId) {
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
          if (merchantId) {
            const wallets = await db.merchantWallet.findMany({
              where: { merchantId },
              orderBy: { createdAt: 'desc' },
            });
            return res.json(wallets);
          } else {
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
          return res.status(400).json({ error: 'Invalid resource' });
      }
    }

    // PUT update resources
    if (req.method === 'PUT') {
      const { resource } = req.query;

      if (resource === 'merchants') {
        const { merchantId, isActive, plan, networkMode, paymentMode } = req.body;

        if (!merchantId) {
          return res.status(400).json({ error: 'merchantId is required' });
        }

        let updateData = {
          ...(typeof isActive !== 'undefined' && { isActive }),
          ...(plan && { plan }),
          ...(networkMode && { networkMode }),
          ...(paymentMode && { paymentMode }),
        };

        // Generate token when activating a merchant
        if (isActive === true) {
          const merchant = await db.merchant.findUnique({
            where: { id: merchantId },
            select: { loginToken: true },
          });

          if (!merchant.loginToken) {
            const crypto = await import('crypto');
            const loginToken = crypto.randomBytes(32).toString('hex');
            const tokenExpiresAt = new Date();
            tokenExpiresAt.setFullYear(tokenExpiresAt.getFullYear() + 1);

            updateData.loginToken = loginToken;
            updateData.tokenExpiresAt = tokenExpiresAt;
          }
        }

        const updated = await db.merchant.update({
          where: { id: merchantId },
          data: updateData,
        });

        return res.json({ success: true, merchant: updated });
      }

      if (resource === 'wallets') {
        const { merchantId, wallets } = req.body;

        if (!merchantId || !wallets || !Array.isArray(wallets)) {
          return res.status(400).json({ error: 'merchantId and wallets array are required' });
        }

        // Delete existing wallets for this merchant
        await db.merchantWallet.deleteMany({
          where: { merchantId },
        });

        // Create new wallets
        const created = await db.merchantWallet.createMany({
          data: wallets.map((w) => ({
            merchantId,
            chain: w.chain,
            address: w.address,
            isActive: true,
          })),
        });

        return res.json({ success: true, count: created.count });
      }

      return res.status(400).json({ error: 'Invalid resource' });
    }

    // POST create resources
    if (req.method === 'POST') {
      const { resource } = req.query;

      if (resource === 'merchants') {
        const { email, companyName, contactName, plan, networkMode } = req.body;

        if (!email || !companyName || !contactName) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        const merchant = await db.merchant.create({
          data: {
            email,
            companyName,
            contactName,
            plan: plan || null,
            networkMode: networkMode || 'TESTNET',
            isActive: false,
            setupCompleted: false,
          },
        });

        return res.json({ success: true, merchant });
      }

      return res.status(400).json({ error: 'Invalid resource' });
    }

    // DELETE resources
    if (req.method === 'DELETE') {
      const { resource } = req.query;

      if (resource === 'merchants') {
        const { merchantId } = req.body;

        if (!merchantId) {
          return res.status(400).json({ error: 'merchantId is required' });
        }

        await db.merchant.delete({
          where: { id: merchantId },
        });

        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Invalid resource' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Admin API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}
