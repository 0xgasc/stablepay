import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

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
    const { companyName, contactName, email } = req.body;

    if (!companyName || !contactName || !email) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if merchant already exists
    const existingMerchant = await prisma.merchant.findUnique({
      where: { email }
    });

    if (existingMerchant) {
      // If merchant exists, generate new token and return success
      const loginToken = crypto.randomBytes(32).toString('hex');
      const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      await prisma.merchant.update({
        where: { email },
        data: {
          loginToken,
          tokenExpiresAt
        }
      });
      
      console.log(`New login link for existing user ${email}: /login.html?token=${loginToken}`);
      
      return res.status(200).json({
        success: true,
        message: 'Login link sent! Check your email.',
        merchantId: existingMerchant.id
      });
    }

    // Generate login token
    const loginToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create merchant
    const merchant = await prisma.merchant.create({
      data: {
        email,
        companyName,
        contactName,
        loginToken,
        tokenExpiresAt
      }
    });

    // TODO: Send email with login link
    console.log(`Login link for ${email}: /login.html?token=${loginToken}`);

    return res.status(201).json({
      success: true,
      message: 'Registration successful! Check your email for the login link.',
      merchantId: merchant.id,
      // For development, include the token
      devToken: loginToken
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ 
      error: 'Registration failed',
      details: error.message 
    });
  } finally {
    await prisma.$disconnect();
  }
}