import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../config/database';
import { requireMerchantAuth } from '../middleware/auth';
import { logger } from '../utils/logger';
import { logAdminAction } from '../utils/audit';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// Shared validation
// ──────────────────────────────────────────────────────────────────────────────

const SUPPORTED_CHAINS = [
  'BASE_MAINNET', 'ETHEREUM_MAINNET', 'POLYGON_MAINNET', 'ARBITRUM_MAINNET',
  'BNB_MAINNET', 'SOLANA_MAINNET', 'TRON_MAINNET',
  'BASE_SEPOLIA', 'ETHEREUM_SEPOLIA', 'ARBITRUM_SEPOLIA', 'POLYGON_MUMBAI', 'SOLANA_DEVNET',
] as const;

const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const storeCreateSchema = z.object({
  slug: z.string().min(2).max(40).regex(slugRegex, 'slug must be kebab-case (a-z, 0-9, -)'),
  name: z.string().min(1).max(100),
  displayName: z.string().max(100).optional(),
  logoUrl: z.string().url().optional(),
  headerColor: z.string().optional(),
  headerTextColor: z.string().optional(),
  website: z.string().url().optional(),
  backButtonText: z.string().max(40).optional(),
  widgetConfig: z.record(z.string(), z.any()).optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
  webhookUrl: z.string().url().refine(u => u.startsWith('https://'), { message: 'webhookUrl must be HTTPS' }).optional(),
  webhookEnabled: z.boolean().optional(),
  webhookEvents: z.array(z.string()).optional(),
});

const storeUpdateSchema = storeCreateSchema.partial();

const walletSchema = z.object({
  chain: z.enum(SUPPORTED_CHAINS),
  address: z.string().min(10).max(64),
  supportedTokens: z.array(z.enum(['USDC', 'USDT', 'EURC'])).optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const walletUpdateSchema = walletSchema.partial().omit({ chain: true });

// Return shape helpers — we NEVER expose webhookSecret except on create/rotate.
function publicStore(store: any) {
  const { webhookSecret, ...rest } = store;
  return rest;
}

// ──────────────────────────────────────────────────────────────────────────────
// Store CRUD
// ──────────────────────────────────────────────────────────────────────────────

router.post('/', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const data = storeCreateSchema.parse(req.body);

    const secret = crypto.randomBytes(32).toString('hex');
    const store = await db.store.create({
      data: {
        merchantId: merchant.id,
        slug: data.slug,
        name: data.name,
        displayName: data.displayName,
        logoUrl: data.logoUrl,
        headerColor: data.headerColor,
        headerTextColor: data.headerTextColor,
        website: data.website,
        backButtonText: data.backButtonText,
        widgetConfig: data.widgetConfig as any,
        successUrl: data.successUrl,
        cancelUrl: data.cancelUrl,
        webhookUrl: data.webhookUrl,
        webhookEnabled: data.webhookEnabled ?? false,
        webhookEvents: data.webhookEvents ?? [],
        webhookSecret: secret,
      },
    });

    await logAdminAction(req, merchant.email || `merchant:${merchant.id}`, {
      action: 'store.create',
      resource: 'merchant',
      resourceId: store.id,
      after: { slug: store.slug, name: store.name, webhookUrl: store.webhookUrl },
    });

    logger.info('Store created', { merchantId: merchant.id, storeId: store.id, slug: store.slug, event: 'store.created' });

    // Secret returned ONCE. After this the only way to get a secret is POST /rotate-secret.
    res.status(201).json({
      ...store,
      webhookSecret: secret,
      secretGenerated: true,
      _secretWarning: 'Store this secret now — it will never be shown again.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    if ((error as any)?.code === 'P2002') {
      return res.status(409).json({ error: 'A store with this slug already exists for your account' });
    }
    logger.error('Create store error', error as Error);
    res.status(500).json({ error: 'Failed to create store' });
  }
});

router.get('/', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const includeArchived = req.query.includeArchived === '1' || req.query.includeArchived === 'true';
    const stores = await db.store.findMany({
      where: { merchantId: merchant.id, ...(includeArchived ? {} : { isArchived: false }) },
      orderBy: [{ isArchived: 'asc' }, { createdAt: 'desc' }],
      include: {
        _count: { select: { orders: true, paymentLinks: true, wallets: true } },
      },
    });
    res.json({ stores: stores.map(publicStore) });
  } catch (error) {
    logger.error('List stores error', error as Error);
    res.status(500).json({ error: 'Failed to list stores' });
  }
});

router.get('/:id', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const store = await db.store.findUnique({
      where: { id: req.params.id },
      include: { wallets: true },
    });
    if (!store || store.merchantId !== merchant.id) {
      return res.status(404).json({ error: 'Store not found' });
    }
    res.json(publicStore(store));
  } catch (error) {
    logger.error('Get store error', error as Error);
    res.status(500).json({ error: 'Failed to fetch store' });
  }
});

router.patch('/:id', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const data = storeUpdateSchema.parse(req.body);

    const existing = await db.store.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.merchantId !== merchant.id) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const updated = await db.store.update({
      where: { id: req.params.id },
      data: {
        ...(data.slug !== undefined && { slug: data.slug }),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.displayName !== undefined && { displayName: data.displayName }),
        ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
        ...(data.headerColor !== undefined && { headerColor: data.headerColor }),
        ...(data.headerTextColor !== undefined && { headerTextColor: data.headerTextColor }),
        ...(data.website !== undefined && { website: data.website }),
        ...(data.backButtonText !== undefined && { backButtonText: data.backButtonText }),
        ...(data.widgetConfig !== undefined && { widgetConfig: data.widgetConfig as any }),
        ...(data.successUrl !== undefined && { successUrl: data.successUrl }),
        ...(data.cancelUrl !== undefined && { cancelUrl: data.cancelUrl }),
        ...(data.webhookUrl !== undefined && { webhookUrl: data.webhookUrl }),
        ...(data.webhookEnabled !== undefined && { webhookEnabled: data.webhookEnabled }),
        ...(data.webhookEvents !== undefined && { webhookEvents: data.webhookEvents }),
      },
    });

    await logAdminAction(req, merchant.email || `merchant:${merchant.id}`, {
      action: 'store.update',
      resource: 'merchant',
      resourceId: req.params.id,
      before: { webhookUrl: existing.webhookUrl, webhookEnabled: existing.webhookEnabled, slug: existing.slug },
      after: { webhookUrl: updated.webhookUrl, webhookEnabled: updated.webhookEnabled, slug: updated.slug },
    });

    res.json(publicStore(updated));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    if ((error as any)?.code === 'P2002') {
      return res.status(409).json({ error: 'Slug already in use for another store on your account' });
    }
    logger.error('Update store error', error as Error);
    res.status(500).json({ error: 'Failed to update store' });
  }
});

router.delete('/:id', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const existing = await db.store.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.merchantId !== merchant.id) {
      return res.status(404).json({ error: 'Store not found' });
    }
    if (existing.isArchived) {
      return res.json({ success: true, message: 'Store was already archived' });
    }
    await db.store.update({
      where: { id: req.params.id },
      data: { isArchived: true, archivedAt: new Date() },
    });
    await logAdminAction(req, merchant.email || `merchant:${merchant.id}`, {
      action: 'store.archive',
      resource: 'merchant',
      resourceId: req.params.id,
    });
    res.json({ success: true, archived: true });
  } catch (error) {
    logger.error('Archive store error', error as Error);
    res.status(500).json({ error: 'Failed to archive store' });
  }
});

router.post('/:id/webhook/rotate-secret', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const existing = await db.store.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.merchantId !== merchant.id) {
      return res.status(404).json({ error: 'Store not found' });
    }
    const newSecret = crypto.randomBytes(32).toString('hex');
    await db.store.update({ where: { id: req.params.id }, data: { webhookSecret: newSecret } });
    await logAdminAction(req, merchant.email || `merchant:${merchant.id}`, {
      action: 'store.rotate_webhook_secret',
      resource: 'merchant',
      resourceId: req.params.id,
    });
    logger.security('Store webhook secret rotated', {
      merchantId: merchant.id,
      storeId: req.params.id,
      event: 'store.webhook_secret_rotated',
    });
    res.json({
      success: true,
      webhookSecret: newSecret,
      _secretWarning: 'Store this secret now — it will never be shown again.',
    });
  } catch (error) {
    logger.error('Rotate store secret error', error as Error);
    res.status(500).json({ error: 'Failed to rotate webhook secret' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Store wallet overrides — per-chain routing
// ──────────────────────────────────────────────────────────────────────────────

router.post('/:id/wallets', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const data = walletSchema.parse(req.body);

    const store = await db.store.findUnique({ where: { id: req.params.id } });
    if (!store || store.merchantId !== merchant.id) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const wallet = await db.storeWallet.upsert({
      where: { storeId_chain: { storeId: req.params.id, chain: data.chain } },
      create: {
        storeId: req.params.id,
        chain: data.chain,
        address: data.address,
        supportedTokens: data.supportedTokens ?? ['USDC'],
        priority: data.priority ?? 0,
        isActive: data.isActive ?? true,
      },
      update: {
        address: data.address,
        ...(data.supportedTokens !== undefined && { supportedTokens: data.supportedTokens }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
    res.status(201).json(wallet);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Create store wallet error', error as Error);
    res.status(500).json({ error: 'Failed to set store wallet override' });
  }
});

router.patch('/:id/wallets/:walletId', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const data = walletUpdateSchema.parse(req.body);

    const store = await db.store.findUnique({ where: { id: req.params.id } });
    if (!store || store.merchantId !== merchant.id) {
      return res.status(404).json({ error: 'Store not found' });
    }
    const wallet = await db.storeWallet.findUnique({ where: { id: req.params.walletId } });
    if (!wallet || wallet.storeId !== req.params.id) {
      return res.status(404).json({ error: 'Wallet override not found' });
    }
    const updated = await db.storeWallet.update({
      where: { id: req.params.walletId },
      data: {
        ...(data.address !== undefined && { address: data.address }),
        ...(data.supportedTokens !== undefined && { supportedTokens: data.supportedTokens }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Validation error', details: error.errors });
    logger.error('Update store wallet error', error as Error);
    res.status(500).json({ error: 'Failed to update store wallet override' });
  }
});

router.delete('/:id/wallets/:walletId', requireMerchantAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const store = await db.store.findUnique({ where: { id: req.params.id } });
    if (!store || store.merchantId !== merchant.id) {
      return res.status(404).json({ error: 'Store not found' });
    }
    const wallet = await db.storeWallet.findUnique({ where: { id: req.params.walletId } });
    if (!wallet || wallet.storeId !== req.params.id) {
      return res.status(404).json({ error: 'Wallet override not found' });
    }
    await db.storeWallet.delete({ where: { id: req.params.walletId } });
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete store wallet error', error as Error);
    res.status(500).json({ error: 'Failed to remove store wallet override' });
  }
});

export default router;
