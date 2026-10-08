DROP TABLE IF EXISTS "staff_recovery_codes";
--> statement-breakpoint
DROP TABLE IF EXISTS "staff_bootstrap";
--> statement-breakpoint
DROP TABLE IF EXISTS "staff_auth_proofs";
--> statement-breakpoint
DROP TABLE IF EXISTS "staff_auth_buckets";
--> statement-breakpoint
ALTER TABLE "staff_accounts" DROP COLUMN IF EXISTS "last_totp_step";
--> statement-breakpoint
ALTER TABLE "staff_accounts" DROP COLUMN IF EXISTS "mfa_enrolled_at";
--> statement-breakpoint
ALTER TABLE "staff_accounts" DROP COLUMN IF EXISTS "mfa_seed";
--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "authenticated_at";
