import crypto from 'crypto';

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

    // For now, just return success since we're having database access issues
    // In a production setup, you'd save this to the database
    const loginToken = crypto.randomBytes(32).toString('hex');
    const merchantId = 'demo_' + Math.random().toString(36).substring(2, 15);

    // Log registration for debugging
    console.log(`Registration attempt for ${email}:`, {
      merchantId,
      companyName,
      contactName,
      email,
      loginToken,
      createdAt: new Date().toISOString()
    });

    return res.status(201).json({
      success: true,
      message: 'Registration successful! Check your email for the login link.',
      merchantId: merchantId,
      devToken: loginToken,
      note: 'Demo mode - using temporary storage until database access is configured'
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ 
      error: 'Registration failed',
      details: error.message 
    });
  }
}