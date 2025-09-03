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
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;
    const { txHash, fromAddress, blockNumber, confirmations } = req.body;

    // Update order status
    const order = await prisma.order.update({
      where: { id },
      data: { status: 'PAID' }
    });

    // Create or update transaction
    const transaction = await prisma.transaction.upsert({
      where: { txHash },
      create: {
        txHash,
        orderId: id,
        chain: order.chain,
        amount: order.amount,
        fromAddress,
        toAddress: order.paymentAddress,
        blockNumber: blockNumber ? BigInt(blockNumber) : null,
        confirmations: confirmations || 1,
        status: 'CONFIRMED'
      },
      update: {
        blockNumber: blockNumber ? BigInt(blockNumber) : null,
        confirmations: confirmations || 1,
        status: 'CONFIRMED'
      }
    });

    return res.status(200).json({
      ...order,
      amount: Number(order.amount),
      transaction: {
        ...transaction,
        amount: Number(transaction.amount),
        blockNumber: transaction.blockNumber ? Number(transaction.blockNumber) : null
      }
    });
  } catch (error) {
    console.error('Confirm order error:', error);
    return res.status(500).json({ 
      error: 'Failed to confirm order',
      details: error.message 
    });
  }
}