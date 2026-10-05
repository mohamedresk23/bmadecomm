import { DbContext } from '../../db/tx';
import { auditEvents } from '../../db/schema';
import crypto from 'node:crypto';

export type AuditEventPayload = {
  actor: string;
  action: string;
  resource: string;
  diff?: Record<string, unknown>;
  requestId?: string;
};

/**
 * Writes an audit event atomically within the provided transaction context.
 */
export async function writeAudit(tx: DbContext, payload: AuditEventPayload): Promise<void> {
  await tx.insert(auditEvents).values({
    id: crypto.randomUUID(),
    actor: payload.actor,
    action: payload.action,
    resource: payload.resource,
    diff: payload.diff || null,
    requestId: payload.requestId || null,
  });
}

