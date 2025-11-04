const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

let prisma;

function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

// Admin authentication
function checkAdminAuth(req) {
  const auth = req.headers.authorization;
  return auth === 'Bearer admin-token';
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

  if (!checkAdminAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { resource, action } = req.query;

  try {
    const db = getPrisma();

    // Route to appropriate handler
    if (resource === 'merchants') {
      return await handleMerchants(req, res, action, db);
    } else if (resource === 'orders') {
      return await handleOrders(req, res, db);
    } else if (resource === 'analytics') {
      return await handleAnalytics(req, res, db);
    }

    return res.status(404).json({ error: 'Resource not found' });
  } catch (error) {
    console.error('Admin API error:', error);
    console.error('Error stack:', error.stack);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Merchants handlers
async function handleMerchants(req, res, action, prisma) {
  if (req.method === 'GET') {
    const merchants = await prisma.merchant.findMany({
      include: {
        _count: { select: { orders: true } },
        orders: {
          where: { status: 'CONFIRMED' },
          select: { amount: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const merchantsWithStats = merchants.map(merchant => ({
      id: merchant.id,
      email: merchant.email,
      companyName: merchant.companyName,
      contactName: merchant.contactName,
      role: merchant.role,
      plan: merchant.plan || 'STARTER',
      paymentMode: merchant.paymentMode || 'DIRECT',
      networkMode: merchant.networkMode || 'TESTNET',
      isActive: merchant.isActive,
      setupCompleted: merchant.setupCompleted,
      website: merchant.website || null,
      industry: merchant.industry || null,
      notes: merchant.notes || null,
      createdAt: merchant.createdAt,
      updatedAt: merchant.updatedAt,
      orderCount: merchant._count.orders,
      totalVolume: merchant.orders.reduce(
        (sum, order) => sum + parseFloat(order.amount.toString()),
        0
      )
    }));

    return res.status(200).json(merchantsWithStats);
  }

  if (req.method === 'POST') {
    try {
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

      console.log('Creating merchant with data:', { email, companyName, contactName, plan });

      if (!email || !companyName || !contactName) {
        return res.status(400).json({
          error: 'Email, company name, and contact name are required'
        });
      }

      const existing = await prisma.merchant.findUnique({ where: { email } });
      if (existing) {
        return res.status(400).json({
          error: 'A merchant with this email already exists'
        });
      }

      const tempPassword = Math.random().toString(36).slice(-12);
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      // Only include fields that exist in the database
      const merchantData = {
        email,
        companyName,
        contactName,
        passwordHash,
        isActive: isActive !== undefined ? isActive : true,
        role: 'MERCHANT'
      };

      // Add optional fields if they exist in schema
      if (plan) merchantData.plan = plan;
      if (networkMode) merchantData.networkMode = networkMode;
      if (website) merchantData.website = website;
      if (industry) merchantData.industry = industry;
      if (notes) merchantData.notes = notes;

      console.log('Creating merchant with fields:', Object.keys(merchantData));

      const merchant = await prisma.merchant.create({
        data: merchantData
      });

      console.log('Merchant created successfully:', merchant.id);

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
    } catch (error) {
      console.error('Error creating merchant:', error);
      return res.status(500).json({
        error: 'Failed to create merchant',
        details: error.message
      });
    }
  }

  if (req.method === 'PUT') {
    const { merchantId, ...updateData } = req.body;
    if (!merchantId) {
      return res.status(400).json({ error: 'Merchant ID is required' });
    }

    const merchant = await prisma.merchant.update({
      where: { id: merchantId },
      data: updateData
    });

    return res.status(200).json({ success: true, merchant });
  }

  if (req.method === 'DELETE') {
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
}

// Orders handler
async function handleOrders(req, res, prisma) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { merchantId, status, chain, limit = 100 } = req.query;

  const where = {};
  if (merchantId) where.merchantId = merchantId;
  if (status) where.status = status;
  if (chain) where.chain = chain;

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
    orderBy: { createdAt: 'desc' },
    take: parseInt(limit)
  });

  return res.status(200).json(orders);
}

// Analytics handler
async function handleAnalytics(req, res, prisma) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const [
    totalMerchants,
    activeMerchants,
    totalOrders,
    confirmedOrders,
    revenueByMerchant
  ] = await Promise.all([
    prisma.merchant.count(),
    prisma.merchant.count({ where: { isActive: true } }),
    prisma.order.count(),
    prisma.order.findMany({
      where: { status: 'CONFIRMED' },
      select: { amount: true, merchantId: true, createdAt: true }
    }),
    prisma.order.groupBy({
      by: ['merchantId'],
      where: {
        status: 'CONFIRMED',
        merchantId: { not: null }
      },
      _sum: { amount: true },
      _count: true
    })
  ]);

  const totalRevenue = confirmedOrders.reduce(
    (sum, order) => sum + parseFloat(order.amount.toString()),
    0
  );

  const merchantIds = revenueByMerchant.map(r => r.merchantId).filter(id => id);
  const merchants = await prisma.merchant.findMany({
    where: { id: { in: merchantIds } },
    select: { id: true, companyName: true }
  });

  const merchantMap = Object.fromEntries(
    merchants.map(m => [m.id, m.companyName])
  );

  const revenueBreakdown = revenueByMerchant.map(r => ({
    merchantId: r.merchantId,
    merchantName: r.merchantId ? merchantMap[r.merchantId] : 'Unknown',
    orderCount: r._count,
    totalRevenue: parseFloat(r._sum.amount?.toString() || '0')
  })).sort((a, b) => b.totalRevenue - a.totalRevenue);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentOrders = confirmedOrders.filter(
    o => new Date(o.createdAt) >= thirtyDaysAgo
  );

  const dailyRevenue = {};
  recentOrders.forEach(order => {
    const date = new Date(order.createdAt).toISOString().split('T')[0];
    if (!dailyRevenue[date]) dailyRevenue[date] = 0;
    dailyRevenue[date] += parseFloat(order.amount.toString());
  });

  return res.status(200).json({
    summary: {
      totalMerchants,
      activeMerchants,
      totalOrders,
      confirmedOrders: confirmedOrders.length,
      totalRevenue,
      averageOrderValue: confirmedOrders.length > 0
        ? totalRevenue / confirmedOrders.length
        : 0
    },
    revenueByMerchant: revenueBreakdown,
    dailyRevenue: Object.entries(dailyRevenue).map(([date, revenue]) => ({
      date,
      revenue
    })).sort((a, b) => a.date.localeCompare(b.date))
  });
}
