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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getPrisma();

  try {
    const { orderId } = req.query;
    const { txHash, blockNumber, status } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

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
          fromAddress: order.customerEmail,
          toAddress: order.paymentAddress,
          blockNumber: blockNumber ? BigInt(blockNumber) : null,
          blockTimestamp: new Date(),
          status: 'CONFIRMED',
          confirmations: 1
        }
      });
    }

    return res.json({ success: true, order });

  } catch (error) {
    console.error('Confirm order error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
};
