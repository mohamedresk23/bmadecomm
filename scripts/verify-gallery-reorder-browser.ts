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
const isolated = `gallery_browser_${randomBytes(16).toString("hex")}`;
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
    assert.match(isolated, /^gallery_browser_[a-f0-9]{32}$/);
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
    await db.insert(schema.products).values({ id: "gallery-browser-product", name: "Gallery reorder browser fixture", status: "draft" });
    const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: "blue" } }).png().toBuffer();
    await mkdir("storage/private", { recursive: true });
    for (let i=0; i<3; i++) {
      const filename = `gallery_browser_${randomBytes(16).toString("hex")}.png`;
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
    const evidence: unknown[] = [];
    for (const width of [320,768,1024,1440]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: true });
      await context.addCookies([{ name: "__Host-staff-session", value: session.token, domain: "127.0.0.1", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      await page.goto(`${origin}/admin/catalog/products`);
      await page.getByRole("button", { name: /Gallery reorder browser fixture/ }).click();
      const cards = page.locator('[data-testid^="gallery-image-"]'); await cards.first().waitFor();
      assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
      const initial = await cards.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-testid")!.replace("gallery-image-", "")));
      const moved = initial[1], previous = initial[0];
      const button = page.getByTestId(`gallery-move-earlier-${moved}`);
      // Start at the document, then reach the move action using real tab navigation.
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      const reachedControls = new Set<string>();
      const expectedControls = initial.flatMap(id => [`gallery-move-earlier-${id}`, `gallery-move-later-${id}`]);
      let reachable = false;
      for (let tab=0; tab<100; tab++) {
        await page.keyboard.press("Tab");
        const active = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
        if (active?.startsWith("gallery-move-")) reachedControls.add(active);
        if (active === `gallery-move-earlier-${moved}` && expectedControls.every(id => reachedControls.has(id))) { reachable = true; break; }
      }
      assert.ok(reachable, "All earlier/later controls are reachable through Tab navigation");
      await page.keyboard.press("Enter");
      assert.equal(await button.evaluate(node => document.activeElement === node), true);
      assert.equal(await button.getAttribute("aria-disabled"), "true");
      const announcement = await page.getByTestId("gallery-move-status").textContent();
      assert.ok(announcement?.includes(moved));
      assert.ok(announcement?.includes("إلى الموضع 1 من 3"));
      assert.ok(announcement?.includes("الصورة في الموضع الأول هي الرئيسية الآن."));
      assert.equal(await page.getByTestId("gallery-move-status").getAttribute("aria-live"), "polite");
      const focusOutline = await button.evaluate(node => getComputedStyle(node).outlineStyle);
      assert.notEqual(focusOutline,"none");
      await page.getByTestId(`gallery-alt-input-${moved}`).fill(`Edited at ${width}`);
      const saved = page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/images"));
      await page.getByTestId("gallery-save-button").click(); assert.equal((await saved).status(),200);
      await page.getByTestId("gallery-save-success").waitFor();
      await page.reload(); await page.getByRole("button", { name: /Gallery reorder browser fixture/ }).click();
      await cards.first().waitFor();
      assert.equal(await cards.first().getAttribute("data-testid"), `gallery-image-${moved}`);
      assert.equal(await page.getByTestId(`gallery-alt-input-${moved}`).inputValue(), `Edited at ${width}`);
      // Touch activation also swaps locally; undo it before closing.
      await page.getByTestId(`gallery-move-later-${moved}`).tap();
      assert.equal(await cards.first().getAttribute("data-testid"), `gallery-image-${previous}`);
      await page.getByTestId(`gallery-move-earlier-${moved}`).tap();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow,false, `No horizontal overflow at ${width}`);
      const box = await button.boundingBox(); assert.ok(box && box.height >= 44);
      evidence.push({ width, rtl: true, tabReachable: true, keyboardFocus: true, focusOutline, destinationAndPrimaryAnnouncement: true, persistedOrderAndAlt: true, touch: true, reflow: true });
      await context.close();
    }
    await mkdir(".local", { recursive: true });
    await writeFile(".local/gallery-reorder-browser-verification.json",JSON.stringify({ at: new Date().toISOString(), checks: evidence },null,2));
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
main().catch(error => { console.error("Gallery reorder browser verification failed:", error.cause?.message ?? error.message.split("\nparams:")[0]); process.exitCode=1; });
