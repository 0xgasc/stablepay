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
    console.log('Request body:', req.body);
    
    const { companyName, contactName, email, password } = req.body;
    
    console.log('Extracted fields:', { companyName, contactName, email, password: password ? 'EXISTS' : 'MISSING' });

    if (!companyName || !contactName || !email || !password) {
      return res.status(400).json({ 
        error: 'All fields are required',
        received: { companyName: !!companyName, contactName: !!contactName, email: !!email, password: !!password }
      });
    }

    // Just return success without database for now
    return res.status(201).json({
      success: true,
      message: 'Test registration successful',
      data: { companyName, contactName, email }
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ 
      error: 'Registration failed',
      details: error.message,
      stack: error.stack
    });
  }
}