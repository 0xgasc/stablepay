import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';
import { logger } from '../utils/logger';

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h window

function hashKey(merchantId: string | null, path: string, headerKey: string, body: unknown): string {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  const input = [merchantId || 'anon', path, headerKey, bodyStr].join('|');
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Idempotency middleware. Activated when the client sends `Idempotency-Key` header.
 * Stores the first response and returns it verbatim for subsequent requests using the same key.
 *
 * Notes:
 * - Does NOT activate without the header — fully opt-in.
 * - Keys are scoped to (merchantId, path, header, body-hash) so the same header for a different body
 *   is a cache miss (prevents accidental cross-operation collision).
 */
export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const headerKey = (req.headers['idempotency-key'] || req.headers['x-idempotency-key']) as string | undefined;
    if (!headerKey) return next();

    const merchantId = (req as any).merchant?.id || null;
    const keyHash = hashKey(merchantId, req.path, headerKey, req.body);

    try {
      const cached = await db.idempotencyKey.findUnique({ where: { keyHash } });
      if (cached) {
        const age = Date.now() - cached.createdAt.getTime();
        if (age < MAX_AGE_MS) {
          res.setHeader('Idempotent-Replayed', 'true');
          return res.status(cached.statusCode).json(cached.response);
        }
      }
    } catch (err) {
      // DB hiccup — fall through (fail-open so we don't block legitimate requests)
      logger.error('Idempotency lookup failed', err as Error);
    }

    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      const statusCode = res.statusCode;
      // Only cache success + known-safe client errors. Server errors aren't cached so the client can retry.
      if (statusCode < 500) {
        db.idempotencyKey.create({
          data: { merchantId, keyHash, statusCode, response: body },
        }).catch((err: Error) => {
          // Unique-conflict = concurrent first request; safe to ignore.
          if (!/unique/i.test(err.message || '')) {
            logger.error('Idempotency cache write failed', err);
          }
        });
      }
      return originalJson(body);
    };

    next();
  };
}

// Periodic cleanup — call from a scheduler or on startup
export async function cleanupExpiredIdempotencyKeys(): Promise<number> {
  const cutoff = new Date(Date.now() - MAX_AGE_MS);
  const result = await db.idempotencyKey.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}
