const { PrismaClient } = require('@prisma/client');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const prisma = new PrismaClient();

    // Test database connection
    const merchantCount = await prisma.merchant.count();

    await prisma.$disconnect();

    return res.status(200).json({
      success: true,
      message: 'Database connection successful',
      merchantCount,
      env: {
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        hasDirectUrl: !!process.env.DIRECT_URL,
        nodeEnv: process.env.NODE_ENV
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}
