import { pgTable, text, timestamp, jsonb, integer, boolean, primaryKey, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

// E01-01: Customer registration
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(), // Normalized email
  phone: text("phone").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("customer"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [check("users_email_normalized", sql`${t.email} = lower(btrim(${t.email}))`)]);

export const proofTokens = pgTable("proof_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id").notNull().references(() => users.id),
  purpose: text("purpose").notNull(), // e.g. 'verification', 'password_reset'
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const registrationRateBuckets = pgTable("registration_rate_buckets", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull(),
}, t => [check("registration_rate_attempts_positive", sql`${t.attempts} > 0`)]);

// Staff identities are deliberately provisioned separately from customers.
export const roles = pgTable("roles", {
  key: text("key").primaryKey(),
});

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
});

export const staffAccounts = pgTable("staff_accounts", {
  userId: text("user_id").primaryKey().references(() => users.id),
  enabled: boolean("enabled").notNull().default(true),
  mfaSeed: text("mfa_seed"),
  mfaEnrolledAt: timestamp("mfa_enrolled_at", { withTimezone: true }),
  lastTotpStep: integer("last_totp_step"),
});

export const userRoles = pgTable("user_roles", {
  userId: text("user_id").notNull().references(() => staffAccounts.userId),
  roleKey: text("role_key").notNull().references(() => roles.key),
}, t => [primaryKey({ columns: [t.userId, t.roleKey] }), index("user_roles_role_idx").on(t.roleKey)]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  context: text("context").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  authenticatedAt: timestamp("authenticated_at", { withTimezone: true }),
}, t => [index("sessions_user_idx").on(t.userId), check("sessions_context", sql`${t.context} in ('staff', 'customer')`)]);

export const staffAuthProofs = pgTable("staff_auth_proofs", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => staffAccounts.userId),
  tokenHash: text("token_hash").notNull().unique(), purpose: text("purpose").notNull(),
  csrfHash: text("csrf_hash").notNull(), seed: text("seed"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }), failures: integer("failures").notNull().default(0),
});
export const staffRecoveryCodes = pgTable("staff_recovery_codes", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => staffAccounts.userId),
  codeHash: text("code_hash").notNull().unique(), consumedAt: timestamp("consumed_at", { withTimezone: true }),
});
export const staffAuthBuckets = pgTable("staff_auth_buckets", {
  key: text("key").primaryKey(), windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
});
export const staffBootstrap = pgTable("staff_bootstrap", {
  key: text("key").primaryKey(), userId: text("user_id").references(() => staffAccounts.userId),
});

// E03-01: Store operational settings
export const storeSettings = pgTable(
  "store_settings",
  {
    id: text("id").primaryKey(),
    storeName: text("store_name").notNull(),
    legalName: text("legal_name"),
    supportEmail: text("support_email").notNull(),
    supportPhone: text("support_phone").notNull(),
    address: text("address"),
    logoMediaId: text("logo_media_id").references(() => media.id, { onDelete: "set null" }),
    defaultLanguage: text("default_language").notNull().default("ar-EG"),
    currency: text("currency").notNull().default("EGP"),
    currencySymbol: text("currency_symbol").notNull().default("ج.م"),
    currencyExponent: integer("currency_exponent").notNull().default(2),
    timezone: text("timezone").notNull().default("Africa/Cairo"),
    dateFormat: text("date_format").notNull().default("YYYY-MM-DD"),
    orderPrefix: text("order_prefix").notNull().default("ORD-"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [check("store_settings_single_row", sql`${t.id} = 'default'`)]
);
