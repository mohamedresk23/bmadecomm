import crypto from "node:crypto";
import { outbox } from "../../db/schema";
import type { DbContext } from "../../db/tx";

export type EnqueueInput = {
  topic: string;
  payload: Record<string, unknown>;
  /** Stable business key; a second enqueue with the same key is a no-op. */
  dedupeKey: string;
  maxAttempts?: number;
};

/**
 * Writes an outbox row inside the caller's transaction (AD-13).
 * If the surrounding transaction rolls back, nothing is emitted.
 * Returns true when a new row was inserted, false when deduplicated.
 */
export async function enqueue(tx: DbContext, input: EnqueueInput): Promise<boolean> {
  const rows = await tx
    .insert(outbox)
    .values({
      id: crypto.randomUUID(),
      topic: input.topic,
      payload: input.payload,
      dedupeKey: input.dedupeKey,
      maxAttempts: input.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: outbox.dedupeKey })
    .returning();
  return rows.length > 0;
}

