import { Router } from 'express';
import { requireMerchantAuth, AuthenticatedRequest } from '../middleware/auth';
import { complianceService } from '../services/complianceService';

const router = Router();

// Get compliance overview
router.get('/status', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as AuthenticatedRequest).merchant;
    const status = await complianceService.getMerchantCompliance(merchant.id);
    res.json(status);
  } catch (error) {
    console.error('Compliance status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get screening history
router.get('/screenings', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as AuthenticatedRequest).merchant;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const screenings = await complianceService.getScreenings(merchant.id, limit);
    res.json({ screenings });
  } catch (error) {
    console.error('Screenings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manually screen a wallet
router.post('/screen-wallet', requireMerchantAuth, async (req, res) => {
  try {
    const { address, chain } = req.body;
    if (!address) return res.status(400).json({ error: 'Address required' });

    const result = await complianceService.screenWallet(address, chain || 'BASE_MAINNET');
    res.json(result);
  } catch (error) {
    console.error('Screen wallet error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export screenings as CSV
router.get('/export', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as AuthenticatedRequest).merchant;
    const screenings = await complianceService.getScreenings(merchant.id, 10000);

    const csv = [
      'Date,Address,Chain,Risk Score,Risk Level,Flags,Order ID',
      ...screenings.map(s =>
        `${s.createdAt.toISOString()},${s.address},${s.chain},${s.riskScore},${s.riskLevel},"${s.flags.join('; ')}",${s.orderId || ''}`
      ),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=compliance-export-${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const complianceRouter = router;
