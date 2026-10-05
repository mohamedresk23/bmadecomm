import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

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
