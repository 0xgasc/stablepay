import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../config/database';
import { requireMerchantAuth } from '../middleware/auth';
import { getFeatures } from '../config/pricing';
import { logger } from '../utils/logger';

const router = Router();

function generateSlug(): string {
  return crypto.randomBytes(4).toString('hex'); // 8 chars
}

const createLinkSchema = z.object({
  amount: z.number().positive(),
  token: z.enum(['USDC', 'USDT', 'EURC']).default('USDC'),
  chains: z.array(z.string()).optional(),
  productName: z.string().optional(),
  description: z.string().optional(),
  externalId: z.string().optional(),
});

// Create payment link
router.post('/', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const data = createLinkSchema.parse(req.body);

    // Check link limit for FREE plan
    const features = getFeatures(merchant.plan, Number(merchant.monthlyVolumeUsed) || 0, merchant.proExpiresAt);
    if (features.maxPaymentLinks !== null) {
      const activeCount = await db.paymentLink.count({
        where: { merchantId: merchant.id, isActive: true },
      });
      if (activeCount >= features.maxPaymentLinks) {
        return res.status(403).json({
          error: `Payment link limit reached (${features.maxPaymentLinks} active links on Free plan)`,
          upgradeRequired: true,
        });
      }
    }

    const slug = generateSlug();
    const link = await db.paymentLink.create({
      data: {
        merchantId: merchant.id,
        slug,
        amount: data.amount,
        token: data.token,
        chains: data.chains || [],
        productName: data.productName,
        description: data.description,
        externalId: data.externalId,
      },
    });

    const BASE_URL = (process.env.BASE_URL || 'https://wetakestables.shop').trim();

    res.status(201).json({
      success: true,
      link: {
        ...link,
        amount: Number(link.amount),
        totalCollected: Number(link.totalCollected),
        url: `${BASE_URL}/pay/${slug}`,
        shortUrl: `/pay/${slug}`,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Create payment link error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List payment links
router.get('/', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const links = await db.paymentLink.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
    });

    const BASE_URL = (process.env.BASE_URL || 'https://wetakestables.shop').trim();

    res.json({
      links: links.map(l => ({
        ...l,
        amount: Number(l.amount),
        totalCollected: Number(l.totalCollected),
        url: `${BASE_URL}/pay/${l.slug}`,
      })),
    });
  } catch (error) {
    console.error('List payment links error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update payment link
router.patch('/:id', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const { id } = req.params;
    const { isActive, productName, description, amount } = req.body;

    const link = await db.paymentLink.findUnique({ where: { id } });
    if (!link || link.merchantId !== merchant.id) {
      return res.status(404).json({ error: 'Payment link not found' });
    }

    const updated = await db.paymentLink.update({
      where: { id },
      data: {
        ...(isActive !== undefined && { isActive }),
        ...(productName !== undefined && { productName }),
        ...(description !== undefined && { description }),
        ...(amount !== undefined && { amount }),
      },
    });

    res.json({ success: true, link: { ...updated, amount: Number(updated.amount) } });
  } catch (error) {
    console.error('Update payment link error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete payment link
router.delete('/:id', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const { id } = req.params;

    const link = await db.paymentLink.findUnique({ where: { id } });
    if (!link || link.merchantId !== merchant.id) {
      return res.status(404).json({ error: 'Payment link not found' });
    }

    await db.paymentLink.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete payment link error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public: resolve slug → redirect to checkout
router.get('/resolve/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const link = await db.paymentLink.findUnique({ where: { slug } });

    if (!link || !link.isActive) {
      return res.status(404).json({ error: 'Payment link not found or inactive' });
    }

    // Increment view count
    await db.paymentLink.update({
      where: { id: link.id },
      data: { viewCount: { increment: 1 } },
    });

    const BASE_URL = (process.env.BASE_URL || 'https://wetakestables.shop').trim();
    const params = new URLSearchParams({
      merchantId: link.merchantId,
      amount: Number(link.amount).toString(),
      token: link.token,
    });
    if (link.productName) params.set('productName', link.productName);
    if (link.chains.length > 0) params.set('chains', link.chains.join(','));
    if (link.externalId) params.set('externalId', link.externalId);
    params.set('linkId', link.id); // Track which link generated the order

    res.json({
      redirect: `${BASE_URL}/crypto-pay.html?${params.toString()}`,
      link: {
        id: link.id,
        amount: Number(link.amount),
        token: link.token,
        productName: link.productName,
        merchantId: link.merchantId,
      },
    });
  } catch (error) {
    console.error('Resolve payment link error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const paymentLinksRouter = router;
