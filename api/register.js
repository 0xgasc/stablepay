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
    const { companyName, contactName, email, password } = req.body;

    if (!companyName || !contactName || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Use direct SQL via fetch to Supabase REST API
    const supabaseUrl = 'https://lxbrsiujmntrvzqdphhj.supabase.co';
    const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YnJzaXVqbW50cnZ6cWRwaGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0OTI4ODUsImV4cCI6MjA3MjA2ODg4NX0.77bxwJTUvcEzzegd7WBi_UvJkcmKgtpyS1KKxHNFBjE';

    // Hash password using Web Crypto API (available in Vercel Edge runtime)
    const encoder = new TextEncoder();
    const data = encoder.encode(password + email); // Simple salt with email
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Create merchant with password hash
    const merchantData = {
      companyName,
      contactName,
      email,
      role: 'MERCHANT',
      passwordHash
    };

    console.log('Creating merchant:', merchantData);

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
      console.error('Supabase create error:', createResponse.status, errorText);
      throw new Error(`Failed to create merchant: ${errorText}`);
    }

    const merchant = await createResponse.json();
    const merchantId = merchant[0]?.id || merchant.id;

    console.log('Created merchant:', merchantId);

    // Create default wallet for the merchant
    const walletData = {
      merchantId,
      address: '0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF',
      chain: 'BASE_SEPOLIA'
    };

    const walletResponse = await fetch(`${supabaseUrl}/rest/v1/merchant_wallets`, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(walletData)
    });

    if (!walletResponse.ok) {
      console.error('Wallet creation failed:', await walletResponse.text());
    }

    // Update merchant with login token
    await fetch(`${supabaseUrl}/rest/v1/merchants?id=eq.${merchantId}`, {
      method: 'PATCH',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        loginToken,
        tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      })
    });

    // Send email (using a simple email service or webhook)
    const loginUrl = `https://stablepay-nine.vercel.app/dashboard.html?token=${loginToken}&merchant=${merchantId}`;
    
    try {
      // For now, we'll use a webhook or external service to send emails
      // You can replace this with your preferred email service (Resend, SendGrid, etc.)
      // For demo, log the email content that should be sent
      console.log('=== EMAIL TO SEND ===');
      console.log('To:', email);
      console.log('Subject: Welcome to StablePay - Your Login Link');
      console.log('Login URL:', loginUrl);
      console.log('Message: Welcome to StablePay, ' + contactName + '! Click here to access your dashboard: ' + loginUrl);
      console.log('==================');
    } catch (emailError) {
      console.log('Email sending failed:', emailError.message);
    }

    console.log('Registration successful for:', email, 'ID:', merchantId);

    return res.status(201).json({
      success: true,
      message: 'Registration successful! Your account has been created.',
      merchantId: merchantId,
      redirect: '/login.html',
      note: 'You can now sign in with your email and password'
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ 
      error: 'Registration failed',
      details: error.message 
    });
  }
}