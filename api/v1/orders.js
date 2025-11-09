const { PrismaClient } = require('@prisma/client');

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

module.exports = async function handler(req, res) {
  setupCORS(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const db = getPrisma();

  try {
    // POST - Create new order
    if (req.method === 'POST') {
      const { merchantId, productName, amount, chain, customerEmail, paymentAddress } = req.body;

      if (!merchantId || !amount || !chain || !paymentAddress) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['merchantId', 'amount', 'chain', 'paymentAddress']
        });
      }

      // Validate merchant exists
      const merchant = await db.merchant.findUnique({
        where: { id: merchantId }
      });

      if (!merchant) {
        return res.status(404).json({ error: 'Merchant not found' });
      }

      // Create order
      const order = await db.order.create({
        data: {
          merchantId,
          amount: parseFloat(amount),
          chain,
          customerEmail: customerEmail || 'anonymous',
          customerName: productName || 'Test Payment', // Use customerName field for product name
          paymentAddress,
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
        }
      });

      return res.status(201).json({
        success: true,
        order: {
          id: order.id,
          merchantId: order.merchantId,
          customerName: order.customerName,
          amount: order.amount.toString(),
          chain: order.chain,
          status: order.status,
          paymentAddress: order.paymentAddress,
          customerEmail: order.customerEmail,
          expiresAt: order.expiresAt,
          createdAt: order.createdAt
        }
      });
    }

    // GET - Fetch orders
    if (req.method === 'GET') {
      const { merchantId, orderId } = req.query;

      if (orderId) {
        // Get single order
        const order = await db.order.findUnique({
          where: { id: orderId },
          include: {
            transactions: true,
            refunds: true
          }
        });

        if (!order) {
          return res.status(404).json({ error: 'Order not found' });
        }

        return res.json(order);
      }

      if (merchantId) {
        // Get orders for merchant
        const orders = await db.order.findMany({
          where: { merchantId },
          include: {
            transactions: true
          },
          orderBy: { createdAt: 'desc' },
          take: 100
        });

        return res.json(orders);
      }

      return res.status(400).json({ error: 'merchantId or orderId required' });
    }

    // POST - Confirm order (update status with transaction details)
    if (req.method === 'POST' && req.url.includes('/confirm')) {
      const orderId = req.url.split('/')[3]; // Extract orderId from URL path
      const { txHash, blockNumber, status } = req.body;

      const order = await db.order.update({
        where: { id: orderId },
        data: {
          status: status || 'CONFIRMED',
          updatedAt: new Date()
        }
      });

      // Create transaction record
      if (txHash) {
        await db.transaction.create({
          data: {
            orderId: orderId,
            txHash: txHash,
            chain: order.chain,
            amount: order.amount,
            fromAddress: order.customerEmail, // Using email field as wallet address
            toAddress: order.paymentAddress,
            blockNumber: blockNumber ? BigInt(blockNumber) : null,
            status: 'CONFIRMED',
            confirmedAt: new Date()
          }
        });
      }

      return res.json({ success: true, order });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Orders API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
