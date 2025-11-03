import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';

// Rate limiter: 3 registrations per hour
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per window
  message: { error: 'Too many registration attempts. Please try again later.' },
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
    const { companyName, contactName, email, password } = req.body;

    console.log('Minimal registration attempt:', { companyName, contactName, email, password: password ? 'EXISTS' : 'MISSING' });

    // Validate required fields
    if (!companyName || !contactName || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password strength (min 8 chars)
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Use direct SQL via fetch to Supabase REST API
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const apiKey = process.env.SUPABASE_ANON_KEY;

    // Hash password with bcrypt (10 rounds)
    const passwordHash = await bcrypt.hash(password, 10);

    // Minimal merchant data WITH PASSWORD HASH
    const merchantData = {
      companyName,
      contactName,
      email,
      passwordHash  // IMPORTANT: Include the password hash!
    };

    console.log('About to create merchant with:', merchantData);

    const createResponse = await fetch(`${supabaseUrl}/rest/v1/merchants`, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(merchantData)
    });

    console.log('Response status:', createResponse.status);
    console.log('Response ok:', createResponse.ok);

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('Supabase error:', errorText);
      
      // Check for duplicate email
      if (createResponse.status === 409 || errorText.includes('duplicate') || errorText.includes('unique')) {
        return res.status(409).json({ 
          error: 'Email already registered',
          message: 'This email is already in use. Please login or use a different email.'
        });
      }
      
      return res.status(500).json({ error: 'Database error', details: errorText });
    }

    const merchant = await createResponse.json();
    console.log('Created merchant:', merchant);

    return res.status(201).json({
      success: true,
      message: 'Registration successful!',
      merchantId: merchant[0]?.id || merchant.id,
      note: 'You can now sign in with your email and password'
    });

  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      error: 'Registration failed'
    });
  }
}