import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';

let prisma;
function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

// Rate limiter: 20 attempts per 15 minutes (increased for testing)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window
  message: { error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export default async function handler(req, res) {
  // Apply rate limiting
  await new Promise((resolve, reject) => {
    limiter(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result);
      }
      resolve(result);
    });
  });
  // Enable CORS - restrict to your domain in production
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'https://stablepay-nine.vercel.app'];
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
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Use Prisma to query database
    const db = getPrisma();

    // Find merchant with matching email
    const merchant = await db.merchant.findUnique({
      where: { email }
    });

    if (!merchant) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password with bcrypt
    if (!merchant.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const passwordValid = await bcrypt.compare(password, merchant.passwordHash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate a new login token
    const loginToken = 'token_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Update merchant with new login token
    await db.merchant.update({
      where: { id: merchant.id },
      data: {
        loginToken,
        tokenExpiresAt
      }
    });

    console.log('Login successful for:', email, 'ID:', merchant.id, 'Active:', merchant.isActive);

    return res.status(200).json({
      success: true,
      token: loginToken,
      merchantId: merchant.id,
      companyName: merchant.companyName,
      contactName: merchant.contactName,
      isActive: merchant.isActive,
      isPending: !merchant.isActive
    });
  } catch (error) {
    console.error('Login error:', error);
    console.error('Error details:', error.message);
    return res.status(500).json({
      error: 'Login failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}