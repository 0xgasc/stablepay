import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { PrismaClient } = require('@prisma/client');
    const { z } = require('zod');
    
    const prisma = new PrismaClient();

    const CHAIN_CONFIGS = {
      BASE_SEPOLIA: {
        paymentAddress: process.env.PAYMENT_ADDRESS_BASE_SEPOLIA || '0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF',
        usdcAddress: process.env.USDC_BASE_SEPOLIA || '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      },
      ETHEREUM_SEPOLIA: {
        paymentAddress: process.env.PAYMENT_ADDRESS_ETHEREUM_SEPOLIA || '0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF',
        usdcAddress: process.env.USDC_ETHEREUM_SEPOLIA || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      }
    };

    const createOrderSchema = z.object({
      amount: z.number().positive(),
      chain: z.enum(['BASE_SEPOLIA', 'ETHEREUM_SEPOLIA']),
      customerEmail: z.string().email().optional(),
      customerName: z.string().min(1).optional(),
      expiryMinutes: z.number().positive().optional(),
    });

    if (req.method === 'POST') {
      // Create order
      console.log('Creating order with data:', req.body);
      const data = createOrderSchema.parse(req.body);
      console.log('Parsed order data:', data);
      
      const chainConfig = CHAIN_CONFIGS[data.chain];
      if (!chainConfig) {
        return res.status(400).json({ error: `Unsupported chain: ${data.chain}` });
      }

      const expiryMinutes = data.expiryMinutes || 30;
      const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

      const order = await prisma.order.create({
        data: {
          amount: data.amount,
          chain: data.chain,
          customerEmail: data.customerEmail,
          customerName: data.customerName,
          paymentAddress: chainConfig.paymentAddress,
          expiresAt,
        },
      });

      console.log('Order created successfully:', order.id);

      const response = {
        orderId: order.id,
        amount: data.amount,
        chain: data.chain,
        paymentAddress: chainConfig.paymentAddress,
        usdcAddress: chainConfig.usdcAddress,
        expiresAt: expiresAt.toISOString(),
        status: order.status,
      };

      await prisma.$disconnect();
      return res.status(201).json(response);
      
    } else if (req.method === 'GET') {
      // Get all orders (for admin)
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const skip = (page - 1) * limit;

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            transactions: false,
          },
        }),
        prisma.order.count(),
      ]);

      const response = {
        orders: orders.map(order => ({
          id: order.id,
          amount: Number(order.amount),
          chain: order.chain,
          status: order.status,
          customerEmail: order.customerEmail,
          customerName: order.customerName,
          createdAt: order.createdAt.toISOString(),
          expiresAt: order.expiresAt.toISOString(),
          transactionCount: 0,
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };

      await prisma.$disconnect();
      return res.status(200).json(response);
      
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Orders API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}