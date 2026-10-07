import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { users, staffAuthProofs } from '../../../db/schema';
import type { JobHandler } from '../../../shared/outbox/worker';
import type { EmailAdapter } from '../../../shared/email/adapter';
import { createEmailSendHandler } from '../../../shared/email/send-handler';
import { decryptStaffSecret, secretHash } from './staff-crypto';
import type { StaffConfig } from './staff-config';
const securityPayload = z.object({ userId: z.uuid(), action: z.string().regex(/^staff\.[a-z.-]+$/) }).strict();
const resetPayload = z.object({ userId: z.uuid(), encryptedProof: z.string() }).strict();
export function staffNotificationHandlers(adapter: EmailAdapter, config: StaffConfig): Record<string, JobHandler> {
  const send = createEmailSendHandler(adapter);
  return {
    StaffSecurityChanged: async (item, db) => {
      try {
        const payload = securityPayload.parse(item.payload);
        const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, payload.userId));
        if (!user) throw new Error();
        await send({ ...item, payload: { to: user.email, recipientRef: `staff:${payload.userId}`, template: 'staff-security-change', data: { event: payload.action } } }, db);
      } catch { throw new Error('Staff security notification failed'); }
    },
    StaffPasswordResetRequested: async (item, db) => {
      try {
        if (!config.sandbox) throw new Error();
        const payload = resetPayload.parse(item.payload);
        const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, payload.userId));
        if (!user) throw new Error();
        const proof = z.object({ token: z.string(), csrf: z.string() }).strict().parse(JSON.parse(decryptStaffSecret(payload.encryptedProof, config.key, payload.userId, 'reset-mail')));
        const [liveProof] = await db.select({ consumedAt: staffAuthProofs.consumedAt, expiresAt: staffAuthProofs.expiresAt }).from(staffAuthProofs).where(and(eq(staffAuthProofs.tokenHash, secretHash(proof.token)), eq(staffAuthProofs.userId, payload.userId), eq(staffAuthProofs.purpose, 'reset')));
        if (!liveProof || liveProof.consumedAt || liveProof.expiresAt.getTime() <= Date.now()) return;
        const url = new URL('/admin/reset', config.origin); url.hash = new URLSearchParams(proof).toString();
        await send({ ...item, payload: { to: user.email, recipientRef: `staff:${payload.userId}`, template: 'staff-password-reset', data: { resetUrl: url.toString() } } }, db);
      } catch { throw new Error('Staff reset notification failed'); }
    },
  };
}
