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

    // Use direct SQL via fetch to Supabase REST API
    const supabaseUrl = 'https://lxbrsiujmntrvzqdphhj.supabase.co';
    const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YnJzaXVqbW50cnZ6cWRwaGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU0OTMzNDksImV4cCI6MjA1MTA2OTM0OX0.WXJYoHgfG6BvsBU2VFJrEQZJgMSMjc9d-MhOVGLfSKo';

    const loginToken = crypto.randomBytes(32).toString('hex');
    const now = new Date().toISOString();

    // Create merchant
    const merchantData = {
      companyName,
      contactName,
      email,
      loginToken,
      role: 'MERCHANT',
      createdAt: now,
      updatedAt: now
    };

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

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('Supabase error:', errorText);
      throw new Error(`Failed to create merchant: ${errorText}`);
    }

    const merchant = await createResponse.json();
    const merchantId = merchant[0]?.id || merchant.id;

    // Create default wallet for the merchant
    const walletData = {
      merchantId,
      address: '0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF',
      chain: 'BASE_SEPOLIA',
      isDefault: true,
      createdAt: now,
      updatedAt: now
    };

    await fetch(`${supabaseUrl}/rest/v1/merchant_wallets`, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(walletData)
    });

    console.log(`Registration successful for ${email}:`, {
      merchantId,
      loginToken
    });

    return res.status(201).json({
      success: true,
      message: 'Registration successful! Check your email for the login link.',
      merchantId: merchantId,
      loginUrl: `/dashboard.html?token=${loginToken}`
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ 
      error: 'Registration failed',
      details: error.message 
    });
  }
}