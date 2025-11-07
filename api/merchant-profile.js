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
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

export default async function handler(req, res) {
  setupCORS(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const db = getPrisma();

  try {
    // GET: Fetch merchant by ID or token
    if (req.method === 'GET') {
      const { id, token } = req.query;

      console.log('merchant-profile GET request:', { id, hasToken: !!token });

      let merchant;
      if (id) {
        console.log('Fetching by ID:', id);
        merchant = await db.merchant.findUnique({
          where: { id },
          include: {
            wallets: true,
            _count: { select: { orders: true } }
          }
        });
      } else if (token) {
        console.log('Fetching by token (length:', token.length, ')');
        merchant = await db.merchant.findFirst({
          where: {
            loginToken: token,
            tokenExpiresAt: { gte: new Date() }
          },
          include: {
            wallets: true,
            _count: { select: { orders: true } }
          }
        });

        if (!merchant) {
          // Try without expiry check to see if token exists
          const merchantWithoutExpiry = await db.merchant.findFirst({
            where: { loginToken: token }
          });

          if (merchantWithoutExpiry) {
            console.log('Token exists but expired for:', merchantWithoutExpiry.email);
            return res.status(401).json({ error: 'Token expired. Please contact admin for new login link.' });
          } else {
            console.log('Token not found in database');
          }
        }
      } else {
        return res.status(400).json({ error: 'ID or token required' });
      }

      if (!merchant) {
        console.log('Merchant not found');
        return res.status(404).json({ error: 'Merchant not found' });
      }

      console.log('Merchant found:', merchant.email, 'ID:', merchant.id);

      // Return merchant data without password hash
      const { passwordHash, loginToken, tokenExpiresAt, ...safeData } = merchant;

      return res.status(200).json({
        ...safeData,
        orderCount: merchant._count.orders
      });
    }

    // PUT: Update merchant profile
    if (req.method === 'PUT') {
      const { id, ...updateData } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'Merchant ID required' });
      }

      // Remove fields that shouldn't be updated via this endpoint
      delete updateData.passwordHash;
      delete updateData.loginToken;
      delete updateData.tokenExpiresAt;
      delete updateData.role;

      const updated = await db.merchant.update({
        where: { id },
        data: updateData
      });

      return res.status(200).json({ success: true, merchant: updated });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Merchant profile API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
