import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { beforeAll, afterAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { postgresTestUrl } from "../../db";
import * as schema from "../../db/schema";
import { runMigrations } from "../../db/migrate";
import { executeIdempotent } from "./execute";
import { issueProof, consumeProof } from "../identity/proof-tokens";
import { createSession, resolveSession, rotateSession } from "../identity/sessions";

// Separate one-connection pools guarantee independent committed transactions.
const firstClient = postgres(postgresTestUrl(), { max: 1 });
const secondClient = postgres(postgresTestUrl(), { max: 1 });
const first = drizzle(firstClient, { schema });
const second = drizzle(secondClient, { schema });
beforeAll(async () => { await runMigrations(); await runMigrations(); });
afterAll(async () => { await Promise.all([firstClient.end(), secondClient.end()]); });
it("concurrent commands on independent connections commit one effect and replay one result", async () => {
  const id = randomUUID();
  const input = { actor: id, operation: "race", key: id, payload: { value: 1 } };
  let calls = 0;
  const callback = async (tx: Parameters<Parameters<typeof executeIdempotent>[2]>[0]) => {
    calls++;
    await tx.insert(schema.migrationsTest).values({ id });
    // DB-local delay forces the competing INSERT to wait on the uncommitted unique key.
    await tx.execute("select pg_sleep(0.15)");
    return { id };
  };
  try {
    const results = await Promise.all([executeIdempotent(first, input, callback), executeIdempotent(second, input, callback)]);
    expect(results).toEqual([{ id }, { id }]); expect(calls).toBe(1);
    expect(await first.select().from(schema.migrationsTest).where(eq(schema.migrationsTest.id, id))).toHaveLength(1);
    await expect(executeIdempotent(second, { ...input, payload: { value: 2 } }, callback)).rejects.toMatchObject({ statusCode: 409 });
  } finally {
    await first.delete(schema.operationKeys).where(eq(schema.operationKeys.actor, id));
    await first.delete(schema.migrationsTest).where(eq(schema.migrationsTest.id, id));
  }
});

for (const action of ["resolve", "rotate", "proof"] as const) {
  it(`rejects ${action} after waiting on an unchanged row lock past expiry`, async () => {
    const subject = randomUUID();
    const bearer = action === "proof" ? await issueProof(first, "password_reset", subject)
      : await createSession(first, "admin", subject);
    const table = action === "proof" ? schema.proofTokens : schema.sessions;
    if (action === "proof") await first.update(schema.proofTokens).set({ expiresAt: sql`clock_timestamp() + interval '1 second'` })
      .where(eq(schema.proofTokens.id, bearer.id));
    else await first.update(schema.sessions).set({ idleExpiresAt: sql`clock_timestamp() + interval '1 second'` })
      .where(eq(schema.sessions.id, bearer.id));
    let locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const blocker = first.transaction(async tx => {
      await tx.select().from(table).where(eq(table.id, bearer.id)).for("update");
      locked();
      await tx.execute(sql`select pg_sleep(1.5)`);
    });
    try {
      await ready;
      const result = action === "proof" ? await second.transaction(tx => consumeProof(tx, "password_reset", subject, bearer.token))
        : action === "resolve" ? await resolveSession(second, "admin", bearer.token)
          : await rotateSession(second, "admin", bearer.token);
      await blocker;
      expect(result).toBe(action === "proof" ? false : null);
    } finally {
      await blocker;
      await first.delete(table).where(eq(table.id, bearer.id));
    }
  });
}

it("simultaneous rotation has one winner and preserves the absolute deadline with idle cap", async () => {
  const subject = randomUUID();
  const session = await createSession(first, "admin", subject);
  await first.update(schema.sessions).set({ absoluteExpiresAt: sql`clock_timestamp() + interval '10 minutes'`,
    idleExpiresAt: sql`clock_timestamp() + interval '5 minutes'` }).where(eq(schema.sessions.id, session.id));
  const [original] = await first.select().from(schema.sessions).where(eq(schema.sessions.id, session.id));
  try {
    const results = await Promise.all([rotateSession(first, "admin", session.token), rotateSession(second, "admin", session.token)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results.find(Boolean)!;
    expect(winner.absoluteExpiresAt).toEqual(original.absoluteExpiresAt);
    expect(winner.idleExpiresAt).toEqual(original.absoluteExpiresAt);
    expect(await resolveSession(second, "admin", session.token)).toBeNull();
    expect(await resolveSession(second, "admin", winner.token)).not.toBeNull();
  } finally { await first.delete(schema.sessions).where(eq(schema.sessions.id, session.id)); }
});
it("independent proof consumers have exactly one winner", async () => {
  const subject = randomUUID();
  const proof = await issueProof(first, "password_reset", subject);
  try {
    const results = await Promise.all([
      first.transaction(tx => consumeProof(tx, "password_reset", subject, proof.token)),
      second.transaction(tx => consumeProof(tx, "password_reset", subject, proof.token)),
    ]);
    expect(results.sort()).toEqual([false, true]);
  } finally { await first.delete(schema.proofTokens).where(eq(schema.proofTokens.subject, subject)); }
});

it("upgrades populated pre-0005 foundation and preserves append-only audit constraints", async () => {
  const namespace = `upgrade_${randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("rollback isolated upgrade schema");
  try {
    await firstClient.begin(async tx => {
      await tx.unsafe(`CREATE SCHEMA "${namespace}"`);
      await tx.unsafe(`SET LOCAL search_path TO "${namespace}"`);
      const migrations = ["0000_busy_loki", "0001_tidy_black_tarantula", "0002_audit_append_only",
        "0003_outbox_jobs_notifications", "0004_media_storage", "0005_sessions_proof_idempotency"];
      async function apply(name: string) {
        const original = readFileSync(path.join(process.cwd(), "src/db/migrations", `${name}.sql`), "utf8");
        // Rebind only explicit public FK qualifiers to the temporary test schema.
        // Applied migration files remain untouched; all DDL/data rolls back below.
        const isolated = original.replaceAll('"public".', `"${namespace}".`);
        for (const statement of isolated.split("--> statement-breakpoint"))
          if (statement.trim()) await tx.unsafe(statement);
      }
      for (const migration of migrations.slice(0, 5)) await apply(migration);
      await tx.unsafe(`INSERT INTO _migrations_test(id) VALUES ('existing');
        INSERT INTO audit_events(id,actor,action,resource,diff) VALUES ('audit','actor','existing','resource','{"old":true}');
        INSERT INTO outbox(id,topic,payload,dedupe_key) VALUES ('outbox','existing','{"old":true}','existing');
        INSERT INTO job_attempts(id,outbox_id,attempt_no,outcome,started_at) VALUES ('attempt','outbox',1,'success',now());
        INSERT INTO notification_deliveries(id,outbox_id,channel,recipient_ref,template,status) VALUES ('delivery','outbox','email','subject','existing','sent');
        INSERT INTO media(id,filename,mime_type,size,status) VALUES ('media','existing','image/png',1,'active');`);
      const tables = ["_migrations_test", "audit_events", "outbox", "job_attempts", "notification_deliveries", "media"];
      const before = await Promise.all(tables.map(table => tx.unsafe(`SELECT * FROM "${table}"`)));
      await apply(migrations[5]);
      for (const [i, table] of tables.entries()) expect(await tx.unsafe(`SELECT * FROM "${table}"`)).toEqual(before[i]);
      for (const statement of ["UPDATE audit_events SET actor='changed'", "DELETE FROM audit_events"])
        await expect(tx.savepoint(nested => nested.unsafe(statement))).rejects.toMatchObject({ message: "audit_events is append-only" });
      expect(await tx.unsafe("SELECT * FROM audit_events")).toEqual(before[1]);
      for (const table of ["sessions", "proof_tokens", "operation_keys"])
        expect(await tx.unsafe(`SELECT * FROM "${table}"`)).toHaveLength(0);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
});
