import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../../../db";
import { users, proofTokens, outbox, registrationRateBuckets, jobAttempts, notificationDeliveries } from "../../../db/schema";
import { setupTestDb, withIsolatedTx } from "../../../test-utils/db";
import { composeRegistration } from "../infrastructure/registration";
import { hashPassword, verifyPassword } from "../infrastructure/password";
import { consumeProof, issueVerificationProof } from "../infrastructure/proofs";
import { decryptToken, encryptToken } from "../infrastructure/token-encryption";
import { registrationSource, throttleRegistration } from "../infrastructure/rate-limit";
import { createVerificationEmailHandler } from "../infrastructure/verification-email";
import { composeIdentityWorker } from "../infrastructure/worker";
import { identityConfig } from "../infrastructure/config";
import { SandboxEmailAdapter } from "../../../shared/email/adapter";
import { runOnce } from "../../../shared/outbox/worker";
import { registerRequestSchema } from "../contracts/registration";
import { createRegisterCustomer } from "./register";

const key = randomBytes(32);
const dto = (email = `${randomUUID()}@example.test`) => ({ name: "Customer", email, phone: "+201234567890", password: "a complete passphrase" });
beforeAll(setupTestDb);

describe("registration policy and KDF", () => {
  it("strictly normalizes writable fields and counts Unicode code points", () => {
    expect(registerRequestSchema.parse({ ...dto(" Person@Example.test "), password: "😀".repeat(128) }).email).toBe("person@example.test");
    for (const password of ["😀".repeat(14), "a".repeat(129), "😀".repeat(129)]) expect(registerRequestSchema.safeParse({ ...dto(), password }).success).toBe(false);
    for (const malformed of ["a".repeat(15) + "\ud800", "a".repeat(15) + "\ud801", "a".repeat(15) + "\udc00"]) expect(registerRequestSchema.safeParse({ ...dto(), password: malformed }).success).toBe(false);
    for (const field of ["role", "verifiedAt", "id"]) expect(registerRequestSchema.safeParse({ ...dto(), [field]: "admin" }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...dto(), name: " " }).success).toBe(false);
  });
  it("hashes full long ASCII, multibyte and astral passphrases with fresh approved parameters", async () => {
    for (const password of ["a".repeat(128), "界".repeat(100), "😀".repeat(128), " ".repeat(15)]) {
      const hash = await hashPassword(password);
      expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
      const parts = hash.split("$");
      expect(Buffer.from(parts[4], "base64")).toHaveLength(16);
      expect(Buffer.from(parts[5], "base64")).toHaveLength(32);
      expect(await verifyPassword(password, hash)).toBe(true);
      expect(await verifyPassword(password.slice(0, -1) + "x", hash)).toBe(false);
    }
    expect(await hashPassword("same complete password")).not.toBe(await hashPassword("same complete password"));
  });
  it("hashes before persistence on every call", async () => {
    const order: string[] = [];
    const register = createRegisterCustomer({ hashPassword: async () => { order.push("hash"); return "hash"; }, createCustomer: async () => { order.push("write"); } });
    await register(dto()); await register(dto());
    expect(order).toEqual(["hash", "write", "hash", "write"]);
  });
});

describe("atomic registration and proof/email integration", () => {
  it("creates one customer, scoped exact-24-hour proof and encrypted event across duplicate/racing requests", async () => {
    const input = dto();
    const register = composeRegistration(db, key);
    const results = await Promise.all([register(input), register(input), register(input)]);
    expect(results).toEqual([{ success: true }, { success: true }, { success: true }]);
    const [user] = await db.select().from(users).where(eq(users.email, input.email));
    expect(user.role).toBe("customer"); expect(user.verifiedAt).toBeNull();
    expect(await verifyPassword(input.password, user.passwordHash)).toBe(true);
    const proofs = await db.select().from(proofTokens).where(eq(proofTokens.userId, user.id));
    expect(proofs).toHaveLength(1);
    expect(proofs[0].expiresAt.getTime() - proofs[0].createdAt.getTime()).toBe(86400000);
    const events = await db.select().from(outbox).where(eq(outbox.dedupeKey, `register-verification-${user.id}`));
    expect(events).toHaveLength(1);
    const payload = events[0].payload as { encryptedToken: string; proofId: string };
    const token = decryptToken(payload.encryptedToken, key, user.id, payload.proofId);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(events)).not.toContain(token);
    expect(JSON.stringify(events)).not.toContain(input.password);
    expect(proofs[0].tokenHash).not.toBe(token);
    const adapter = new SandboxEmailAdapter();
    const handler = createVerificationEmailHandler(adapter, { key, origin: "http://localhost:3000" });
    await runOnce(db, { handlers: { CustomerRegistered: handler } });
    const sent = adapter.sent.find(message => message.to === input.email)!;
    expect(new URL(sent.data.verificationUrl as string).searchParams.get("token")).toBe(token);
    await handler(events[0], db);
    expect(adapter.sent.filter(message => message.to === input.email)).toHaveLength(1);
    for (const wrong of [{ token, userId: randomUUID(), purpose: "verification" }, { token, userId: user.id, purpose: "password_reset" }, { token: "forged", userId: user.id, purpose: "verification" }]) expect(await consumeProof(db, wrong)).toBe(false);
    const consumed = await Promise.all([consumeProof(db, { token, userId: user.id, purpose: "verification" }), consumeProof(db, { token, userId: user.id, purpose: "verification" })]);
    expect(consumed.filter(Boolean)).toHaveLength(1);
    expect(await consumeProof(db, { token, userId: user.id, purpose: "verification" })).toBe(false);
    expect((await db.select().from(users).where(eq(users.id, user.id)))[0].verifiedAt).toBeNull();
  });
  it("rejects expired proofs and authenticates encrypted proof/user scope", async () => withIsolatedTx(async tx => {
    const input = dto(); await composeRegistration(tx, key)(input);
    const [user] = await tx.select().from(users).where(eq(users.email, input.email));
    const issued = await issueVerificationProof(tx, user.id, new Date(0));
    expect(await consumeProof(tx, { token: issued.token, userId: user.id, purpose: "verification" })).toBe(false);
    const encrypted = encryptToken(issued.token, key, user.id, issued.proofId);
    expect(() => decryptToken(encrypted, key, user.id, randomUUID())).toThrow();
    expect(() => decryptToken(encrypted, randomBytes(32), user.id, issued.proofId)).toThrow();
  }));
  it("rolls back the customer and proof if outbox insertion fails", async () => withIsolatedTx(async tx => {
    const proofsBefore = (await tx.select().from(proofTokens)).length;
    const outboxBefore = (await tx.select().from(outbox)).length;
    await tx.execute(sql`CREATE FUNCTION pg_temp.reject_identity_outbox() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$ LANGUAGE plpgsql`);
    await tx.execute(sql`CREATE TRIGGER test_reject_identity_outbox BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_identity_outbox()`);
    const input = dto(); await expect(composeRegistration(tx, key)(input)).rejects.toThrow();
    expect(await tx.select().from(users).where(eq(users.email, input.email))).toHaveLength(0);
    expect(await tx.select().from(proofTokens)).toHaveLength(proofsBefore);
    expect(await tx.select().from(outbox)).toHaveLength(outboxBefore);
    await tx.execute(sql`DROP TRIGGER test_reject_identity_outbox ON outbox`);
  }));
  it("rolls back when proof issuance fails", async () => withIsolatedTx(async tx => {
    const proofsBefore = (await tx.select().from(proofTokens)).length;
    const outboxBefore = (await tx.select().from(outbox)).length;
    await tx.execute(sql`CREATE FUNCTION pg_temp.reject_identity_proof() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$ LANGUAGE plpgsql`);
    await tx.execute(sql`CREATE TRIGGER test_reject_identity_proof BEFORE INSERT ON proof_tokens FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_identity_proof()`);
    const input = dto(); await expect(composeRegistration(tx, key)(input)).rejects.toThrow();
    expect(await tx.select().from(users).where(eq(users.email, input.email))).toHaveLength(0);
    expect(await tx.select().from(proofTokens)).toHaveLength(proofsBefore);
    expect(await tx.select().from(outbox)).toHaveLength(outboxBefore);
    await tx.execute(sql`DROP TRIGGER test_reject_identity_proof ON proof_tokens`);
  }));
  it("sanitizes provider exceptions on retry then sends once", async () => withIsolatedTx(async tx => {
    const input = dto(); await composeRegistration(tx, key)(input);
    const sandbox = new SandboxEmailAdapter();
    const send = vi.fn().mockRejectedValueOnce(new Error("raw-secret-token@example.test")).mockImplementation(message => sandbox.send(message));
    const handler = createVerificationEmailHandler({ send }, { key, origin: "http://localhost:3000" });
    await runOnce(tx, { handlers: { CustomerRegistered: handler }, backoffBaseMs: 0, backoffMaxMs: 0 });
    const [attempt] = await tx.select().from(jobAttempts).where(eq(jobAttempts.outcome, "retry"));
    expect(attempt.error).toBe("Verification email delivery failed");
    await runOnce(tx, { handlers: { CustomerRegistered: handler } });
    expect(sandbox.sent).toHaveLength(1);
  }));
  it("processes registered topics without touching pending or exhausted unrelated messages", async () => withIsolatedTx(async tx => {
    const [pending, exhausted] = await tx.insert(outbox).values([
      { id: randomUUID(), topic: "unrelated.pending", payload: {}, dedupeKey: randomUUID(), nextAttemptAt: new Date(0) },
      { id: randomUUID(), topic: "unrelated.exhausted", payload: {}, dedupeKey: randomUUID(), status: "processing", attempts: 5, lockedUntil: new Date(0) },
    ]).returning();
    expect(await runOnce(tx, { handlers: {} })).toBe(0);
    const input = dto(); await composeRegistration(tx, key)(input);
    const worker = composeIdentityWorker(tx, { NODE_ENV: "test", EMAIL_ADAPTER: "sandbox", IDENTITY_TOKEN_KEY: key.toString("base64"), APP_URL: "http://localhost:3000" });
    expect(await worker.runOnce()).toBe(1);
    expect(worker.adapter.sent).toHaveLength(1);
    expect((await tx.select().from(outbox).where(eq(outbox.id, pending.id)))[0]).toEqual(pending);
    expect((await tx.select().from(outbox).where(eq(outbox.id, exhausted.id)))[0]).toEqual(exhausted);
    expect(await tx.select().from(jobAttempts).where(eq(jobAttempts.outboxId, pending.id))).toHaveLength(0);
    expect(await tx.select().from(jobAttempts).where(eq(jobAttempts.outboxId, exhausted.id))).toHaveLength(0);
  }));
  it("completes expired-at-boundary and consumed proofs without delivery, while missing context remains an error", async () => withIsolatedTx(async tx => {
    const now = new Date();
    vi.spyOn(Date, "now").mockReturnValue(now.getTime());
    try {
      const adapter = new SandboxEmailAdapter();
      for (const consumed of [false, true]) {
        const input = dto(); await composeRegistration(tx, key)(input);
        const [user] = await tx.select().from(users).where(eq(users.email, input.email));
        await tx.update(proofTokens).set(consumed ? { consumedAt: now } : { expiresAt: now }).where(eq(proofTokens.userId, user.id));
        expect(await runOnce(tx, { handlers: { CustomerRegistered: createVerificationEmailHandler(adapter, { key, origin: "http://localhost:3000" }) } })).toBe(1);
        const [event] = await tx.select().from(outbox).where(eq(outbox.dedupeKey, `register-verification-${user.id}`));
        expect(event.status).toBe("done");
        expect(await tx.select().from(notificationDeliveries).where(eq(notificationDeliveries.outboxId, event.id))).toHaveLength(0);
      }
      expect(adapter.sent).toHaveLength(0);
      const [missing] = await tx.insert(outbox).values({ id: randomUUID(), topic: "CustomerRegistered", dedupeKey: randomUUID(), payload: { userId: randomUUID(), proofId: randomUUID(), encryptedToken: "unused" } }).returning();
      await expect(createVerificationEmailHandler(adapter, { key, origin: "http://localhost:3000" })(missing, tx)).rejects.toThrow("Verification email delivery failed");
    } finally { vi.restoreAllMocks(); }
  }));
});

describe("bounded shared throttle", () => {
  it("counts source attempts even when email rejects and resets independent windows", async () => withIsolatedTx(async tx => {
    const source = randomUUID(), email = dto().email, now = new Date("2026-10-06T10:00:00Z");
    for (let i = 0; i < 3; i++) expect(await throttleRegistration(tx, source, email, now)).toBe(0);
    expect(await throttleRegistration(tx, source, email, now)).toBe(3600);
    for (let i = 0; i < 6; i++) expect(await throttleRegistration(tx, source, dto().email, now)).toBe(0);
    expect(await throttleRegistration(tx, source, dto().email, now)).toBe(900);
    expect(await throttleRegistration(tx, source, dto().email, new Date(now.getTime() + 900000))).toBe(0);
    expect(await throttleRegistration(tx, source, email, new Date(now.getTime() + 3600000))).toBe(0);
    const stored = await tx.select().from(registrationRateBuckets);
    expect(stored.every(row => /^[a-f0-9]{64}$/.test(row.key) && row.attempts <= 10)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(email);
  }));
  it("bounds concurrent accepted attempts", async () => {
    const source = randomUUID(), now = new Date("2026-10-06T10:00:00Z");
    const outcomes = await Promise.all(Array.from({ length: 15 }, () => throttleRegistration(db, source, dto().email, now)));
    expect(outcomes.filter(retry => retry === 0)).toHaveLength(10);
    const email = dto().email;
    const emailOutcomes = await Promise.all(Array.from({ length: 6 }, () => throttleRegistration(db, randomUUID(), email, now)));
    expect(emailOutcomes.filter(retry => retry === 0)).toHaveLength(3);
  });
  it("ignores forwarded headers unless a trusted single-IP header is configured", () => {
    const req = new Request("http://localhost", { headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "1.2.3.4" } });
    expect(registrationSource(req)).toBe("shared-source");
    expect(registrationSource(req, "x-real-ip")).toBe("1.2.3.4");
    expect(registrationSource(new Request("http://localhost", { headers: { "x-real-ip": "1.2.3.4, 5.6.7.8" } }), "x-real-ip")).toBe("shared-source");
    expect(registrationSource(req, "missing")).toBe("shared-source");
    expect(registrationSource(new Request("http://localhost", { headers: { "x-real-ip": "fe80::1%eth0" } }), "x-real-ip")).toBe("shared-source");
  });
  it("canonicalizes equivalent IPv6 spellings into one source bucket", async () => withIsolatedTx(async tx => {
    const variants = ["2001:db8::1", "2001:0DB8:0000:0000:0000:0000:0000:0001"];
    const sources = variants.map(ip => registrationSource(new Request("http://localhost", { headers: { "x-real-ip": ip } }), "x-real-ip"));
    expect(sources[0]).toBe(sources[1]);
    const before = await tx.select().from(registrationRateBuckets);
    for (let index = 0; index < 10; index++) expect(await throttleRegistration(tx, sources[index % 2], dto().email)).toBe(0);
    expect(await throttleRegistration(tx, sources[0], dto().email)).toBeGreaterThan(0);
    const newBuckets = (await tx.select().from(registrationRateBuckets)).filter(row => !before.some(previous => previous.key === row.key));
    expect(newBuckets.filter(row => row.attempts === 10)).toHaveLength(1);
  }));
  it("production/config errors fail closed for registration and worker composition", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", EMAIL_ADAPTER: "sandbox", IDENTITY_TOKEN_KEY: key.toString("base64"), APP_URL: "http://localhost:3000" };
    expect(identityConfig(env).origin).toBe("http://localhost:3000");
    expect(() => composeIdentityWorker(db, { ...env, NODE_ENV: "production" })).toThrow();
    expect(() => identityConfig({ ...env, IDENTITY_TOKEN_KEY: "bad" })).toThrow();
  });
});
