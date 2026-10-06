import dotenv from "dotenv";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { localDatabaseUrl } from "./local-database-config";
import { identityConfig } from "../src/modules/identity/infrastructure/config";
import { composeRegistration } from "../src/modules/identity/infrastructure/registration";
import { composeVerification } from "../src/modules/identity/infrastructure/verification";
import { composeIdentityWorker } from "../src/modules/identity/infrastructure/worker";
import { FileSandboxEmailAdapter } from "../src/shared/email/file-sandbox-adapter";
import { generateProofToken, issueVerificationProof } from "../src/modules/identity/infrastructure/proofs";
import { writeVerificationReport } from "./verification-report";
import { throttleRegistration, throttleVerification } from "../src/modules/identity/infrastructure/rate-limit";
import { users, proofTokens } from "../src/db/schema";
import * as schema from "../src/db/schema";
import type { DbContext } from "../src/db/tx";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });
let stage = "local configuration and PostgreSQL/server availability";
const evidence: string[] = [];
const runId = randomUUID().replaceAll("-", "");
const startedAt = new Date().toISOString();
function passed(label: string) { evidence.push(label); console.log(`PASS: ${label}`); }

async function main() {
  // Invalidate the previous result BEFORE any config, database or browser checks.
  await writeVerificationReport({ runId, startedAt, status: "running", checks: evidence });
  const connection = localDatabaseUrl();
  const config = identityConfig();
  const origin = new URL(config.origin);
  assert.equal(origin.hostname, "127.0.0.1", "Use a loopback-only application at 127.0.0.1 for live checks");
  assert.ok(config.trustedHeader, "Configure a loopback-only source header for isolated live checks");
  const client = postgres(connection, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const rootDb = drizzle(client, { schema });
  const generatedSchema = `e01_verify_${runId}`;
  const synthetic = (label: string) => ({ name: "Local synthetic customer", email: `e01-${runId}-${label}@example.test`, phone: "123456", password: "local synthetic passphrase" });
  let sourceIndex = 0;
  // Valid unique IPv6 source addresses avoid modifying any existing throttle bucket.
  function source() { return `fd00:${runId.slice(0, 4)}:${runId.slice(4, 8)}:${runId.slice(8, 12)}:${runId.slice(12, 16)}:${runId.slice(16, 20)}:${runId.slice(20, 24)}:${(++sourceIndex).toString(16)}`; }
  async function post(route: string, input: unknown, address = source()) {
    return fetch(`${config.origin}/api/v1/auth/${route}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: config.origin, [config.trustedHeader!]: address }, body: JSON.stringify(input), signal: AbortSignal.timeout(20000) });
  }
  const independent: ReturnType<typeof postgres>[] = [];
  let schemaCreated = false;
  try {
    await client`SELECT 1`;
    const page = await fetch(`${config.origin}/verify-email`, { signal: AbortSignal.timeout(20000) });
    assert.equal(page.status, 200);
    stage = "actual HTTP registration and normalized duplicate";
    const dto = synthetic("valid");
    const first = await post("register", dto); assert.equal(first.status, 200);
    const body = await first.json(); assert.equal(first.headers.get("cache-control"), "no-store");
    const duplicate = await post("register", { ...dto, email: ` ${dto.email.toUpperCase()} ` });
    assert.equal(duplicate.status, 200); assert.deepEqual(await duplicate.json(), body);
    const [user] = await rootDb.select().from(users).where(eq(users.email, dto.email));
    assert.ok(user); assert.equal(user.verifiedAt, null); assert.equal(user.role, "customer");
    const { verifyPassword } = await import("../src/modules/identity/infrastructure/password");
    assert.equal(await verifyPassword(dto.password, user.passwordHash), true);
    assert.equal((await client`SELECT id FROM users WHERE email = ${dto.email}`).length, 1);
    assert.equal((await client`SELECT id FROM proof_tokens WHERE user_id = ${user.id}`).length, 1);
    assert.equal((await client`SELECT id FROM outbox WHERE dedupe_key = ${`register-verification-${user.id}`}`).length, 1);
    passed(stage);

    stage = "private Sandbox email and GET without account mutation";
    const worker = composeIdentityWorker(rootDb as DbContext, process.env, new FileSandboxEmailAdapter());
    async function emailProof(userId: string) {
      const filename = createHash("sha256").update(`register-verification-${userId}`).digest("hex") + ".html";
      const mailPath = path.join(process.cwd(), ".local", "sandbox-mail", filename);
      let html: string | undefined;
      for (let cycle = 0; cycle < 100; cycle++) {
        await worker.runOnce();
        try { html = await readFile(mailPath, "utf8"); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      assert.ok(html, "Private email missing after worker cycles");
      const href = html.match(/href="([^"]+)"/)?.[1]; assert.ok(href);
      const link = new URL(href.replaceAll("&amp;", "&"));
      assert.equal(link.search, ""); assert.equal(link.origin, config.origin);
      const fragment = new URLSearchParams(link.hash.slice(1));
      assert.equal(fragment.get("user"), userId);
      const token = fragment.get("token"); assert.ok(token);
      return { userId, token };
    }
    const proof = await emailProof(user.id);
    assert.equal((await fetch(`${config.origin}/verify-email`, { signal: AbortSignal.timeout(20000) })).status, 200);
    assert.equal((await rootDb.select().from(users).where(eq(users.id, user.id)))[0].verifiedAt, null);
    passed(stage);

    stage = "actual HTTP activation, generic reuse/forgery/expiry rejection";
    assert.equal((await post("verify", proof)).status, 200);
    const [activated] = await rootDb.select().from(users).where(eq(users.id, user.id));
    const [consumed] = await rootDb.select().from(proofTokens).where(eq(proofTokens.userId, user.id));
    assert.ok(activated.verifiedAt); assert.equal(activated.verifiedAt.getTime(), consumed.consumedAt?.getTime());
    async function invalid(input: unknown) {
      const response = await post("verify", input); assert.equal(response.status, 400);
      const payload = await response.json(); assert.equal(payload.error.message, "Verification link is invalid or expired.");
      assert.equal(response.headers.get("cache-control"), "no-store");
      return payload.error.message;
    }
    const reused = await invalid(proof);
    assert.equal(await invalid({ ...proof, token: "a".repeat(43) }), reused);
    assert.equal(await invalid({ ...proof, userId: randomUUID() }), reused);
    const expiredDto = synthetic("expired"); assert.equal((await post("register", expiredDto)).status, 200);
    const [expiredUser] = await rootDb.select().from(users).where(eq(users.email, expiredDto.email));
    const expiredProof = await emailProof(expiredUser.id);
    // Exact synthetic user only: never change anyone else's proofs or buckets.
    assert.equal(expiredUser.email, expiredDto.email);
    await rootDb.update(proofTokens).set({ expiresAt: new Date(0) }).where(eq(proofTokens.userId, expiredUser.id));
    assert.equal(await invalid(expiredProof), reused);
    assert.equal((await rootDb.select().from(users).where(eq(users.id, expiredUser.id)))[0].verifiedAt, null);
    assert.equal((await rootDb.select().from(proofTokens).where(eq(proofTokens.userId, expiredUser.id)))[0].consumedAt, null);
    passed(stage);

    stage = "actual HTTP wrong-purpose proof rejection without mutation";
    const scopedDto = synthetic("wrong-purpose");
    assert.equal((await post("register", scopedDto)).status, 200);
    const [scopedUser] = await rootDb.select().from(users).where(eq(users.email, scopedDto.email));
    const scopedToken = generateProofToken();
    const [scopedProof] = await rootDb.insert(proofTokens).values({ id: randomUUID(), userId: scopedUser.id, tokenHash: scopedToken.tokenHash, purpose: "password_reset", expiresAt: new Date(Date.now() + 86400000) }).returning();
    const scopedResponse = await post("verify", { userId: scopedUser.id, token: scopedToken.token });
    assert.equal(scopedResponse.status, 400);
    assert.equal((await scopedResponse.json()).error.message, "Verification link is invalid or expired.");
    assert.deepEqual((await rootDb.select().from(users).where(eq(users.id, scopedUser.id)))[0], scopedUser);
    assert.deepEqual((await rootDb.select().from(proofTokens).where(eq(proofTokens.id, scopedProof.id)))[0], scopedProof);
    passed(stage);

    stage = "actual HTTP normalized-email, registration-source and verification-source throttles";
    assert.equal((await post("register", dto)).status, 200);
    const emailLimited = await post("register", dto); assert.equal(emailLimited.status, 429); assert.ok(Number(emailLimited.headers.get("retry-after")) > 0);
    const registrationSource = source();
    // Short passwords fail validation before throttle, so use valid synthetic customers.
    for (let index = 0; index < 10; index++) assert.equal((await post("register", synthetic(`source-${index}`), registrationSource)).status, 200);
    const blockedDto = synthetic("source-blocked"); const sourceLimited = await post("register", blockedDto, registrationSource);
    assert.equal(sourceLimited.status, 429); assert.ok(Number(sourceLimited.headers.get("retry-after")) > 0);
    assert.equal((await rootDb.select().from(users).where(eq(users.email, blockedDto.email))).length, 0);
    const verificationSource = source();
    for (let index = 0; index < 10; index++) assert.equal((await post("verify", { ...proof, token: "b".repeat(43) }, verificationSource)).status, 400);
    const verifyLimited = await post("verify", proof, verificationSource); assert.equal(verifyLimited.status, 429); assert.ok(Number(verifyLimited.headers.get("retry-after")) > 0);
    passed(stage);

    stage = "schema-isolated independent PostgreSQL connections";
    assert.match(generatedSchema, /^e01_verify_[a-f0-9]{32}$/);
    await client.unsafe(`CREATE SCHEMA "${generatedSchema}"`); schemaCreated = true;
    for (const table of ["users", "proof_tokens", "outbox", "registration_rate_buckets"]) {
      await client.unsafe(`CREATE TABLE "${generatedSchema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    await client.unsafe(`ALTER TABLE "${generatedSchema}".proof_tokens ADD FOREIGN KEY (user_id) REFERENCES "${generatedSchema}".users(id)`);
    const databases = Array.from({ length: 12 }, () => {
      const sqlClient = postgres(connection, { max: 1, connect_timeout: 5, connection: { search_path: generatedSchema }, onnotice: () => {} });
      independent.push(sqlClient); return drizzle(sqlClient, { schema });
    });
    const pids = await Promise.all(independent.map(sqlClient => sqlClient`SELECT pg_backend_pid() AS pid`));
    assert.equal(new Set(pids.map(rows => rows[0].pid)).size, 12);
    const raceDto = synthetic("race");
    await Promise.all(databases.slice(0, 3).map(database => composeRegistration(database as DbContext, config.key)(raceDto)));
    const [raceUser] = await databases[0].select().from(users).where(eq(users.email, raceDto.email));
    assert.equal((await independent[0]`SELECT id FROM users`).length, 1);
    assert.equal((await independent[0]`SELECT id FROM proof_tokens`).length, 1);
    assert.equal((await independent[0]`SELECT id FROM outbox`).length, 1);
    const issued = await issueVerificationProof(databases[0] as DbContext, raceUser.id);
    const winners = await Promise.all(databases.map(database => composeVerification(database as DbContext)({ userId: raceUser.id, token: issued.token })));
    assert.equal(winners.filter(Boolean).length, 1);
    const [winner] = await databases[0].select().from(users).where(eq(users.id, raceUser.id));
    const [winnerProof] = await databases[0].select().from(proofTokens).where(eq(proofTokens.id, issued.proofId));
    assert.ok(winner.verifiedAt); assert.equal(winner.verifiedAt.getTime(), winnerProof.consumedAt?.getTime());
    const now = new Date();
    const sourceRaces = await Promise.all(databases.map((database, index) => throttleRegistration(database as DbContext, "isolated-source", synthetic(`race-source-${index}`).email, now)));
    assert.equal(sourceRaces.filter(retry => !retry).length, 10);
    const emailRaces = await Promise.all(databases.map((database, index) => throttleRegistration(database as DbContext, `isolated-email-${index}`, synthetic("race-email").email, now)));
    assert.equal(emailRaces.filter(retry => !retry).length, 3);
    const verificationRaces = await Promise.all(databases.map(database => throttleVerification(database as DbContext, "isolated-verification", now)));
    assert.equal(verificationRaces.filter(retry => !retry).length, 10);
    passed("independent PostgreSQL registration, activation and throttle concurrency");

    stage = "PostgreSQL held account/proof locks reject expiry during waiting";
    for (const lockedTable of ["users", "proof_tokens"] as const) {
      const delayedDto = synthetic(`lock-delay-${lockedTable}`);
      await composeRegistration(databases[0] as DbContext, config.key)(delayedDto);
      const [delayedUser] = await databases[0].select().from(users).where(eq(users.email, delayedDto.email));
      const delayedProof = await issueVerificationProof(databases[0] as DbContext, delayedUser.id);
      const waiter = independent[1], observer = independent[2];
      const [{ pid }] = await waiter`SELECT pg_backend_pid() AS pid`;
      let release!: () => void, locked!: () => void;
      const held = new Promise<void>(resolve => { locked = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      const holding = independent[0].begin(async tx => {
        // Database-relative expiry, then hold either lock while verification waits.
        await tx`UPDATE proof_tokens SET expires_at = clock_timestamp() + interval '2 seconds' WHERE id = ${delayedProof.proofId}`;
        if (lockedTable === "users") await tx`SELECT id FROM users WHERE id = ${delayedUser.id} FOR UPDATE`;
        else await tx`SELECT id FROM proof_tokens WHERE id = ${delayedProof.proofId} FOR UPDATE`;
        locked(); await gate;
      });
      await held;
      const waiting = composeVerification(databases[1] as DbContext)({ userId: delayedUser.id, token: delayedProof.token })
        .then(result => ({ result, failed: false }), () => ({ result: false, failed: true }));
      try {
        let sawLock = false;
        for (let attempts = 0; attempts < 100; attempts++) {
          const [activity] = await observer`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
          if (activity?.wait_event_type === "Lock") { sawLock = true; break; }
          await observer`SELECT pg_sleep(0.02)`;
        }
        assert.equal(sawLock, true);
        await observer`SELECT pg_sleep(2.1)`;
      } finally { release(); await holding; }
      const delayedResult = await waiting;
      assert.equal(delayedResult.failed, false); assert.equal(delayedResult.result, false);
      assert.equal((await databases[0].select().from(users).where(eq(users.id, delayedUser.id)))[0].verifiedAt, null);
      assert.equal((await databases[0].select().from(proofTokens).where(eq(proofTokens.id, delayedProof.proofId)))[0].consumedAt, null);
    }
    passed(stage);

    stage = "schema-isolated registration and activation rollback";
    const isolated = independent[0];
    await isolated.unsafe(`CREATE FUNCTION "${generatedSchema}".reject_write() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$ LANGUAGE plpgsql`);
    for (const table of ["proof_tokens", "outbox"]) {
      await isolated.unsafe(`CREATE TRIGGER reject_write BEFORE INSERT ON "${generatedSchema}"."${table}" FOR EACH ROW EXECUTE FUNCTION "${generatedSchema}".reject_write()`);
      const beforeProofs = (await isolated`SELECT id FROM proof_tokens`).length;
      const beforeEvents = (await isolated`SELECT id FROM outbox`).length;
      const rejected = synthetic(`rollback-${table}`);
      await assert.rejects(composeRegistration(databases[0] as DbContext, config.key)(rejected));
      assert.equal((await isolated`SELECT id FROM users WHERE email = ${rejected.email}`).length, 0);
      assert.equal((await isolated`SELECT id FROM proof_tokens`).length, beforeProofs);
      assert.equal((await isolated`SELECT id FROM outbox`).length, beforeEvents);
      await isolated.unsafe(`DROP TRIGGER reject_write ON "${generatedSchema}"."${table}"`);
    }
    const rollbackDto = synthetic("activation-rollback"); await composeRegistration(databases[0] as DbContext, config.key)(rollbackDto);
    const [rollbackUser] = await databases[0].select().from(users).where(eq(users.email, rollbackDto.email));
    const rollbackProof = await issueVerificationProof(databases[0] as DbContext, rollbackUser.id);
    await isolated.unsafe(`CREATE TRIGGER reject_write BEFORE UPDATE ON "${generatedSchema}".users FOR EACH ROW EXECUTE FUNCTION "${generatedSchema}".reject_write()`);
    await assert.rejects(composeVerification(databases[0] as DbContext)({ userId: rollbackUser.id, token: rollbackProof.token }));
    assert.equal((await databases[0].select().from(users).where(eq(users.id, rollbackUser.id)))[0].verifiedAt, null);
    assert.equal((await databases[0].select().from(proofTokens).where(eq(proofTokens.id, rollbackProof.proofId)))[0].consumedAt, null);
    passed(stage);
    stage = "headless Edge launch";
    const { verifyLocalBrowser } = await import("./verify-local-browser");
    await verifyLocalBrowser({ db: rootDb as DbContext, origin: config.origin, trustedHeader: config.trustedHeader!, source: source(), synthetic, prepareMail: emailProof, stage: label => { stage = label; } });
    passed("headless Edge registration, private email-link confirmation and used/expired UI");
  } finally {
    await Promise.all(independent.map(sqlClient => sqlClient.end({ timeout: 5 })));
    if (schemaCreated) {
      // Cleanup is restricted to the exact generated schema, never public/user data.
      assert.equal(generatedSchema, `e01_verify_${runId}`); assert.match(generatedSchema, /^e01_verify_[a-f0-9]{32}$/);
      await client.unsafe(`DROP SCHEMA "${generatedSchema}" CASCADE`);
    }
    await client.end({ timeout: 5 });
  }
  await writeVerificationReport({ runId, startedAt, status: "passed", completedAt: new Date().toISOString(), checks: evidence });
  console.log(`Local PostgreSQL full-path verification passed (${evidence.length} groups); synthetic public records retained.`);
}
main().then(() => process.exit(0)).catch(async () => {
  await writeVerificationReport({ runId, startedAt, status: "failed", completedAt: new Date().toISOString(), failedStage: stage, checks: evidence }).catch(() => {
    console.error("Private verification report could not be written; current run failed.");
  });
  console.error(`Local PostgreSQL verification failed or blocked at: ${stage}. Check private config, migrations, loopback server and PostgreSQL. Secrets suppressed.`);
  process.exit(1);
});
