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

    console.log('Testing Supabase connection...');
    console.log('URL:', supabaseUrl);
    console.log('API Key exists:', !!apiKey);
    console.log('Runtime environment:', typeof fetch);

    // Test 1: Simple GET request to merchants table
    const testResponse = await fetch(`${supabaseUrl}/rest/v1/merchants?limit=1`, {
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Test response status:', testResponse.status);
    console.log('Test response ok:', testResponse.ok);

    const responseText = await testResponse.text();
    console.log('Response text:', responseText);

    return res.status(200).json({
      supabaseTest: {
        url: supabaseUrl,
        hasApiKey: !!apiKey,
        fetchAvailable: typeof fetch !== 'undefined',
        responseStatus: testResponse.status,
        responseOk: testResponse.ok,
        responseText: responseText.substring(0, 200) // First 200 chars
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        runtime: typeof globalThis,
        crypto: typeof crypto,
        fetch: typeof fetch
      }
    });

  } catch (error) {
    console.error('Supabase test error:', error);
    return res.status(500).json({ 
      error: 'Test failed',
      details: error.message,
      stack: error.stack,
      type: error.constructor.name
    });
  }
}