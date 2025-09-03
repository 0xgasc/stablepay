import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['error', 'warn'],
  errorFormat: 'pretty'
});

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;
    
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        transactions: true
      }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Convert BigInt to number for JSON serialization
    const serializedOrder = {
      ...order,
      amount: Number(order.amount),
      transactions: order.transactions.map(tx => ({
        ...tx,
        amount: Number(tx.amount),
        blockNumber: tx.blockNumber ? Number(tx.blockNumber) : null
      }))
    };

    return res.status(200).json(serializedOrder);
  } catch (error) {
    console.error('Get order error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch order',
      details: error.message 
    });
  }
}