export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const supabaseUrl = 'https://lxbrsiujmntrvzqdphhj.supabase.co';
    const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YnJzaXVqbW50cnZ6cWRwaGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0OTI4ODUsImV4cCI6MjA3MjA2ODg4NX0.77bxwJTUvcEzzegd7WBi_UvJkcmKgtpyS1KKxHNFBjE';

    // Test 1: Check if merchants table exists and get its structure
    console.log('Testing merchants table...');
    
    const testResponse = await fetch(`${supabaseUrl}/rest/v1/merchants?limit=1`, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const result = {
      merchantsTableTest: {
        status: testResponse.status,
        ok: testResponse.ok,
        statusText: testResponse.statusText
      }
    };

    if (testResponse.ok) {
      const data = await testResponse.json();
      result.merchantsTableTest.data = data;
    } else {
      result.merchantsTableTest.errorText = await testResponse.text();
    }

    // Test 2: Try creating a minimal record
    if (testResponse.ok) {
      console.log('Testing merchant creation...');
      
      const testMerchant = {
        email: `test_${Date.now()}@example.com`,
        companyName: 'Test Company',
        contactName: 'Test Contact'
      };

      const createResponse = await fetch(`${supabaseUrl}/rest/v1/merchants`, {
        method: 'POST',
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(testMerchant)
      });

      result.createTest = {
        status: createResponse.status,
        ok: createResponse.ok,
        statusText: createResponse.statusText
      };

      if (createResponse.ok) {
        result.createTest.data = await createResponse.json();
      } else {
        result.createTest.errorText = await createResponse.text();
      }
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Database test error:', error);
    return res.status(500).json({ 
      error: 'Database test failed',
      details: error.message 
    });
  }
}