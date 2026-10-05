import crypto from "node:crypto";
import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { jobAttempts, outbox } from "../../db/schema";
import type { DbContext } from "../../db/tx";

export type OutboxItem = typeof outbox.$inferSelect;

export type JobHandler = (item: OutboxItem, db: DbContext) => Promise<void>;

export type WorkerOptions = {
  handlers: Record<string, JobHandler>;
  batchSize?: number;
  /** Lease duration; an unfinished job becomes claimable again after it expires. */
  leaseMs?: number;
  /** Backoff base and cap. Final timings pending A-11/OQ-06. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  now?: () => Date;
  random?: () => number;
};

const DEFAULTS = { batchSize: 10, leaseMs: 60_000, backoffBaseMs: 5_000, backoffMaxMs: 15 * 60_000 };

/** Exponential backoff with full jitter in [base*2^(n-1)/2, base*2^(n-1)], capped. */
export function computeBackoffMs(attempt: number, baseMs: number, maxMs: number, random = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + (exp / 2) * random());
}

/**
 * Atomically claims due items: pending & due, or processing with an expired lease
 * (worker crash). Increments attempts and sets a new lease.
 */
export async function claimBatch(
  db: DbContext,
  opts: { batchSize?: number; leaseMs?: number; now?: Date } = {}
): Promise<OutboxItem[]> {
  const now = opts.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + (opts.leaseMs ?? DEFAULTS.leaseMs));
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(
          lt(outbox.attempts, outbox.maxAttempts),
          or(
            and(eq(outbox.status, "pending"), lte(outbox.nextAttemptAt, now)),
            and(eq(outbox.status, "processing"), lt(outbox.lockedUntil, now))
          )
        )
      )
      .orderBy(asc(outbox.nextAttemptAt))
      .limit(opts.batchSize ?? DEFAULTS.batchSize)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    return tx
      .update(outbox)
      .set({ status: "processing", lockedUntil: leaseUntil, attempts: sql`${outbox.attempts} + 1`, updatedAt: now })
      .where(inArray(outbox.id, due.map((d) => d.id)))
      .returning();
  });
}

/** Expired leases that have no attempts left are terminal: mark failed. */
async function failExhaustedLeases(db: DbContext, now: Date): Promise<void> {
  await db
    .update(outbox)
    .set({ status: "failed", lockedUntil: null, lastError: sql`coalesce(${outbox.lastError}, 'lease expired')`, updatedAt: now })
    .where(and(eq(outbox.status, "processing"), lt(outbox.lockedUntil, now), sql`${outbox.attempts} >= ${outbox.maxAttempts}`));
}

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 500);
}

/**
 * Runs one worker cycle. At-least-once: handlers must be idempotent
 * (e.g. the email handler checks notification_deliveries first).
 * Returns the number of items processed.
 */
export async function runOnce(db: DbContext, options: WorkerOptions): Promise<number> {
  const clock = options.now ?? (() => new Date());
  const cfg = { ...DEFAULTS, ...options };
  await failExhaustedLeases(db, clock());
  const items = await claimBatch(db, { batchSize: cfg.batchSize, leaseMs: cfg.leaseMs, now: clock() });

  for (const item of items) {
    const startedAt = clock();
    // Fencing: only the holder of this attempt may finalise the row.
    const owned = and(eq(outbox.id, item.id), eq(outbox.attempts, item.attempts), eq(outbox.status, "processing"));
    const handler = options.handlers[item.topic];
    try {
      if (!handler) throw new Error(`no handler for topic ${item.topic}`);
      await handler(item, db);
      await db.transaction(async (tx) => {
        await tx.insert(jobAttempts).values({ id: crypto.randomUUID(), outboxId: item.id, attemptNo: item.attempts, outcome: "success", startedAt });
        await tx.update(outbox).set({ status: "done", lockedUntil: null, lastError: null, updatedAt: clock() }).where(owned);
      });
    } catch (err) {
      const exhausted = item.attempts >= item.maxAttempts;
      const message = errorMessage(err);
      const nextAttemptAt = new Date(clock().getTime() + computeBackoffMs(item.attempts, cfg.backoffBaseMs, cfg.backoffMaxMs, options.random));
      await db.transaction(async (tx) => {
        await tx.insert(jobAttempts).values({ id: crypto.randomUUID(), outboxId: item.id, attemptNo: item.attempts, outcome: exhausted ? "failed" : "retry", error: message, startedAt });
        await tx
          .update(outbox)
          .set(exhausted
            ? { status: "failed", lockedUntil: null, lastError: message, updatedAt: clock() }
            : { status: "pending", lockedUntil: null, lastError: message, nextAttemptAt, updatedAt: clock() })
          .where(owned);
      });
    }
  }
  return items.length;
}

