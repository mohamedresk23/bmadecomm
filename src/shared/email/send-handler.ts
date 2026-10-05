import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { notificationDeliveries } from "../../db/schema";
import type { JobHandler } from "../outbox/worker";
import type { EmailAdapter } from "./adapter";

export const EMAIL_SEND_TOPIC = "email.send";

export const emailSendPayload = z.object({
  to: z.email(),
  /** Non-PII reference stored in notification_deliveries (e.g. "user:123"). */
  recipientRef: z.string().min(1),
  template: z.string().min(1),
  data: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Idempotent handler: if a delivery is already recorded for this outbox item
 * (crash after send, before ack) it does nothing.
 */
export function createEmailSendHandler(adapter: EmailAdapter): JobHandler {
  return async (item, db) => {
    const existing = await db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.outboxId, item.id));
    if (existing.length > 0) return;

    const payload = emailSendPayload.parse(item.payload);
    const result = await adapter.send({
      to: payload.to,
      template: payload.template,
      data: payload.data,
      idempotencyKey: item.dedupeKey,
    });
    await db
      .insert(notificationDeliveries)
      .values({
        id: crypto.randomUUID(),
        outboxId: item.id,
        channel: "email",
        recipientRef: payload.recipientRef,
        template: payload.template,
        status: "sent",
        providerMessageId: result.providerMessageId,
      })
      .onConflictDoNothing({ target: notificationDeliveries.outboxId });
  };
}

