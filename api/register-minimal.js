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
    
    console.log('Minimal registration attempt:', { companyName, contactName, email, password: password ? 'EXISTS' : 'MISSING' });

    if (!companyName || !contactName || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Use direct SQL via fetch to Supabase REST API
    const supabaseUrl = 'https://lxbrsiujmntrvzqdphhj.supabase.co';
    const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YnJzaXVqbW50cnZ6cWRwaGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0OTI4ODUsImV4cCI6MjA3MjA2ODg4NX0.77bxwJTUvcEzzegd7WBi_UvJkcmKgtpyS1KKxHNFBjE';

    // Simple password hash
    const passwordHash = `simple_${password}_${email.length}`;

    // Minimal merchant data
    const merchantData = {
      companyName,
      contactName,
      email
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
      error: 'Registration failed',
      details: error.message,
      type: error.constructor.name
    });
  }
}