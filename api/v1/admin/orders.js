import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Admin authentication middleware
function checkAdminAuth(req, res) {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Bearer admin-token') {
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  // Enable CORS
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'https://stablepay-nine.vercel.app'
  ];
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check admin auth
  if (!checkAdminAuth(req, res)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get query parameters
    const { merchantId, status, chain, limit = 100 } = req.query;

    // Build filter
    const where = {};
    if (merchantId) where.merchantId = merchantId;
    if (status) where.status = status;
    if (chain) where.chain = chain;

    // Get all orders with merchant info
    const orders = await prisma.order.findMany({
      where,
      include: {
        merchant: {
          select: {
            id: true,
            companyName: true,
            email: true
          }
        },
        transactions: {
          select: {
            txHash: true,
            amount: true,
            status: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: parseInt(limit)
    });

    return res.status(200).json(orders);
  } catch (error) {
    console.error('Admin orders API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  } finally {
    await prisma.$disconnect();
  }
}
