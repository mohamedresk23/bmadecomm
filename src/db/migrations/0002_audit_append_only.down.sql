DROP TRIGGER IF EXISTS audit_events_no_update_delete ON "audit_events";
--> statement-breakpoint
DROP FUNCTION IF EXISTS audit_events_block_mutation();

