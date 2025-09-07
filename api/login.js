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
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Use direct SQL via fetch to Supabase REST API
    const supabaseUrl = 'https://lxbrsiujmntrvzqdphhj.supabase.co';
    const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YnJzaXVqbW50cnZ6cWRwaGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0OTI4ODUsImV4cCI6MjA3MjA2ODg4NX0.77bxwJTUvcEzzegd7WBi_UvJkcmKgtpyS1KKxHNFBjE';

    // Hash password same way as registration
    let passwordHash = '';
    for (let i = 0; i < password.length; i++) {
      passwordHash += (password.charCodeAt(i) + email.length).toString(16);
    }
    passwordHash = passwordHash + '_' + email.length.toString(16);

    // Find merchant with matching email and password hash
    const response = await fetch(`${supabaseUrl}/rest/v1/merchants?email=eq.${encodeURIComponent(email)}&passwordHash=eq.${passwordHash}&select=*`, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Supabase login error:', errorText);
      throw new Error('Database error');
    }

    const merchants = await response.json();

    if (merchants.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const merchant = merchants[0];

    // Generate a new login token
    const loginToken = 'token_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);

    // Update merchant with new login token
    await fetch(`${supabaseUrl}/rest/v1/merchants?id=eq.${merchant.id}`, {
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

    console.log('Login successful for:', email, 'ID:', merchant.id);

    return res.status(200).json({
      success: true,
      token: loginToken,
      merchantId: merchant.id,
      companyName: merchant.companyName,
      contactName: merchant.contactName
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ 
      error: 'Login failed',
      details: error.message 
    });
  }
}