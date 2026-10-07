CREATE TABLE "registration_rate_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "registration_rate_attempts_positive" CHECK ("registration_rate_buckets"."attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower(btrim("users"."email")));