/**
 * StablePay Checkout API
 * Create and manage checkout sessions
 */

export default async function handler(req, res) {
  // Enable CORS for widget
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-API-Key,X-Widget-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const apiKey = process.env.SUPABASE_ANON_KEY;

  // Parse the path to determine the endpoint
  const path = req.url.split('?')[0];
  const segments = path.split('/').filter(Boolean);
  const endpoint = segments[segments.length - 1];

  try {
    if (req.method === 'POST' && endpoint === 'sessions') {
      // Create checkout session
      const { amount, currency, merchantId, recipient, metadata, successUrl, cancelUrl } = req.body;

      if (!amount || !merchantId) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['amount', 'merchantId']
        });
      }

      // Validate amount
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'Amount must be a positive number' });
      }

      // Validate redirect URLs if provided
      if (successUrl) {
        try {
          const url = new URL(successUrl);
          if (!['http:', 'https:'].includes(url.protocol)) {
            return res.status(400).json({ error: 'Invalid successUrl protocol' });
          }
        } catch {
          return res.status(400).json({ error: 'Invalid successUrl format' });
        }
      }

      if (cancelUrl) {
        try {
          const url = new URL(cancelUrl);
          if (!['http:', 'https:'].includes(url.protocol)) {
            return res.status(400).json({ error: 'Invalid cancelUrl protocol' });
          }
        } catch {
          return res.status(400).json({ error: 'Invalid cancelUrl format' });
        }
      }

      // Generate session ID
      const sessionId = 'cs_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

      // Create checkout session in database
      const sessionData = {
        id: sessionId,
        merchantId,
        amount: parsedAmount,
        currency: currency || 'USDC',
        status: 'pending',
        recipient: recipient || null,
        successUrl: successUrl || null,
        cancelUrl: cancelUrl || null,
        metadata: metadata || {},
        createdAt: new Date().toISOString()
      };

      // Store session (would normally go to database)
      console.log('Creating checkout session:', sessionData);

      return res.status(201).json({
        id: sessionId,
        status: 'pending',
        amount: parsedAmount,
        currency: currency || 'USDC',
        paymentUrl: `https://stablepay-nine.vercel.app/pay/${sessionId}`,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 minutes
      });
    }

    if (req.method === 'GET' && endpoint.startsWith('cs_')) {
      // Get checkout session
      const sessionId = endpoint;

      // TODO: Fetch from database
      return res.status(200).json({
        id: sessionId,
        status: 'pending',
        amount: 100,
        currency: 'USDC',
        merchantId: 'merchant_demo',
        createdAt: new Date().toISOString()
      });
    }

    if (req.method === 'POST' && endpoint === 'complete') {
      // Complete checkout session
      const { sessionId, transactionHash, walletAddress } = req.body;

      if (!sessionId || !transactionHash) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // TODO: Update session in database
      console.log('Completing checkout:', { sessionId, transactionHash, walletAddress });

      return res.status(200).json({
        id: sessionId,
        status: 'completed',
        transactionHash,
        completedAt: new Date().toISOString()
      });
    }

    return res.status(404).json({ error: 'Endpoint not found' });
  } catch (error) {
    console.error('Checkout API error:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
}