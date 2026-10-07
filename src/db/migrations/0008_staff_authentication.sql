CREATE TABLE "staff_auth_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_auth_proofs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"csrf_hash" text NOT NULL,
	"seed" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "staff_auth_proofs_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "staff_bootstrap" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE TABLE "staff_recovery_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "staff_recovery_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "authenticated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_accounts" ADD COLUMN "mfa_seed" text;--> statement-breakpoint
ALTER TABLE "staff_accounts" ADD COLUMN "mfa_enrolled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_accounts" ADD COLUMN "last_totp_step" integer;--> statement-breakpoint
ALTER TABLE "staff_auth_proofs" ADD CONSTRAINT "staff_auth_proofs_user_id_staff_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_bootstrap" ADD CONSTRAINT "staff_bootstrap_user_id_staff_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_recovery_codes" ADD CONSTRAINT "staff_recovery_codes_user_id_staff_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff_accounts"("user_id") ON DELETE no action ON UPDATE no action;