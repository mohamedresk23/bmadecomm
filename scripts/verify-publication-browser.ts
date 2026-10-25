import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createServer } from "node:net";
import dotenv from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { chromium, type Browser } from "playwright-core";
import sharp from "sharp";
import * as schema from "../src/db/schema";
import { localDatabaseUrl } from "./local-database-config";
import { issueStaffSession } from "../src/modules/identity/infrastructure/staff-sessions";
import { STAFF_SESSION_POLICY } from "../src/modules/identity/infrastructure/staff-config";
import { encryptStaffSecret, newStaffSeed } from "../src/modules/identity/infrastructure/staff-crypto";

dotenv.config({ path: ".env.local", quiet: true });
const isolated = `publication_browser_${randomBytes(16).toString("hex")}`;
const url = localDatabaseUrl();
const admin = postgres(url, { max: 1, onnotice: () => {} });
const client = postgres(url, { max: 1, onnotice: () => {}, connection: { search_path: isolated } });
const db = drizzle(client, { schema });
const filenames: string[] = [];
let server: ChildProcess | undefined, browser: Browser | undefined, created = false;
async function availablePort() {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const address = reservation.address(); assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}
async function main() {
  try {
    assert.match(isolated, /^publication_browser_[a-f0-9]{32}$/);
    await admin.unsafe(`CREATE SCHEMA "${isolated}"`); created = true;
    const journal = JSON.parse(await readFile("src/db/migrations/meta/_journal.json", "utf8"));
    for (const { tag } of journal.entries) {
      const ddl = (await readFile(`src/db/migrations/${tag}.sql`, "utf8")).replaceAll('"public".', `"${isolated}".`);
      for (const statement of ddl.split("--> statement-breakpoint")) if (statement.trim()) await client.unsafe(statement);
    }
    // Match the existing test session compatibility fixture conventions.
    await client.unsafe(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS scope text;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS subject text;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz`);
    const key = randomBytes(32).toString("base64"), userId = randomUUID();
    await db.insert(schema.users).values({ id: userId, name: "Gallery browser", email: `${userId}@example.test`, phone: "01000000000", passwordHash: "fixture", role: "staff" });
    await db.insert(schema.staffAccounts).values({ userId, mfaEnrolledAt: new Date(), mfaSeed: encryptStaffSecret(newStaffSeed(), Buffer.from(key,"base64"), userId,"mfa") });
    await db.insert(schema.roles).values({ key: "catalog" }).onConflictDoNothing();
    await db.insert(schema.userRoles).values({ userId, roleKey: "catalog" });
    const session = await issueStaffSession(db, userId, STAFF_SESSION_POLICY); assert.ok(session);
    await db.insert(schema.products).values({ id: "gallery-browser-product", name: "Publication browser fixture", status: "draft" });
    await client`INSERT INTO store_settings(id,store_name,support_email,support_phone,currency,currency_exponent) VALUES('default','Test','test@example.test','01000000000','USD',2) ON CONFLICT DO NOTHING`;
    await client`UPDATE store_settings SET currency='USD', currency_exponent=2 WHERE id='default'`;
    await client`INSERT INTO categories(id,name,slug) VALUES('cat','Test','test')`;
    await client`INSERT INTO product_categories(product_id,category_id) VALUES('gallery-browser-product','cat')`;
    const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: "blue" } }).png().toBuffer();
    await mkdir("storage/private", { recursive: true });
    for (let i=0; i<3; i++) {
      const filename = `publication_browser_${randomBytes(16).toString("hex")}.png`;
      await writeFile(path.join("storage/private",filename), bytes, { flag: "wx" });
      filenames.push(filename);
      await db.insert(schema.media).values({ id: `media-${i}`, filename, mimeType: "image/png", size: bytes.length, status: "pending" });
      await db.insert(schema.productMedia).values({ id: `image-${i}`, productId: "gallery-browser-product", mediaId: `media-${i}`, sortOrder: i, altText: `Description ${i}` });
    }
    const connection = new URL(url); connection.searchParams.set("search_path", isolated);
    await readFile(".next/BUILD_ID", "utf8");
    const port = await availablePort(), origin = `http://127.0.0.1:${port}`;
    let spawnError = false, exited = false, started = false, serverOutput = "";
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development", APP_URL: origin, DATABASE_URL: connection.toString(), STAFF_MFA_KEY: key, NEXT_TELEMETRY_DISABLED: "1" },
    });
    server.once("error", () => { spawnError = true; });
    server.once("exit", () => { exited = true; });
    server.stdout?.on("data", chunk => {
      serverOutput = (serverOutput + chunk.toString()).slice(-4000);
      started = /Ready in/.test(serverOutput);
    });
    server.stderr?.resume();
    let ready = false;
    for (let i=0; i<100; i++) {
      if (spawnError || exited) throw new Error("Isolated server failed before readiness");
      try { if (started && (await fetch(`${origin}/admin/login`, { signal: AbortSignal.timeout(1000) })).ok && !exited) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve,250));
    }
    assert.ok(ready, "Isolated server ready");
    browser = await chromium.launch({ channel: "msedge", headless: true });
    await db.insert(schema.variants).values({ id: "pub-v0", productId: "gallery-browser-product", sku: "PUBLICATION-A5", combinationKey: "", priceMinor: BigInt(100), currency: "USD", currencyScale: 2, sortOrder: 0 });
    const evidence: unknown[] = [];
    for (const width of [320, 768, 1024, 1440]) {
      await client`UPDATE products SET description = NULL WHERE id = 'gallery-browser-product'`;
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.addCookies([{ name: "__Host-staff-session", value: session.token, domain: "127.0.0.1", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      const transitions: string[] = [];
      page.on("request", request => { if (request.method() === "POST" && /\/(?:publish|unpublish)$/.test(new URL(request.url()).pathname)) transitions.push(request.url()); });
      await page.goto(`${origin}/admin/catalog/products`);
      await page.getByRole("button", { name: "تعديل Publication browser fixture", exact: true }).click();
      await page.getByTestId("gallery-alt-input-image-0").waitFor();
      assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
      const checklist = page.getByRole("button", { name: "أدخل وصف المنتج", exact: true });
      await checklist.waitFor();
      await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
      let reached = false;
      for (let step = 0; step < 150; step++) {
        await page.keyboard.press("Tab");
        if (await checklist.evaluate(node => document.activeElement === node)) { reached = true; break; }
      }
      assert.ok(reached, "Checklist correction reachable by keyboard");
      assert.notEqual(await checklist.evaluate(node => getComputedStyle(node).outlineStyle), "none");
      await page.keyboard.press("Enter");
      const description = page.getByLabel("الوصف", { exact: true });
      assert.equal(await description.evaluate(node => document.activeElement === node), true);
      await page.keyboard.type(`Publication description ${width}`);
      await page.getByRole("button", { name: "حفظ المسودة", exact: true }).click();
      await page.getByText("المنتج جاهز للنشر.", { exact: true }).waitFor();
      const publishButton = page.getByRole("button", { name: "نشر المنتج", exact: true });
      await publishButton.focus();
      // Playwright chooses the JS dialog branch; this is not a native-dialog keyboard observation.
      let dialog = page.waitForEvent("dialog");
      let activation = page.keyboard.press("Enter");
      const cancelledPublish = await dialog;
      assert.equal(cancelledPublish.type(), "confirm"); await cancelledPublish.dismiss();
      await activation;
      assert.equal(transitions.length, 0);
      assert.equal(await publishButton.evaluate(node => document.activeElement === node), true);
      const published = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/publish"));
      dialog = page.waitForEvent("dialog"); activation = page.keyboard.press("Enter"); await (await dialog).accept(); await activation;
      assert.equal((await published).status(), 200);
      await page.getByText("حالة المنتج: منشور", { exact: true }).waitFor();
      await page.getByTestId("gallery-readonly-notice").waitFor();
      assert.equal(await page.getByTestId("gallery-alt-input-image-0").isDisabled(), true);
      assert.equal(await page.getByTestId("gallery-move-later-image-0").isDisabled(), true);
      const unpublishButton = page.getByRole("button", { name: "إلغاء النشر", exact: true });
      await unpublishButton.focus();
      const beforeCancel = transitions.length;
      dialog = page.waitForEvent("dialog"); activation = page.keyboard.press("Enter"); await (await dialog).dismiss(); await activation;
      assert.equal(transitions.length, beforeCancel);
      assert.equal(await unpublishButton.evaluate(node => document.activeElement === node), true);
      const unpublished = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/unpublish"));
      dialog = page.waitForEvent("dialog"); activation = page.keyboard.press("Enter"); await (await dialog).accept(); await activation;
      assert.equal((await unpublished).status(), 200);
      await page.getByText("حالة المنتج: مسودة", { exact: true }).waitFor();
      await page.waitForFunction(() => !(document.querySelector('[data-testid="gallery-alt-input-image-0"]') as HTMLInputElement)?.disabled);
      assert.equal(await page.getByTestId("gallery-readonly-notice").count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No horizontal overflow at ${width}`);
      evidence.push({ width, rtl: true, reflow: true, checklistTabEnter: true, correctionFocus: true, visibleChecklistFocus: true, publishCancelledWithoutMutation: true, unpublishCancelledWithoutMutation: true, transitions: transitions.length, publishedGalleryLocked: true, draftEditingRestored: true, nativeDialogKeyboard: "not-observed", screenReaderListening: "not-observed" });
      await context.close();
    }
    await mkdir(".local", { recursive: true });
    await writeFile(".local/publication-browser-verification.json", JSON.stringify({ at: new Date().toISOString(), checks: evidence }, null, 2));
    console.log(JSON.stringify(evidence));
  } finally {
    const cleanupErrors: string[] = [];
    const attempt = async (label: string, action: () => Promise<unknown>) => {
      try { await action(); } catch { cleanupErrors.push(label); }
    };
    await Promise.all([
      attempt("browser", async () => browser?.close()),
      attempt("server", async () => {
        if (server && server.exitCode === null && server.signalCode === null && server.pid) {
          const stopped = new Promise<void>(resolve => server!.once("exit", () => resolve()));
          if (!server.kill()) throw new Error("Server termination failed");
          let timer: ReturnType<typeof setTimeout> | undefined;
          try { await Promise.race([stopped, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Server termination timed out")), 5000); })]); }
          finally { clearTimeout(timer); }
        }
      }),
      ...filenames.map(filename => attempt("private image", async () => {
        try { await unlink(path.join("storage/private",filename)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      })),
      attempt("client", () => client.end()),
    ]);
    await attempt("schema", async () => { if (created) await admin.unsafe(`DROP SCHEMA "${isolated}" CASCADE`); });
    await attempt("admin client", () => admin.end());
    if (cleanupErrors.length) throw new Error(`Cleanup failed for: ${cleanupErrors.join(", ")}`);
  }
}
main().catch(error => { console.error("Publication browser verification failed:", error.cause?.message ?? error.message.split("\nparams:")[0]); process.exitCode=1; });
