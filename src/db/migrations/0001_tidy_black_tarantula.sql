CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"diff" jsonb,
	"request_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
