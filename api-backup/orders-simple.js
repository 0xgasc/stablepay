export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      // Use direct SQL via fetch to Supabase REST API
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const apiKey = process.env.SUPABASE_ANON_KEY;

      // Fetch orders with pagination
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const offset = (page - 1) * limit;
      const networkMode = req.query.networkMode || 'TESTNET';

      // Define chain filters based on network mode
      const getTestnetChains = () => ['BASE_SEPOLIA', 'ETHEREUM_SEPOLIA', 'POLYGON_MUMBAI', 'ARBITRUM_SEPOLIA', 'SOLANA_DEVNET'];
      const getMainnetChains = () => ['BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'SOLANA_MAINNET'];

      const allowedChains = networkMode === 'TESTNET' ? getTestnetChains() : getMainnetChains();
      const chainFilter = allowedChains.map(c => `"${c}"`).join(',');

      // Get orders
      const ordersResponse = await fetch(`${supabaseUrl}/rest/v1/orders?chain=in.(${chainFilter})&order=createdAt.desc&limit=${limit}&offset=${offset}&select=*`, {
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!ordersResponse.ok) {
        throw new Error(`Failed to fetch orders: ${ordersResponse.statusText}`);
      }

      const orders = await ordersResponse.json();

      // Get total count
      const countResponse = await fetch(`${supabaseUrl}/rest/v1/orders?chain=in.(${chainFilter})&select=*&head=true`, {
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'count=exact'
        }
      });

      const total = parseInt(countResponse.headers.get('content-range')?.split('/')[1] || '0');

      // Get transactions for each order (simplified - in production you'd use joins)
      const ordersWithTransactions = await Promise.all(
        orders.map(async (order) => {
          try {
            const txResponse = await fetch(`${supabaseUrl}/rest/v1/transactions?orderId=eq.${order.id}&select=*`, {
              headers: {
                'apikey': apiKey,
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
              }
            });
            
            const transactions = txResponse.ok ? await txResponse.json() : [];
            return {
              ...order,
              transactions,
              transactionCount: transactions.length
            };
          } catch (err) {
            console.error('Error fetching transactions for order', order.id, err);
            return {
              ...order,
              transactions: [],
              transactionCount: 0
            };
          }
        })
      );

      return res.status(200).json({
        orders: ordersWithTransactions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          pages: Math.ceil(total / limit) // For backwards compatibility
        }
      });
    }

    if (req.method === 'POST') {
      // Create new order
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const apiKey = process.env.SUPABASE_ANON_KEY;

      const {
        amount,
        chain,
        customerEmail,
        customerName,
        description
      } = req.body;

      // Validate required fields
      if (!amount || !chain) {
        return res.status(400).json({ error: 'Amount and chain are required' });
      }

      // Validate amount is positive number
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'Amount must be a positive number' });
      }

      // Validate chain value
      const validChains = ['BASE_SEPOLIA', 'ETHEREUM_SEPOLIA', 'POLYGON_MUMBAI', 'ARBITRUM_SEPOLIA', 'SOLANA_DEVNET', 'BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET', 'SOLANA_MAINNET'];
      if (!validChains.includes(chain)) {
        return res.status(400).json({ error: 'Invalid chain' });
      }

      // Validate email if provided
      if (customerEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customerEmail)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }
      }

      const orderData = {
        amount: parsedAmount,
        chain,
        customerEmail,
        customerName,
        description,
        status: 'PENDING',
        paymentAddress: '0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutes
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const createResponse = await fetch(`${supabaseUrl}/rest/v1/orders`, {
        method: 'POST',
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(orderData)
      });

      if (!createResponse.ok) {
        throw new Error(`Failed to create order: ${createResponse.statusText}`);
      }

      const newOrder = await createResponse.json();

      return res.status(201).json(newOrder[0] || newOrder);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
}