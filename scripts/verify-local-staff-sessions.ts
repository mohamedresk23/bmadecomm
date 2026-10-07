import dotenv from "dotenv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from 'node:fs/promises';
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { localDatabaseUrl } from "./local-database-config";
import type { DbContext } from "../src/db/tx";
import * as schema from "../src/db/schema";
import { issueStaffSession, resolveStaffSession, rotateStaffSession, revokeStaffSession } from "../src/modules/identity/infrastructure/staff-sessions";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

async function main() {
  const connection = localDatabaseUrl();
  const runId = randomUUID().replaceAll("-", "");
  const isolated = `staff_session_verify_${runId}`;
  const root = postgres(connection, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const clients: ReturnType<typeof postgres>[] = [];
  let created = false;
  try {
    await root`SELECT 1`;
    await root.unsafe(`CREATE SCHEMA "${isolated}"`); created = true;
    // Identifiers here are fixed names or a generated UUID, never user input.
    for (const table of ["users", "roles", "staff_accounts", "user_roles", "sessions", "staff_auth_proofs"]) {
      await root.unsafe(`CREATE TABLE "${isolated}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    await root.unsafe(`ALTER TABLE "${isolated}"."staff_accounts" ADD FOREIGN KEY (user_id) REFERENCES "${isolated}"."users"(id)`);
    await root.unsafe(`ALTER TABLE "${isolated}"."sessions" ADD FOREIGN KEY (user_id) REFERENCES "${isolated}"."users"(id)`);
    await root.unsafe(`ALTER TABLE "${isolated}"."user_roles" ADD FOREIGN KEY (user_id) REFERENCES "${isolated}"."staff_accounts"(user_id), ADD FOREIGN KEY (role_key) REFERENCES "${isolated}"."roles"(key)`);
    const open = () => {
      const client = postgres(connection, { max: 1, connect_timeout: 5, connection: { search_path: isolated }, onnotice: () => {} });
      clients.push(client); return client;
    };
    const first = open(), second = open();
    const guards = await readFile('src/db/migrations/0009_staff_identity_revocation.sql', 'utf8');
    for (const statement of guards.split('--> statement-breakpoint')) if (statement.trim()) await first.unsafe(statement);
    const one = drizzle(first, { schema }) as DbContext, two = drizzle(second, { schema }) as DbContext;
    const userId = randomUUID(), roleKey = randomUUID();
    const policy = { idleMs: 60000, absoluteMs: 120000 }; // Explicit synthetic test policy, not runtime defaults.
    await one.insert(schema.users).values({ id: userId, name: "Synthetic staff session check", email: `${runId}@example.test`, phone: "123", passwordHash: "not-used-by-session-lifecycle-test", role: "staff" });
    await one.insert(schema.staffAccounts).values({ userId, mfaSeed: 'fixture-encrypted-seed', mfaEnrolledAt: new Date() });
    await one.insert(schema.roles).values({ key: roleKey });
    await one.insert(schema.userRoles).values({ userId, roleKey });
    const issued = await issueStaffSession(one, userId, policy); assert.ok(issued);
    assert.equal((await resolveStaffSession(two, issued.token, policy))?.userId, userId);
    assert.equal(await resolveStaffSession(two, "invalid", policy), null);
    console.log("PASS: actual issued opaque session resolved on an independent PostgreSQL connection; invalid token denied");
    await one.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    assert.equal(await resolveStaffSession(two, issued.token, policy), null);
    await one.insert(schema.userRoles).values({ userId, roleKey });
    await one.update(schema.staffAccounts).set({ enabled: false }).where(eq(schema.staffAccounts.userId, userId));
    assert.equal(await resolveStaffSession(two, issued.token, policy), null);
    await one.update(schema.staffAccounts).set({ enabled: true }).where(eq(schema.staffAccounts.userId, userId));
    assert.equal(await resolveStaffSession(two, issued.token, policy), null);
    console.log("PASS: committed role restoration/account reenable never resurrected the old session on a second connection");
    const fresh = await issueStaffSession(one, userId, policy); assert.ok(fresh);
    const rotated = await rotateStaffSession(one, fresh.token, policy); assert.ok(rotated);
    assert.equal(rotated.expiresAt.getTime(), fresh.expiresAt.getTime());
    assert.equal(await resolveStaffSession(two, fresh.token, policy), null);
    assert.ok(await resolveStaffSession(two, rotated.token, policy));
    await revokeStaffSession(one, rotated.token);
    assert.equal(await resolveStaffSession(two, rotated.token, policy), null);
    console.log("PASS: rotation invalidated the old token, preserved absolute expiry and committed revocation denied access");

    const increased = await issueStaffSession(one, userId, policy); assert.ok(increased);
    const proofId = randomUUID(), grant = randomUUID();
    await one.insert(schema.staffAuthProofs).values({ id: proofId, userId, tokenHash: 'd'.repeat(64), csrfHash: 'e'.repeat(64), purpose: 'login', expiresAt: new Date(Date.now() + 60_000) });
    await one.insert(schema.roles).values({ key: grant });
    await one.insert(schema.userRoles).values({ userId, roleKey: grant });
    assert.equal(await resolveStaffSession(two, increased.token, policy), null);
    assert.ok((await two.select().from(schema.staffAuthProofs).where(eq(schema.staffAuthProofs.id, proofId)))[0].consumedAt);
    const afterGrant = await issueStaffSession(one, userId, policy); assert.ok(afterGrant);
    await one.delete(schema.userRoles).where(eq(schema.userRoles.roleKey, grant));
    assert.deepEqual((await resolveStaffSession(two, afterGrant.token, policy))?.roles, [roleKey]);
    console.log('PASS: direct role increase revoked session/proof; subsequent reduction retained an independent current grant');

    async function concurrentIdentityChange(kind: 'disable' | 'grant' | 'password') {
      const current = await issueStaffSession(one, userId, policy); assert.ok(current);
      const pendingId = randomUUID();
      await one.insert(schema.staffAuthProofs).values({ id: pendingId, userId, tokenHash: pendingId.replaceAll('-', '') + randomUUID().replaceAll('-', ''), csrfHash: 'e'.repeat(64), purpose: 'login', expiresAt: new Date(Date.now() + 60_000) });
      let locked!: () => void, release!: () => void;
      const hasLock = new Promise<void>(resolve => { locked = resolve; }), unlock = new Promise<void>(resolve => { release = resolve; });
      const holding = first.begin(async tx => {
        // Direct account writes naturally start at the account row; trigger never inverts the user/account order.
        if (kind !== 'disable') await tx`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
        await tx`SELECT user_id FROM staff_accounts WHERE user_id=${userId} FOR UPDATE`;
        locked(); await unlock;
        if (kind === 'disable') {
          await tx`UPDATE staff_accounts SET enabled=false WHERE user_id=${userId}`;
          await tx`UPDATE staff_accounts SET enabled=true WHERE user_id=${userId}`;
        } else if (kind === 'password') await tx`UPDATE users SET password_hash=${randomUUID()} WHERE id=${userId}`;
        else await tx`INSERT INTO user_roles(user_id,role_key) VALUES(${userId},${grant})`;
      });
      await hasLock;
      const waiting = rotateStaffSession(two, current.token, policy);
      const sentinel = Symbol('still waiting');
      try { assert.equal(await Promise.race([waiting, new Promise<symbol>(resolve => setTimeout(() => resolve(sentinel), 100))]), sentinel); }
      finally { release(); await holding; }
      assert.equal(await waiting, null);
      assert.equal(await resolveStaffSession(two, current.token, policy), null);
      assert.ok((await two.select().from(schema.staffAuthProofs).where(eq(schema.staffAuthProofs.id, pendingId)))[0].consumedAt);
    }
    await concurrentIdentityChange('disable'); await concurrentIdentityChange('grant'); await concurrentIdentityChange('password');
    console.log('PASS: independent-connection disable/reenable, role increase and password change blocked racing rotation without resurrection');

    const rollbackSession = await issueStaffSession(one, userId, policy); assert.ok(rollbackSession);
    const syntheticRollback = new Error('synthetic identity rollback');
    try { await first.begin(async tx => { await tx`UPDATE staff_accounts SET enabled=false WHERE user_id=${userId}`; throw syntheticRollback; }); }
    catch (error) { assert.equal(error, syntheticRollback); }
    assert.ok(await resolveStaffSession(two, rollbackSession.token, policy));
    console.log('PASS: aborted direct identity mutation rolled back its triggered session invalidation atomically');

    const expires = await issueStaffSession(one, userId, policy); assert.ok(expires);
    await first`UPDATE sessions SET expires_at=clock_timestamp()+interval '500 milliseconds', idle_expires_at=clock_timestamp()+interval '500 milliseconds' WHERE id=${expires.sessionId}`;
    let locked!: () => void, release!: () => void;
    const hasLock = new Promise<void>(resolve => { locked = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const holding = first.begin(async tx => {
      await tx`SELECT id FROM sessions WHERE id=${expires.sessionId} FOR UPDATE`;
      locked(); await unlock;
    });
    await hasLock;
    const waiting = resolveStaffSession(two, expires.token, policy);
    try {
      const sentinel = Symbol("still waiting");
      assert.equal(await Promise.race([waiting, new Promise<symbol>(resolve => setTimeout(() => resolve(sentinel), 100))]), sentinel);
      await new Promise(resolve => setTimeout(resolve, 600));
    } finally { release(); await holding; }
    assert.equal(await waiting, null);
    console.log("PASS: a session expiring during a real PostgreSQL lock wait was not resurrected");
    const [stored] = await one.select().from(schema.sessions).where(eq(schema.sessions.id, expires.sessionId));
    assert.ok(stored.tokenHash !== expires.token && /^[a-f0-9]{64}$/.test(stored.tokenHash));
    console.log("PASS: persisted token values are hashes; no credentials/grants or public business data were seeded");
  } finally {
    for (const client of clients) await client.end();
    if (created) {
      assert.equal(isolated, `staff_session_verify_${runId}`);
      assert.match(isolated, /^staff_session_verify_[a-f0-9]{32}$/);
      await root.unsafe(`DROP SCHEMA "${isolated}" CASCADE`);
    }
    await root.end();
  }
}

main().then(() => process.exit(0)).catch(() => {
  console.error("Staff session lifecycle verification failed; inspect private local configuration/DB availability. This check does not verify login/MFA/UI.");
  process.exit(1);
});
