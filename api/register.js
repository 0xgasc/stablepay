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
    const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YnJzaXVqbW50cnZ6cWRwaGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0OTI4ODUsImV4cCI6MjA3MjA2ODg4NX0.77bxwJTUvcEzzegd7WBi_UvJkcmKgtpyS1KKxHNFBjE';

    // Generate a simple token
    const loginToken = 'token_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);

    // Create merchant with only the fields that exist in the schema
    const merchantData = {
      companyName,
      contactName,
      email,
      role: 'MERCHANT'
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

    console.log('Registration successful for:', email, 'ID:', merchantId);

    return res.status(201).json({
      success: true,
      message: 'Registration successful! Your account has been created.',
      merchantId: merchantId,
      devToken: loginToken,
      loginUrl: `/dashboard.html?token=${loginToken}&merchant=${merchantId}`,
      note: 'Account created in database - click Login Now to access dashboard'
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ 
      error: 'Registration failed',
      details: error.message 
    });
  }
}