/**
 * StablePay Wallet API
 * Create and manage customer wallets (invisible crypto wallets)
 */

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-API-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const supabaseUrl = 'https://lxbrsiujmntrvzqdphhj.supabase.co';
  const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YnJzaXVqbW50cnZ6cWRwaGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0OTI4ODUsImV4cCI6MjA3MjA2ODg4NX0.77bxwJTUvcEzzegd7WBi_UvJkcmKgtpyS1KKxHNFBjE';

  try {
    if (req.method === 'POST') {
      // Create customer wallet
      const { email, name, chain, merchantId } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      // Generate deterministic wallet address from email
      // In production, use proper key derivation
      const walletSeed = email + '_' + (chain || 'base');
      const walletAddress = '0x' + Buffer.from(walletSeed).toString('hex').substring(0, 40);
      const walletId = 'wallet_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

      // Create wallet record
      const walletData = {
        id: walletId,
        email,
        name: name || null,
        walletAddress,
        chain: chain || 'base',
        merchantId: merchantId || null,
        createdAt: new Date().toISOString(),
        isActive: true
      };

      // TODO: Store in database
      console.log('Creating wallet:', walletData);

      return res.status(201).json({
        id: walletId,
        address: walletAddress,
        chain: chain || 'base',
        email: email,
        status: 'active',
        balance: {
          USDC: '0',
          native: '0'
        }
      });
    }

    if (req.method === 'GET') {
      const { id, email } = req.query;

      if (!id && !email) {
        return res.status(400).json({ error: 'Wallet ID or email required' });
      }

      // Mock wallet data
      const mockWallet = {
        id: id || 'wallet_demo',
        address: '0x' + Buffer.from(email || 'demo').toString('hex').substring(0, 40),
        chain: 'base',
        email: email || 'demo@example.com',
        status: 'active',
        balance: {
          USDC: '100.00',
          native: '0.01'
        },
        transactions: [
          {
            hash: '0x123...',
            amount: '50.00',
            currency: 'USDC',
            type: 'received',
            timestamp: new Date().toISOString()
          }
        ]
      };

      return res.status(200).json(mockWallet);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Wallet API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}