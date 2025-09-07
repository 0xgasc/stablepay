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
    // Use direct SQL via fetch to Supabase REST API
    const supabaseUrl = 'https://lxbrsiujmntrvzqdphhj.supabase.co';
    const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YnJzaXVqbW50cnZ6cWRwaGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU0OTMzNDksImV4cCI6MjA1MTA2OTM0OX0.WXJYoHgfG6BvsBU2VFJrEQZJgMSMjc9d-MhOVGLfSKo';

    // Create a few test orders
    const testOrders = [
      {
        id: 'ord_test_1',
        amount: 100,
        chain: 'BASE_SEPOLIA',
        status: 'PAID',
        customerEmail: 'customer1@example.com',
        customerName: 'John Doe',
        paymentAddress: '0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF',
        description: 'Test payment 1',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'ord_test_2',
        amount: 50,
        chain: 'ETHEREUM_SEPOLIA',
        status: 'PENDING',
        customerEmail: 'customer2@example.com',
        customerName: 'Jane Smith',
        paymentAddress: '0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF',
        description: 'Test payment 2',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'ord_test_3',
        amount: 250,
        chain: 'BASE_SEPOLIA',
        status: 'CONFIRMED',
        customerEmail: 'customer3@example.com',
        customerName: 'Bob Wilson',
        paymentAddress: '0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF',
        description: 'Test payment 3',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    // Insert each test order
    const results = [];
    for (const order of testOrders) {
      const createResponse = await fetch(`${supabaseUrl}/rest/v1/orders`, {
        method: 'POST',
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(order)
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error(`Failed to create order ${order.id}:`, errorText);
        continue;
      }

      const created = await createResponse.json();
      results.push(created[0] || created);
    }

    return res.status(201).json({
      success: true,
      message: `Created ${results.length} test orders`,
      orders: results
    });
  } catch (error) {
    console.error('Create test orders error:', error);
    return res.status(500).json({ 
      error: 'Failed to create test orders',
      details: error.message 
    });
  }
}