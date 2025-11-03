import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Admin authentication middleware
function checkAdminAuth(req, res) {
  // Simple admin check - enhance with JWT in production
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check admin auth
  if (!checkAdminAuth(req, res)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      // Get all merchants with stats
      const merchants = await prisma.merchant.findMany({
        include: {
          _count: {
            select: { orders: true }
          },
          orders: {
            where: {
              status: 'CONFIRMED'
            },
            select: {
              amount: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      // Calculate total volume per merchant
      const merchantsWithStats = merchants.map(merchant => {
        const totalVolume = merchant.orders.reduce(
          (sum, order) => sum + parseFloat(order.amount.toString()),
          0
        );

        return {
          id: merchant.id,
          email: merchant.email,
          companyName: merchant.companyName,
          contactName: merchant.contactName,
          role: merchant.role,
          plan: merchant.plan,
          paymentMode: merchant.paymentMode,
          networkMode: merchant.networkMode,
          isActive: merchant.isActive,
          setupCompleted: merchant.setupCompleted,
          website: merchant.website,
          industry: merchant.industry,
          notes: merchant.notes,
          createdAt: merchant.createdAt,
          updatedAt: merchant.updatedAt,
          orderCount: merchant._count.orders,
          totalVolume: totalVolume
        };
      });

      return res.status(200).json(merchantsWithStats);
    }

    if (req.method === 'POST') {
      // Create new merchant
      const {
        email,
        companyName,
        contactName,
        plan,
        networkMode,
        website,
        industry,
        notes,
        isActive
      } = req.body;

      // Validate required fields
      if (!email || !companyName || !contactName) {
        return res.status(400).json({
          error: 'Email, company name, and contact name are required'
        });
      }

      // Check if email already exists
      const existing = await prisma.merchant.findUnique({
        where: { email }
      });

      if (existing) {
        return res.status(400).json({
          error: 'A merchant with this email already exists'
        });
      }

      // Generate temporary password
      const tempPassword = Math.random().toString(36).slice(-12);
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      // Create merchant
      const merchant = await prisma.merchant.create({
        data: {
          email,
          companyName,
          contactName,
          passwordHash,
          plan: plan || 'STARTER',
          networkMode: networkMode || 'TESTNET',
          isActive: isActive !== undefined ? isActive : true,
          website,
          industry,
          notes,
          role: 'MERCHANT'
        }
      });

      return res.status(201).json({
        success: true,
        merchant: {
          id: merchant.id,
          email: merchant.email,
          companyName: merchant.companyName,
          contactName: merchant.contactName
        },
        temporaryPassword: tempPassword,
        message: 'Merchant created successfully. Send them the temporary password.'
      });
    }

    if (req.method === 'PUT') {
      // Update merchant
      const { merchantId, ...updateData } = req.body;

      if (!merchantId) {
        return res.status(400).json({ error: 'Merchant ID is required' });
      }

      const merchant = await prisma.merchant.update({
        where: { id: merchantId },
        data: updateData
      });

      return res.status(200).json({
        success: true,
        merchant
      });
    }

    if (req.method === 'DELETE') {
      // Soft delete - just deactivate
      const { merchantId } = req.body;

      if (!merchantId) {
        return res.status(400).json({ error: 'Merchant ID is required' });
      }

      await prisma.merchant.update({
        where: { id: merchantId },
        data: { isActive: false }
      });

      return res.status(200).json({
        success: true,
        message: 'Merchant deactivated successfully'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Admin merchants API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  } finally {
    await prisma.$disconnect();
  }
}
