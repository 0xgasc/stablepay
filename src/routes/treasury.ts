import { Router } from 'express';
import { requireMerchantAuth, AuthenticatedRequest } from '../middleware/auth';
import { treasuryService } from '../services/treasuryService';

const router = Router();

// Get all wallet balances
router.get('/balances', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as AuthenticatedRequest).merchant;
    const data = await treasuryService.getMerchantBalances(merchant.id);
    res.json(data);
  } catch (error) {
    console.error('Treasury balances error:', error);
    res.status(500).json({ error: 'Failed to fetch balances' });
  }
});

// Get recent incoming payments
router.get('/incoming', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as AuthenticatedRequest).merchant;
    const days = Math.min(parseInt(req.query.days as string) || 7, 90);
    const data = await treasuryService.getRecentIncoming(merchant.id, days);
    res.json(data);
  } catch (error) {
    console.error('Treasury incoming error:', error);
    res.status(500).json({ error: 'Failed to fetch incoming data' });
  }
});

export const treasuryRouter = router;
