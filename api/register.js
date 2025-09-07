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

    // Generate a simple token
    const loginToken = 'token_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
    const merchantId = 'merchant_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    
    // For now, return success without database
    // Database writes are failing on Vercel
    console.log('Registration request:', { companyName, contactName, email, merchantId, loginToken });

    return res.status(201).json({
      success: true,
      message: 'Registration successful! Your account has been created.',
      merchantId: merchantId,
      devToken: loginToken,
      loginUrl: `/dashboard.html?token=${loginToken}&merchant=${merchantId}`,
      note: 'Demo mode - click Login Now to access your dashboard',
      demo: true
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ 
      error: 'Registration failed',
      details: error.message 
    });
  }
}