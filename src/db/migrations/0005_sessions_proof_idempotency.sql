CREATE TABLE "operation_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_keys_hash_check" CHECK ("operation_keys"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "operation_keys_completion_check" CHECK ("operation_keys"."completed_at" IS NOT NULL OR "operation_keys"."result" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "proof_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"subject" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proof_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "proof_tokens_purpose_check" CHECK ("proof_tokens"."purpose" IN ('password_reset', 'email_verification')),
	CONSTRAINT "proof_tokens_hash_check" CHECK ("proof_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "proof_tokens_expiry_check" CHECK ("proof_tokens"."expires_at" > "proof_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"scope" text NOT NULL,
	"subject" text NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_scope_check" CHECK ("sessions"."scope" IN ('admin', 'customer')),
	CONSTRAINT "sessions_hash_check" CHECK ("sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sessions_expiry_check" CHECK ("sessions"."created_at" < "sessions"."idle_expires_at" AND "sessions"."idle_expires_at" <= "sessions"."absolute_expires_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operation_keys_scope_uq" ON "operation_keys" USING btree ("actor","operation","key");--> statement-breakpoint
CREATE INDEX "proof_tokens_subject_purpose_idx" ON "proof_tokens" USING btree ("subject","purpose");--> statement-breakpoint
CREATE INDEX "sessions_subject_idx" ON "sessions" USING btree ("subject");