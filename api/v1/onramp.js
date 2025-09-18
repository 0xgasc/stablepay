/**
 * StablePay Onramp/Offramp API
 * Convert between fiat and USDC
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

  const path = req.url.split('?')[0];
  const endpoint = path.split('/').filter(Boolean).pop();

  try {
    if (req.method === 'POST' && endpoint === 'quote') {
      // Get conversion quote
      const { amount, sourceCurrency, destinationCurrency, direction } = req.body;

      if (!amount || !sourceCurrency || !destinationCurrency) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['amount', 'sourceCurrency', 'destinationCurrency']
        });
      }

      // Mock exchange rates
      const rates = {
        'USD_USDC': 1.0,
        'USDC_USD': 1.0,
        'EUR_USDC': 1.08,
        'USDC_EUR': 0.93
      };

      const rateKey = `${sourceCurrency}_${destinationCurrency}`;
      const rate = rates[rateKey] || 1.0;
      const convertedAmount = (parseFloat(amount) * rate).toFixed(2);
      const fee = (parseFloat(amount) * 0.015).toFixed(2); // 1.5% fee
      const total = (parseFloat(convertedAmount) + parseFloat(fee)).toFixed(2);

      return res.status(200).json({
        quoteId: 'quote_' + Date.now(),
        amount: amount,
        sourceCurrency,
        destinationCurrency,
        exchangeRate: rate,
        convertedAmount,
        fee,
        total,
        expiresAt: new Date(Date.now() + 60000).toISOString() // 1 minute
      });
    }

    if (req.method === 'POST' && endpoint === 'create') {
      // Create onramp transaction
      const {
        amount,
        sourceCurrency,
        destinationCurrency,
        paymentMethod,
        destinationAddress,
        email,
        quoteId
      } = req.body;

      if (!amount || !destinationAddress || !email) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['amount', 'destinationAddress', 'email']
        });
      }

      const transactionId = 'onramp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

      // Create payment intent (would integrate with Stripe/payment processor)
      const paymentIntent = {
        id: transactionId,
        amount,
        sourceCurrency: sourceCurrency || 'USD',
        destinationCurrency: destinationCurrency || 'USDC',
        destinationAddress,
        email,
        status: 'pending',
        paymentMethod: paymentMethod || 'card',
        paymentUrl: `https://stablepay-nine.vercel.app/onramp/${transactionId}`,
        createdAt: new Date().toISOString()
      };

      console.log('Creating onramp transaction:', paymentIntent);

      return res.status(201).json({
        id: transactionId,
        status: 'pending',
        paymentUrl: paymentIntent.paymentUrl,
        amount,
        destinationAddress,
        estimatedArrival: new Date(Date.now() + 5 * 60000).toISOString() // 5 minutes
      });
    }

    if (req.method === 'POST' && endpoint === 'offramp') {
      // Create offramp transaction (USDC to fiat)
      const { amount, bankAccount, walletAddress, email } = req.body;

      if (!amount || !bankAccount || !walletAddress) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['amount', 'bankAccount', 'walletAddress']
        });
      }

      const transactionId = 'offramp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

      return res.status(201).json({
        id: transactionId,
        status: 'pending',
        amount,
        bankAccount: bankAccount.slice(-4), // Last 4 digits only
        estimatedArrival: '2-3 business days',
        fee: (parseFloat(amount) * 0.01).toFixed(2), // 1% fee
        total: (parseFloat(amount) * 0.99).toFixed(2)
      });
    }

    if (req.method === 'GET') {
      // Get transaction status
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'Transaction ID required' });
      }

      return res.status(200).json({
        id,
        status: 'completed',
        amount: '100.00',
        sourceCurrency: 'USD',
        destinationCurrency: 'USDC',
        transactionHash: '0x' + Math.random().toString(36).substring(2, 15),
        completedAt: new Date().toISOString()
      });
    }

    return res.status(404).json({ error: 'Endpoint not found' });
  } catch (error) {
    console.error('Onramp API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}