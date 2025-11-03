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

    // Generate login token
    const loginToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Use direct SQL via fetch to Supabase REST API
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const apiKey = process.env.SUPABASE_ANON_KEY;

    // Check if merchant exists
    const checkResponse = await fetch(`${supabaseUrl}/rest/v1/merchants?email=eq.${email}&select=*`, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!checkResponse.ok) {
      throw new Error(`Check failed: ${checkResponse.statusText}`);
    }

    const existingMerchants = await checkResponse.json();

    if (existingMerchants.length > 0) {
      // Update existing merchant
      const updateResponse = await fetch(`${supabaseUrl}/rest/v1/merchants?id=eq.${existingMerchants[0].id}`, {
        method: 'PATCH',
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          loginToken,
          tokenExpiresAt: tokenExpiresAt.toISOString()
        })
      });

      if (!updateResponse.ok) {
        throw new Error(`Update failed: ${updateResponse.statusText}`);
      }

      console.log(`New login link for existing user ${email}: /login.html?token=${loginToken}`);
      
      return res.status(200).json({
        success: true,
        message: 'Login link sent! Check your email.',
        merchantId: existingMerchants[0].id,
        devToken: loginToken
      });
    }

    // Create new merchant
    const createResponse = await fetch(`${supabaseUrl}/rest/v1/merchants`, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        email,
        companyName,
        contactName,
        loginToken,
        tokenExpiresAt: tokenExpiresAt.toISOString(),
        role: 'MERCHANT',
        paymentMode: 'DIRECT',
        networkMode: 'TESTNET',
        isActive: false,
        setupCompleted: false
      })
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Create failed: ${createResponse.statusText} - ${errorText}`);
    }

    const newMerchant = await createResponse.json();

    console.log(`Login link for ${email}: /login.html?token=${loginToken}`);

    return res.status(201).json({
      success: true,
      message: 'Registration successful! Check your email for the login link.',
      merchantId: newMerchant[0]?.id || 'created',
      devToken: loginToken
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      error: 'Registration failed'
    });
  }
}