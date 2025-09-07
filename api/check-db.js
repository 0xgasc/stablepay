export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = 'https://lxbrsiujmntrvzqdphhj.supabase.co';
    const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YnJzaXVqbW50cnZ6cWRwaGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU0OTMzNDksImV4cCI6MjA1MTA2OTM0OX0.WXJYoHgfG6BvsBU2VFJrEQZJgMSMjc9d-MhOVGLfSKo';

    const results = {
      timestamp: new Date().toISOString(),
      tables: {}
    };

    // Check each table
    const tables = ['merchants', 'merchant_wallets', 'orders', 'transactions', 'refunds', 'chain_configs'];
    
    for (const table of tables) {
      try {
        const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&limit=1`, {
          headers: {
            'apikey': apiKey,
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          results.tables[table] = {
            exists: true,
            accessible: true,
            count: Array.isArray(data) ? data.length : 0,
            status: 'OK'
          };
        } else {
          const error = await response.text();
          results.tables[table] = {
            exists: false,
            accessible: false,
            error: error,
            status: `ERROR: ${response.status}`
          };
        }
      } catch (err) {
        results.tables[table] = {
          exists: 'unknown',
          accessible: false,
          error: err.message,
          status: 'EXCEPTION'
        };
      }
    }

    return res.status(200).json(results);
  } catch (error) {
    console.error('Database check error:', error);
    return res.status(500).json({ 
      error: 'Database check failed',
      details: error.message 
    });
  }
}