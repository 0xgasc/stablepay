import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'POST') {
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

      res.status(201).json(response);
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Validation error:', error.errors);
      res.status(400).json({ error: 'Validation error', details: error.errors });
    } else {
      console.error('Create order error:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      res.status(500).json({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}