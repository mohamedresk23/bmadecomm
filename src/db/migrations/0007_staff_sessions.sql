CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"context" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_context" CHECK ("sessions"."context" in ('staff', 'customer'))
);
--> statement-breakpoint
CREATE TABLE "staff_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" text NOT NULL,
	"role_key" text NOT NULL,
	CONSTRAINT "user_roles_user_id_role_key_pk" PRIMARY KEY("user_id","role_key")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_accounts" ADD CONSTRAINT "staff_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_staff_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff_accounts"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_key");
