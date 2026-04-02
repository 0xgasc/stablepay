import { Router } from 'express';
import { db } from '../config/database';
import { requireMerchantAuth, AuthenticatedRequest } from '../middleware/auth';
import { PRO_SUBSCRIPTION_PRICE } from '../config/pricing';
import { logger } from '../utils/logger';

const router = Router();

// Platform wallet for receiving PRO subscription payments
const PLATFORM_WALLET = process.env.STABLEPAY_FEE_WALLET?.trim() || process.env.AGENT_WALLET_ADDRESS?.trim() || '';

/**
 * GET /api/upgrade/status — check PRO status
 */
router.get('/status', requireMerchantAuth, async (req, res) => {
  const merchant = (req as AuthenticatedRequest).merchant;
  const full = await db.merchant.findUnique({
    where: { id: merchant.id },
    select: { plan: true, proExpiresAt: true, monthlyVolumeUsed: true },
  });

  if (!full) return res.status(404).json({ error: 'Merchant not found' });

  const volume = Number(full.monthlyVolumeUsed || 0);
  const isPro = full.plan === 'PRO' || full.plan === 'ENTERPRISE' || full.plan === 'GROWTH'
    || volume >= 5000
    || (full.proExpiresAt && full.proExpiresAt > new Date());

  res.json({
    plan: full.plan,
    isPro,
    proExpiresAt: full.proExpiresAt,
    monthlyVolume: volume,
    autoUnlockAt: 5000,
    subscriptionPrice: PRO_SUBSCRIPTION_PRICE,
    reason: isPro
      ? full.plan === 'PRO' ? 'Plan is PRO'
        : volume >= 5000 ? 'Auto-unlocked at $5k volume'
        : full.proExpiresAt ? 'Active subscription'
        : 'Plan includes PRO'
      : 'FREE plan',
  });
});

/**
 * POST /api/upgrade/pro — create a payment link for PRO subscription
 * Returns a checkout URL that the merchant pays to upgrade
 */
router.post('/pro', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as AuthenticatedRequest).merchant;

    // Check if already PRO
    const full = await db.merchant.findUnique({
      where: { id: merchant.id },
      select: { plan: true, proExpiresAt: true, monthlyVolumeUsed: true },
    });

    if (!full) return res.status(404).json({ error: 'Merchant not found' });

    const volume = Number(full.monthlyVolumeUsed || 0);
    if (full.plan === 'PRO' || full.plan === 'ENTERPRISE' || volume >= 5000) {
      return res.json({ isPro: true, message: 'Already have PRO access' });
    }

    if (full.proExpiresAt && full.proExpiresAt > new Date()) {
      return res.json({ isPro: true, message: 'PRO subscription still active', expiresAt: full.proExpiresAt });
    }

    if (!PLATFORM_WALLET) {
      return res.status(500).json({ error: 'Platform wallet not configured' });
    }

    // Create a payment link for the PRO subscription
    const crypto = await import('crypto');
    const slug = crypto.randomBytes(4).toString('hex');

    const link = await db.paymentLink.create({
      data: {
        merchantId: merchant.id,
        slug: `pro-${slug}`,
        amount: PRO_SUBSCRIPTION_PRICE,
        token: 'USDC',
        productName: 'StablePay PRO — 30 days',
        description: 'PRO plan subscription. Unlocks refunds, receipts, custom branding, unlimited payment links.',
        externalId: `pro-upgrade-${merchant.id}`,
        isActive: true,
      },
    });

    const BASE_URL = (process.env.BASE_URL || 'https://wetakestables.shop').trim();
    const checkoutUrl = `${BASE_URL}/pay/${link.slug}`;

    logger.info('PRO upgrade initiated', {
      merchantId: merchant.id,
      linkId: link.id,
      slug: link.slug,
      event: 'upgrade.initiated',
    });

    res.json({
      success: true,
      checkoutUrl,
      slug: link.slug,
      amount: PRO_SUBSCRIPTION_PRICE,
      token: 'USDC',
      message: `Pay $${PRO_SUBSCRIPTION_PRICE} USDC to upgrade to PRO. Link: ${checkoutUrl}`,
    });
  } catch (error) {
    console.error('PRO upgrade error:', error);
    res.status(500).json({ error: 'Failed to create upgrade link' });
  }
});

/**
 * Called by orderService when a PRO payment is confirmed
 * (checked via externalId starting with 'pro-upgrade-')
 */
export async function handleProPaymentConfirmed(orderId: string): Promise<boolean> {
  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { externalId: true, amount: true, merchantId: true },
    });

    if (!order?.externalId?.startsWith('pro-upgrade-') || !order.merchantId) return false;

    // Verify amount is correct
    if (Number(order.amount) < PRO_SUBSCRIPTION_PRICE * 0.999) return false;

    // Set PRO for 30 days
    const proExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.merchant.update({
      where: { id: order.merchantId },
      data: { proExpiresAt },
    });

    logger.info('PRO subscription activated', {
      merchantId: order.merchantId,
      orderId,
      expiresAt: proExpiresAt.toISOString(),
      event: 'upgrade.activated',
    });

    return true;
  } catch (err) {
    console.error('handleProPaymentConfirmed error:', err);
    return false;
  }
}

export const upgradeRouter = router;
