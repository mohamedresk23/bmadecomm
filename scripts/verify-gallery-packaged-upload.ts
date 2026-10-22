import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, copyFile, mkdtemp, rm, access } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:net";
import dotenv from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import sharp from "sharp";
import * as schema from "../src/db/schema";
import { localDatabaseUrl } from "./local-database-config";
import { issueStaffSession } from "../src/modules/identity/infrastructure/staff-sessions";
import { STAFF_SESSION_POLICY } from "../src/modules/identity/infrastructure/staff-config";
import { encryptStaffSecret, newStaffSeed, sessionCsrf } from "../src/modules/identity/infrastructure/staff-crypto";

dotenv.config({ path: ".env.local", quiet: true });
const checkout = process.cwd();
const isolated = `gallery_package_${randomBytes(16).toString("hex")}`;
const inside = (base: string, target: string) => target.startsWith(base + path.sep);
const url = localDatabaseUrl(); // Guard before any schema mutation.
const diagnosticSecrets = [url, new URL(url).password, decodeURIComponent(new URL(url).password)];
function safeDiagnostic(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of diagnosticSecrets) if (secret) message = message.replaceAll(secret, "[redacted]");
  return message.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[database]").replace(/params:[^\r\n]*/g, "params: [redacted]").slice(0, 6000);
}
const admin = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { statement_timeout: 10000 } });
const client = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {}, connection: { search_path: isolated, statement_timeout: 10000 } });
const db = drizzle(client, { schema });
let root: string | undefined, server: ChildProcess | undefined, created = false;
async function copy(source: string) {
  assert.ok(root && inside(checkout, source), "Package source escapes checkout");
  const destination = path.resolve(root, path.relative(checkout, source));
  assert.ok(inside(root, destination), "Package destination escapes temporary root");
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}
async function main() {
  let primaryFailure: unknown;
  try {
    root = await mkdtemp(path.join(os.tmpdir(), "gallery-package-"));
    assert.ok(inside(path.resolve(os.tmpdir()), root));
    const inventory = new Set<string>();
    for (const name of [".next/next-server.js.nft.json", ".next/server/app/api/v1/admin/catalog/products/[id]/images/route.js.nft.json"]) {
      const tracePath = path.resolve(checkout, name);
      const trace = JSON.parse(await readFile(tracePath, "utf8"));
      for (const file of trace.files) inventory.add(path.resolve(path.dirname(tracePath), file));
      inventory.add(tracePath);
      if (name.endsWith("route.js.nft.json")) inventory.add(tracePath.replace(".nft.json", ""));
    }
    const required = JSON.parse(await readFile(".next/required-server-files.json", "utf8"));
    for (const name of required.files) inventory.add(path.resolve(checkout, name));
    inventory.add(path.resolve(checkout, "package.json"));
    for (const source of inventory) await copy(source);
    await access(path.join(root, "src/lib/media/image-worker.cjs"));
    // The traced NextServer entry serves the built route without requiring untraced CLI files.
    const config = { ...required.config, distDir: ".next" };
    await writeFile(path.join(root, "server.cjs"), `const NextServer=require('next/dist/server/next-server').default; const app=new NextServer({dir:process.cwd(),dev:false,conf:${JSON.stringify(config)},hostname:'127.0.0.1',port:Number(process.env.PORT)}); require('node:http').createServer(app.getRequestHandler()).listen(Number(process.env.PORT),'127.0.0.1');`);
    assert.match(isolated, /^gallery_package_[a-f0-9]{32}$/);
    await admin.unsafe(`CREATE SCHEMA "${isolated}"`); created = true;
    const journal = JSON.parse(await readFile("src/db/migrations/meta/_journal.json", "utf8"));
    for (const { tag } of journal.entries) {
      const ddl = (await readFile(`src/db/migrations/${tag}.sql`, "utf8")).replaceAll('"public".', `"${isolated}".`);
      for (const statement of ddl.split("--> statement-breakpoint")) if (statement.trim()) await client.unsafe(statement);
    }
    // The historical idempotency migration is outside the current journal;
    // reuse only its operation_keys DDL in this disposable compatibility fixture.
    const compatibility = await readFile("src/db/migrations/0005_sessions_proof_idempotency.sql", "utf8");
    for (const statement of compatibility.split("--> statement-breakpoint")) {
      if (/^\s*CREATE (?:TABLE "operation_keys"|UNIQUE INDEX "operation_keys_scope_uq")/.test(statement)) await client.unsafe(statement);
    }
    await client.unsafe(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS scope text; ALTER TABLE sessions ADD COLUMN IF NOT EXISTS subject text; ALTER TABLE sessions ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz`);
    const key = randomBytes(32), userId = randomUUID(), productId = randomUUID();
    diagnosticSecrets.push(key.toString("base64"));
    await db.insert(schema.users).values({ id: userId, name: "Packaged gallery", email: `${userId}@example.test`, phone: "01000000000", passwordHash: "fixture", role: "staff" });
    await db.insert(schema.staffAccounts).values({ userId, mfaEnrolledAt: new Date(), mfaSeed: encryptStaffSecret(newStaffSeed(), key, userId, "mfa") });
    await db.insert(schema.roles).values({ key: "catalog" }).onConflictDoNothing();
    await db.insert(schema.userRoles).values({ userId, roleKey: "catalog" });
    const session = await issueStaffSession(db, userId, STAFF_SESSION_POLICY); assert.ok(session);
    const token = session.token;
    diagnosticSecrets.push(token);
    await db.insert(schema.products).values({ id: productId, name: "Packaged upload fixture", status: "draft" });
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
    const address = reservation.address(); assert.ok(address && typeof address !== "string");
    const port = address.port;
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    const origin = `http://127.0.0.1:${port}`;
    const connection = new URL(url); connection.searchParams.set("search_path", isolated);
    // A built production server with development auth configuration permits bounded loopback HTTP.
    // No inherited NODE_PATH, NODE_OPTIONS, checkout cwd, or checkout environment files.
    server = spawn(process.execPath, ["server.cjs"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
      SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, NODE_ENV: "development", PORT: String(port), APP_URL: origin,
      DATABASE_URL: connection.toString(), STAFF_MFA_KEY: key.toString("base64"), NEXT_TELEMETRY_DISABLED: "1",
    } });
    let failure = false, output = "";
    server.on("error", () => { failure = true; });
    for (const stream of [server.stdout, server.stderr]) stream?.on("data", bytes => {
      output = (output + bytes.toString()).slice(-4000);
    });
    const diagnostics = () => output.replaceAll(connection.toString(), "[database]").replaceAll(url, "[database]").replaceAll(key.toString("base64"), "[key]").replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "[database]");
    const endpoint = `${origin}/api/v1/admin/catalog/products/${productId}/images`;
    const cookie = `__Host-staff-session=${token}`;
    let ready = false;
    for (let i = 0; i < 100; i++) {
      assert.ok(!failure && server.exitCode === null, `Packaged server exited before readiness: ${diagnostics()}`);
      try { if ((await fetch(endpoint, { headers: { cookie }, signal: AbortSignal.timeout(1000) })).status === 200) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, `Packaged gallery readiness failed: ${diagnostics()}`);
    const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: "blue" } }).png().toBuffer();
    const idempotencyKey = randomUUID();
    async function upload() {
      const form = new FormData(); form.set("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "fixture.png");
      const response = await fetch(endpoint, { method: "POST", headers: { cookie, origin, "x-csrf-token": sessionCsrf(token, key), "idempotency-key": idempotencyKey }, body: form, signal: AbortSignal.timeout(25000) });
      const result = await response.json(); assert.equal(response.status, 201, `${JSON.stringify(result)} ${diagnostics()}`); return result;
    }
    const first = await upload(), replay = await upload();
    assert.deepEqual(replay, first);
    const attachments = await db.select().from(schema.productMedia), media = await db.select().from(schema.media);
    assert.equal(attachments.length, 1); assert.equal(media.length, 1);
    assert.equal(attachments[0].productId, productId);
    assert.equal(attachments[0].id, first.image.id); assert.equal(attachments[0].mediaId, first.image.mediaId);
    assert.equal(media[0].id, first.image.mediaId); assert.equal(media[0].status, "pending");
    assert.match(media[0].filename, /^[a-z0-9_-]+\.png$/i);
    const privateBytes = await readFile(path.join(root, "storage/private", media[0].filename));
    assert.equal(privateBytes.length, media[0].size);
    const metadata = await sharp(privateBytes).metadata();
    assert.equal(metadata.width, 32); assert.equal(metadata.height, 24); assert.equal(metadata.format, "png");
    const decoded = await sharp(privateBytes).raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, 32); assert.equal(decoded.info.height, 24);
    assert.equal(decoded.info.channels, 3); assert.equal(decoded.data.length, 32 * 24 * 3);
    await assert.rejects(access(path.join(root, "public/uploads", media[0].filename)), { code: "ENOENT" });
    console.log(JSON.stringify({ packagedFiles: inventory.size, authenticatedUpload: 201, retry: 201, attachments: 1, media: 1, privateImage: true, width: 32, height: 24, isolatedSchema: isolated }));
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const errors: string[] = [];
    const attempt = async (name: string, action: () => Promise<unknown>) => { try { await action(); } catch { errors.push(name); } };
    let stopped = !server;
    await attempt("server termination", async () => {
      if (server && server.exitCode === null && server.signalCode === null) {
        const exited = new Promise<void>(resolve => server!.once("close", () => resolve()));
        server.kill("SIGKILL");
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Server termination timeout")), 5000); })]); }
        finally { clearTimeout(timer); }
      }
      stopped = true;
    });
    await attempt("database client", () => client.end({ timeout: 5 }));
    await attempt("schema", async () => { if (created) { assert.match(isolated, /^gallery_package_[a-f0-9]{32}$/); await admin.unsafe(`DROP SCHEMA "${isolated}" CASCADE`); } });
    await attempt("admin client", () => admin.end({ timeout: 5 }));
    await attempt("temporary package", async () => { if (root && stopped) { assert.ok(inside(path.resolve(os.tmpdir()), root) && path.basename(root).startsWith("gallery-package-")); await rm(root, { recursive: true, force: true }); } });
    if (errors.length) throw new Error(`${primaryFailure === undefined ? "" : `Primary failure: ${safeDiagnostic(primaryFailure).slice(0, 5000)}; `}Cleanup failed: ${errors.join(", ")}`);
  }
}
main().catch(error => { console.error("Packaged gallery verification failed:", safeDiagnostic(error)); process.exitCode = 1; });
