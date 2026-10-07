-- Identity persistence guards. Each table's actual schema is used, including isolated tests.
-- A BEFORE role-assignment trigger takes user/account locks before FK key-share locks.
-- Revocation happens AFTER a real inserted/changed row, so ON CONFLICT DO NOTHING is harmless.
CREATE FUNCTION staff_role_assignment_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SELECT id FROM %I.users WHERE id = $1 FOR UPDATE', TG_TABLE_SCHEMA)
    USING NEW.user_id;
  EXECUTE format('SELECT user_id FROM %I.staff_accounts WHERE user_id = $1 FOR UPDATE', TG_TABLE_SCHEMA)
    USING NEW.user_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER staff_role_assignment_lock
BEFORE INSERT OR UPDATE ON user_roles
FOR EACH ROW EXECUTE FUNCTION staff_role_assignment_lock();
--> statement-breakpoint
CREATE FUNCTION staff_identity_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  affected_user text;
  changed boolean := false;
  revoked_at timestamp with time zone;
BEGIN
  IF TG_TABLE_NAME = 'staff_accounts' THEN
    affected_user := NEW.user_id;
    changed := (OLD.enabled AND NOT NEW.enabled)
      OR OLD.mfa_seed IS DISTINCT FROM NEW.mfa_seed
      OR OLD.mfa_enrolled_at IS DISTINCT FROM NEW.mfa_enrolled_at;
    -- The executor already holds the account row lock. Do not take a user lock
    -- here: session/auth callers take user then account, and an inverse lock would deadlock.
  ELSIF TG_TABLE_NAME = 'users' THEN
    affected_user := NEW.id;
    changed := OLD.role = 'staff' AND (OLD.password_hash IS DISTINCT FROM NEW.password_hash
      OR OLD.role IS DISTINCT FROM NEW.role);
    IF changed THEN
      EXECUTE format('SELECT user_id FROM %I.staff_accounts WHERE user_id = $1 FOR UPDATE', TG_TABLE_SCHEMA)
        USING affected_user;
    END IF;
  ELSIF TG_TABLE_NAME = 'user_roles' THEN
    affected_user := NEW.user_id;
    IF TG_OP = 'INSERT' THEN
      changed := true;
    ELSE
      changed := OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.role_key IS DISTINCT FROM NEW.role_key;
    END IF;
    -- The BEFORE trigger already took user then account locks.
  END IF;
  IF changed THEN
    -- Time is resolved after identity lock waits. No revoked token/proof can be revived by reenable.
    revoked_at := clock_timestamp();
    EXECUTE format('UPDATE %I.sessions SET revoked_at = $1 WHERE user_id = $2 AND context = ''staff'' AND revoked_at IS NULL', TG_TABLE_SCHEMA)
      USING revoked_at, affected_user;
    EXECUTE format('UPDATE %I.staff_auth_proofs SET consumed_at = $1 WHERE user_id = $2 AND consumed_at IS NULL', TG_TABLE_SCHEMA)
      USING revoked_at, affected_user;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER staff_account_identity_revoke
AFTER UPDATE OF enabled, mfa_seed, mfa_enrolled_at ON staff_accounts
FOR EACH ROW EXECUTE FUNCTION staff_identity_revoke();
--> statement-breakpoint
CREATE TRIGGER staff_user_identity_revoke
AFTER UPDATE OF password_hash, role ON users
FOR EACH ROW EXECUTE FUNCTION staff_identity_revoke();
--> statement-breakpoint
CREATE TRIGGER staff_role_increase_revoke
AFTER INSERT OR UPDATE ON user_roles
FOR EACH ROW EXECUTE FUNCTION staff_identity_revoke();
