DROP TRIGGER IF EXISTS staff_role_increase_revoke ON user_roles;
--> statement-breakpoint
DROP TRIGGER IF EXISTS staff_user_identity_revoke ON users;
--> statement-breakpoint
DROP TRIGGER IF EXISTS staff_account_identity_revoke ON staff_accounts;
--> statement-breakpoint
DROP FUNCTION IF EXISTS staff_identity_revoke();
--> statement-breakpoint
DROP TRIGGER IF EXISTS staff_role_assignment_lock ON user_roles;
--> statement-breakpoint
DROP FUNCTION IF EXISTS staff_role_assignment_lock();
