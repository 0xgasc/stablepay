import { Request } from 'express';
import { db } from '../config/database';
import { logger } from './logger';

export interface AuditEntry {
  action: string;
  resource: 'order' | 'merchant' | 'refund' | 'payout' | 'wallet' | 'fee_payment' | 'system';
  resourceId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string;
}

export async function logAdminAction(req: Request | null, actor: string, entry: AuditEntry): Promise<void> {
  try {
    await db.adminAction.create({
      data: {
        actor,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        before: (entry.before ?? undefined) as any,
        after: (entry.after ?? undefined) as any,
        reason: entry.reason,
        ip: req?.ip || (req?.socket as any)?.remoteAddress || null,
        userAgent: req?.get?.('user-agent') || null,
      },
    });
  } catch (err) {
    logger.error('Failed to write admin action audit', err as Error, {
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId,
    });
  }
}
