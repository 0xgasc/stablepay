export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const supabaseUrl = 'https://lxbrsiujmntrvzqdphhj.supabase.co';
  const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YnJzaXVqbW50cnZ6cWRwaGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0OTI4ODUsImV4cCI6MjA3MjA2ODg4NX0.77bxwJTUvcEzzegd7WBi_UvJkcmKgtpyS1KKxHNFBjE';

  try {
    if (req.method === 'GET') {
      // Get merchant by ID or token
      const { id, token } = req.query;
      
      if (!id && !token) {
        return res.status(400).json({ error: 'Merchant ID or token required' });
      }

      let query = id ? `id=eq.${id}` : `loginToken=eq.${token}`;
      
      const response = await fetch(`${supabaseUrl}/rest/v1/merchants?${query}&select=*`, {
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch merchant');
      }

      const merchants = await response.json();
      
      if (merchants.length === 0) {
        return res.status(404).json({ error: 'Merchant not found' });
      }

      const merchant = merchants[0];
      
      // Don't send sensitive data
      delete merchant.passwordHash;
      delete merchant.loginToken;
      
      return res.status(200).json(merchant);
    }

    if (req.method === 'PATCH') {
      // Update merchant details
      const { id } = req.query;
      const updates = req.body;
      
      if (!id) {
        return res.status(400).json({ error: 'Merchant ID required' });
      }

      // Only allow certain fields to be updated
      const allowedFields = ['companyName', 'contactName', 'email', 'isActive', 'setupCompleted'];
      const filteredUpdates = {};
      
      for (const key of allowedFields) {
        if (updates[key] !== undefined) {
          filteredUpdates[key] = updates[key];
        }
      }

      const response = await fetch(`${supabaseUrl}/rest/v1/merchants?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(filteredUpdates)
      });

      if (!response.ok) {
        throw new Error('Failed to update merchant');
      }

      const updated = await response.json();
      return res.status(200).json(updated[0] || updated);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Merchant API error:', error);
    return res.status(500).json({ 
      error: 'Request failed',
      details: error.message 
    });
  }
}