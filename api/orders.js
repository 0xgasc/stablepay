import { PrismaClient } from '@prisma/client';

// Initialize Prisma with error logging
const prisma = new PrismaClient({
  log: ['error', 'warn'],
  errorFormat: 'pretty'
});

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      // Fetch orders with pagination
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      const where = {};

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            transactions: true
          }
        }),
        prisma.order.count({ where })
      ]);

      // Convert BigInt to number for JSON serialization
      const serializedOrders = orders.map(order => ({
        ...order,
        amount: Number(order.amount),
        transactionCount: order.transactions.length,
        transactions: order.transactions.map(tx => ({
          ...tx,
          amount: Number(tx.amount),
          blockNumber: tx.blockNumber ? Number(tx.blockNumber) : null
        }))
      }));

      return res.status(200).json({
        orders: serializedOrders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    }

    if (req.method === 'POST') {
      // Create new order
      const { 
        amount, 
        chain,
        customerEmail,
        customerName
      } = req.body;

      const order = await prisma.order.create({
        data: {
          amount: amount,
          chain,
          customerEmail,
          customerName,
          status: 'PENDING',
          paymentAddress: '0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000)
        }
      });

      return res.status(201).json({
        ...order,
        amount: Number(order.amount)
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}