import { Router } from 'express';
import { db } from '../config/database';
import { rateLimit } from '../middleware/rateLimit';
import { agentService } from '../services/agentService';

const router = Router();

// Helper: verify merchant token from Authorization header
async function authenticateMerchant(req: any) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) return null;

  const merchant = await db.merchant.findFirst({
    where: { loginToken: token },
  });

  if (!merchant) return null;
  if (merchant.tokenExpiresAt && new Date() > merchant.tokenExpiresAt) return null;

  return merchant;
}

// ─── Chat with AI agent ─────────────────────────────────────────────────────
router.post('/chat', rateLimit({
  getMerchantId: async (req) => {
    const merchant = await authenticateMerchant(req);
    return merchant?.id || null;
  },
  limitAnonymous: true,
  anonymousLimit: 5,
}), async (req, res) => {
  try {
    const merchant = await authenticateMerchant(req);
    if (!merchant) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { message } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    }

    const response = await agentService.chat(merchant.id, message.trim());

    res.json({ success: true, response });
  } catch (error) {
    console.error('Agent chat error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get chat history ───────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const merchant = await authenticateMerchant(req);
    if (!merchant) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const messages = await agentService.getHistory(merchant.id, limit);

    res.json({ success: true, messages });
  } catch (error) {
    console.error('Agent history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Clear chat history ─────────────────────────────────────────────────────
router.delete('/history', async (req, res) => {
  try {
    const merchant = await authenticateMerchant(req);
    if (!merchant) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await agentService.clearHistory(merchant.id);

    res.json({ success: true, message: 'Chat history cleared' });
  } catch (error) {
    console.error('Agent clear history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Record agent tip ───────────────────────────────────────────────────────
router.post('/tip', async (req, res) => {
  try {
    const merchant = await authenticateMerchant(req);
    if (!merchant) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { amount, token, chain, txHash, fromAddress } = req.body;

    if (!amount || !chain || !fromAddress) {
      return res.status(400).json({ error: 'amount, chain, and fromAddress are required' });
    }

    const tip = await db.agentTip.create({
      data: {
        merchantId: merchant.id,
        amount: parseFloat(amount),
        token: token || 'USDC',
        chain,
        txHash: txHash || null,
        fromAddress,
      },
    });

    res.json({ success: true, tipId: tip.id, message: 'Tip recorded! Thank you!' });
  } catch (error) {
    console.error('Agent tip error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get agent wallet address for tipping ───────────────────────────────────
router.get('/tip-wallet', async (req, res) => {
  // Agent's own wallet — receives tips directly
  const agentAddress = process.env.AGENT_WALLET_ADDRESS;
  res.json({
    evm: agentAddress || '0x0000000000000000000000000000000000000000',
    solana: '',
    tokens: {
      BASE_SEPOLIA: { USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
      BASE_MAINNET: { USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
      ETHEREUM_MAINNET: { USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
    },
  });
});

export const agentRouter = router;
