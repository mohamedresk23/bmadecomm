import { pgTable, text, timestamp, jsonb, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

// F00-04: append-only audit trail. UPDATE/DELETE are blocked by a DB trigger
// (see migration 0002_audit_append_only).
export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  diff: jsonb("diff"),
  requestId: text("request_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// This table is purely for verifying the migration runner and test harness
// in foundation story F00-02. It will be dropped/ignored in business logic.
export const migrationsTest = pgTable("_migrations_test", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// F00-05 (AD-13): durable outbox written inside the source transaction.
// Processed at-least-once by the worker using a DB lease; dedupe_key makes
// enqueueing idempotent.
export const outbox = pgTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    status: text("status").notNull().default("pending"), // pending | processing | done | failed
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("outbox_status_next_attempt_idx").on(t.status, t.nextAttemptAt)]
);

// One row per worker attempt on an outbox item.
export const jobAttempts = pgTable(
  "job_attempts",
  {
    id: text("id").primaryKey(),
    outboxId: text("outbox_id").notNull().references(() => outbox.id),
    attemptNo: integer("attempt_no").notNull(),
    outcome: text("outcome").notNull(), // success | retry | failed
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("job_attempts_outbox_attempt_uq").on(t.outboxId, t.attemptNo)]
);

// Durable record of a delivered notification. Unique per outbox item so a
// retried job never sends twice once delivery is recorded.
export const notificationDeliveries = pgTable("notification_deliveries", {
  id: text("id").primaryKey(),
  outboxId: text("outbox_id").notNull().unique().references(() => outbox.id),
  channel: text("channel").notNull(), // email
  recipientRef: text("recipient_ref").notNull(),
  template: text("template").notNull(),
  status: text("status").notNull(), // sent
  providerMessageId: text("provider_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});


// F00-07: Media storage foundation
export const media = pgTable("media", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  status: text("status").notNull(), // 'pending' | 'active'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
