const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

let prisma;

function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

module.exports = async function handler(req, res) {
  // CORS
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'https://stablepay-nine.vercel.app'
  ];
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getPrisma();
    const {
      email,
      password,
      companyName,
      contactName,
      website,
      plan
    } = req.body;

    // Validate required fields
    if (!email || !password || !companyName || !contactName) {
      return res.status(400).json({
        error: 'Email, password, company name, and contact name are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password length
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if email already exists
    const existing = await db.merchant.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({
        error: 'An account with this email already exists'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create merchant with PENDING status
    const merchant = await db.merchant.create({
      data: {
        email,
        companyName,
        contactName,
        passwordHash,
        plan: plan || 'STARTER',
        networkMode: 'TESTNET',
        isActive: false, // PENDING approval
        setupCompleted: false,
        website: website || null,
        role: 'MERCHANT'
      }
    });

    console.log('New merchant signup:', merchant.id, merchant.email);

    // TODO: Send email notification to admin
    // TODO: Send confirmation email to merchant

    return res.status(201).json({
      success: true,
      message: 'Account created successfully. Pending admin approval.',
      merchantId: merchant.id
    });
  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({
      error: 'Failed to create account',
      details: error.message
    });
  }
}
