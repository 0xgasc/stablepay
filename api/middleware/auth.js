/**
 * Authentication middleware for API endpoints
 * Validates API keys and merchant tokens
 */

export async function validateApiKey(req, res) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    res.status(401).json({ error: 'API key required' });
    return false;
  }

  // Validate API key format
  if (!apiKey.startsWith('sk_') && !apiKey.startsWith('pk_')) {
    res.status(401).json({ error: 'Invalid API key format' });
    return false;
  }

  // Verify API key exists in database
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/api_keys?key=eq.${apiKey}&isActive=eq.true&select=*`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      res.status(500).json({ error: 'Authentication service error' });
      return false;
    }

    const keys = await response.json();

    if (keys.length === 0) {
      res.status(401).json({ error: 'Invalid or inactive API key' });
      return false;
    }

    // Attach merchant info to request for later use
    req.merchantId = keys[0].merchantId;
    return true;
  } catch (error) {
    console.error('API key validation error:', error);
    res.status(500).json({ error: 'Authentication failed' });
    return false;
  }
}

export async function validateMerchantToken(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'Authentication token required' });
    return false;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/merchants?loginToken=eq.${token}&select=*`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      res.status(500).json({ error: 'Authentication service error' });
      return false;
    }

    const merchants = await response.json();

    if (merchants.length === 0) {
      res.status(401).json({ error: 'Invalid authentication token' });
      return false;
    }

    const merchant = merchants[0];

    // Check token expiration
    if (merchant.tokenExpiresAt && new Date(merchant.tokenExpiresAt) < new Date()) {
      res.status(401).json({ error: 'Authentication token expired' });
      return false;
    }

    // Attach merchant info to request
    req.merchantId = merchant.id;
    req.merchant = merchant;
    return true;
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ error: 'Authentication failed' });
    return false;
  }
}
