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
    // Get platform-wide analytics
    const [
      totalMerchants,
      activeMerchants,
      totalOrders,
      confirmedOrders,
      revenueByMerchant
    ] = await Promise.all([
      // Total merchants
      prisma.merchant.count(),

      // Active merchants
      prisma.merchant.count({
        where: { isActive: true }
      }),

      // Total orders
      prisma.order.count(),

      // Confirmed orders with revenue
      prisma.order.findMany({
        where: { status: 'CONFIRMED' },
        select: {
          amount: true,
          merchantId: true,
          createdAt: true
        }
      }),

      // Revenue by merchant
      prisma.order.groupBy({
        by: ['merchantId'],
        where: {
          status: 'CONFIRMED',
          merchantId: { not: null }
        },
        _sum: {
          amount: true
        },
        _count: true
      })
    ]);

    // Calculate total platform revenue
    const totalRevenue = confirmedOrders.reduce(
      (sum, order) => sum + parseFloat(order.amount.toString()),
      0
    );

    // Get merchant details for revenue breakdown
    const merchantIds = revenueByMerchant.map(r => r.merchantId).filter(id => id);
    const merchants = await prisma.merchant.findMany({
      where: {
        id: { in: merchantIds }
      },
      select: {
        id: true,
        companyName: true
      }
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

    // Revenue by day (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentOrders = confirmedOrders.filter(
      o => new Date(o.createdAt) >= thirtyDaysAgo
    );

    const dailyRevenue = {};
    recentOrders.forEach(order => {
      const date = new Date(order.createdAt).toISOString().split('T')[0];
      if (!dailyRevenue[date]) {
        dailyRevenue[date] = 0;
      }
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
  } catch (error) {
    console.error('Admin analytics API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  } finally {
    await prisma.$disconnect();
  }
}
