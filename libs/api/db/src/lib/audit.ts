import { sql } from 'drizzle-orm';
import { auditEvents } from '../schema';
import type { DbTransaction } from './db.service';

export interface AuditEvent {
  spaceId: string;
  actorId: string | null;
  /** Dotted verb, e.g. `space.created`, `member.role_changed`. */
  action: string;
  targetType?: string;
  targetId?: string;
  diff?: Record<string, unknown>;
}

/**
 * Records an audit event inside a {@link DbService.userDb} transaction, so the change and its
 * audit row commit or roll back together. `authenticated` cannot insert audit events (0004), so
 * the insert runs as `service_role` and the transaction then switches back to `authenticated`.
 */
export async function recordAudit(tx: DbTransaction, event: AuditEvent): Promise<void> {
  await tx.execute(sql`set local role service_role`);
  try {
    await tx.insert(auditEvents).values({
      spaceId: event.spaceId,
      actorId: event.actorId,
      action: event.action,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      diff: event.diff ?? null,
    });
  } finally {
    await tx.execute(sql`set local role authenticated`);
  }
}
