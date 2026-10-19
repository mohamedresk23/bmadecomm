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
const isolated = `variant_browser_${randomBytes(16).toString("hex")}`;
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
    assert.match(isolated, /^variant_browser_[a-f0-9]{32}$/);
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
    await db.insert(schema.products).values({ id: "gallery-browser-product", name: "Variant image browser fixture", status: "draft" });
    await client`INSERT INTO store_settings(id,store_name,support_email,support_phone,currency,currency_exponent) VALUES('default','Test','test@example.test','01000000000','USD',2) ON CONFLICT DO NOTHING`;
    await client`UPDATE store_settings SET currency='USD', currency_exponent=2 WHERE id='default'`;
    await client`INSERT INTO categories(id,name,slug) VALUES('cat','Test','test')`;
    await client`INSERT INTO product_categories(product_id,category_id) VALUES('gallery-browser-product','cat')`;
    const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: "blue" } }).png().toBuffer();
    await mkdir("storage/private", { recursive: true });
    for (let i=0; i<3; i++) {
      const filename = `variant_browser_${randomBytes(16).toString("hex")}.png`;
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
      await db.delete(schema.variantMedia);
      await db.delete(schema.productMedia);
      await db.delete(schema.variants);
      await client`UPDATE products SET media_revision = 0 WHERE id = 'gallery-browser-product'`;
      for (let i = 0; i < 3; i++) {
        await db.insert(schema.productMedia).values({ id: `image-${i}`, productId: "gallery-browser-product", mediaId: `media-${i}`, sortOrder: i, altText: `Description ${i}` });
      }
      await db.insert(schema.variants).values(["red","blue"].map((color,index) => ({ id: `v${index}`, productId: "gallery-browser-product", sku: `SKU-${index}`, combinationKey: `color:${color}`, priceMinor: BigInt(0), currency: "USD", currencyScale: 2, sortOrder: index })));
      await db.insert(schema.variantAttributes).values(["red","blue"].map((value,index) => ({ variantId: `v${index}`, name: "color", value })));
      const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: true });
      await context.addCookies([{ name: "__Host-staff-session", value: session.token, domain: "127.0.0.1", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      const open = async () => { await page.goto(`${origin}/admin/catalog/products`); await page.getByRole("button", { name: /Variant image browser fixture/ }).click(); await page.getByTestId("variant-image-v0").waitFor(); };
      const saveGallery = async () => { const [response] = await Promise.all([page.waitForResponse(r => r.request().method() === "PUT" && r.url().endsWith("/images")), page.getByTestId("gallery-save-button").click()]); assert.equal(response.status(),200); await page.getByTestId("gallery-save-success").waitFor(); };
      const saveProduct = async () => { const [response] = await Promise.all([page.waitForResponse(r => r.request().method() === "PUT" && r.url().endsWith("/gallery-browser-product")), page.locator('form').first().getByRole("button", { name: "\u062d\u0641\u0638 \u0627\u0644\u0645\u0633\u0648\u062f\u0629", exact: true }).click()]); assert.equal(response.status(),200); await page.waitForFunction(() => !document.querySelector('section[aria-busy="true"]')); };
      await open();
      assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
      await page.getByTestId("variant-image-v0").focus();
      await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Tab");
      assert.equal(await page.getByTestId("variant-image-v0").inputValue(),"image-1");
      await page.getByTestId("variant-image-v1").selectOption("image-1"); await saveGallery();
      await open();
      assert.equal(await page.getByTestId("variant-image-v0").inputValue(),"image-1");
      assert.equal(await page.getByTestId("variant-image-v1").inputValue(),"image-1");
      await page.getByRole("textbox", { name: "SKU 1", exact: true }).fill(`EDITED-${width}`); await saveProduct();
      assert.equal(await page.getByTestId("variant-image-v0").inputValue(),"image-1");
      await page.getByTestId("gallery-alt-input-image-0").fill(`Keep local ${width}`);
      await page.getByRole("textbox", { name: "\u0627\u0644\u0648\u0635\u0641", exact: true }).fill(`Description ${width}`); await saveProduct();
      assert.equal(await page.getByTestId("gallery-alt-input-image-0").inputValue(),`Keep local ${width}`);
      // Remove a persisted variant while the gallery has pending edits.
      page.once("dialog", dialog => dialog.accept());
      await page.getByRole("textbox", { name: "\u0623\u0628\u0639\u0627\u062f \u0627\u0644\u0645\u062a\u063a\u064a\u0631\u0627\u062a", exact: true }).fill("color: red");
      await page.getByRole("button", { name: "\u062a\u0648\u0644\u064a\u062f \u0627\u0644\u0645\u062a\u063a\u064a\u0631\u0627\u062a", exact: true }).tap();
      await saveProduct();
      assert.equal(await page.getByTestId("variant-image-v1").count(),0);
      assert.equal(await page.getByTestId("gallery-alt-input-image-0").inputValue(),`Keep local ${width}`);
      assert.equal(await page.getByTestId("gallery-save-button").isDisabled(),true);
      page.once("dialog", dialog => dialog.accept()); await page.getByTestId("gallery-reload-button").click();
      await page.getByTestId("gallery-reload-button").waitFor({state:"detached"});
      assert.equal(await page.getByTestId("variant-image-v0").inputValue(),"image-1");
      await page.getByTestId("variant-image-v0").selectOption(""); await saveGallery(); await open();
      assert.equal(await page.getByTestId("variant-image-v0").inputValue(),"");

      // --- Slice 7: Remove gallery images while retaining history ---
      // Map v0 to image-1 and save gallery
      await page.getByTestId("variant-image-v0").selectOption("image-1");
      await saveGallery();
      assert.equal(await page.getByTestId("variant-image-v0").inputValue(), "image-1");

      // Cancel removal: opens dialog, clicking cancel closes dialog and retains image
      await page.getByTestId("gallery-remove-image-1").click();
      await page.getByTestId("gallery-remove-dialog").waitFor();
      await page.getByTestId("gallery-remove-cancel").click();
      await page.getByTestId("gallery-remove-dialog").waitFor({ state: "detached" });
      assert.equal(await page.getByTestId("gallery-remove-image-1").count(), 1);

      // Dirty warning in removal confirmation
      await page.getByTestId("gallery-alt-input-image-0").fill(`Dirty alt ${width}`);
      await page.getByTestId("gallery-remove-image-1").click();
      await page.getByTestId("gallery-remove-dialog").waitFor();
      assert.ok(await page.getByTestId("gallery-remove-dialog").getByText(/تعديلات غير محفوظة/).isVisible());

      // Confirm removal of mapped image-1
      const removeMappedPromise = page.waitForResponse(r => r.request().method() === "DELETE" && r.url().includes("/images/image-1"));
      await page.getByTestId("gallery-remove-confirm").click();
      const removeMappedRes = await removeMappedPromise;
      assert.equal(removeMappedRes.status(), 200);
      await page.waitForFunction(() => !document.querySelector('section[aria-busy="true"]'));
      await page.getByTestId("gallery-remove-image-1").waitFor({ state: "detached" });

      // Verify variant mapping for v0 was cleared, falling back to primary image (value "")
      assert.equal(await page.getByTestId("variant-image-v0").inputValue(), "");

      // Verify private preview of detached image returns 404 to staff session
      const staffPreviewStatus = await page.evaluate(async (url) => (await fetch(url)).status, `${origin}/api/v1/admin/catalog/products/gallery-browser-product/images/image-1/content`);
      assert.equal(staffPreviewStatus, 404, "Preview endpoint returns 404 for detached image");

      // Verify guest request cannot access draft image preview (returns 401 or 403)
      const guestPreviewRes = await fetch(`${origin}/api/v1/admin/catalog/products/gallery-browser-product/images/image-0/content`);
      assert.ok([401, 403].includes(guestPreviewRes.status), "Guest request refused for draft preview");

      // Verify physical disk file is retained for the soft-removed image-1
      const media1Row = await db.query.media.findFirst({ where: (m, { eq }) => eq(m.id, "media-1") });
      assert.ok(media1Row, "Media record retained");
      const diskBytes = await readFile(path.join("storage/private", media1Row.filename));
      assert.ok(diskBytes.length > 0, "Physical file preserved on disk");

      // Remove primary image-0 -> image-2 becomes primary
      const removePrimaryPromise = page.waitForResponse(r => r.request().method() === "DELETE" && r.url().includes("/images/image-0"));
      await page.getByTestId("gallery-remove-image-0").click();
      await page.getByTestId("gallery-remove-confirm").click();
      const removePrimaryRes = await removePrimaryPromise;
      assert.equal(removePrimaryRes.status(), 200);
      await page.waitForFunction(() => !document.querySelector('section[aria-busy="true"]'));
      await page.getByTestId("gallery-remove-image-0").waitFor({ state: "detached" });

      // Remove last remaining image-2 -> empty gallery state and focus to upload input
      const removeLastPromise = page.waitForResponse(r => r.request().method() === "DELETE" && r.url().includes("/images/image-2"));
      await page.getByTestId("gallery-remove-image-2").click();
      await page.getByTestId("gallery-remove-confirm").click();
      const removeLastRes = await removeLastPromise;
      assert.equal(removeLastRes.status(), 200);
      await page.waitForFunction(() => !document.querySelector('section[aria-busy="true"]'));
      await page.getByTestId("gallery-remove-image-2").waitFor({ state: "detached" });
      await page.getByText("لا توجد صور بعد.").waitFor();
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), "gallery-upload-input");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow,false, `No horizontal overflow at ${width}`);
      const box = await page.getByTestId("variant-image-v0").boundingBox(); assert.ok(box && box.height>=44);
      evidence.push({ width, rtl: true, keyboardSelect: true, mapShareClearReload: true, retainedSkuEdit: true, removedMapping: true, dirtyRecovery: true, touch: true, reflow: true, removeCancel: true, removeMappedImage: true, emptyStateFocus: true, mediaPreserved: true });
      await context.close();
    }
    await mkdir(".local", { recursive: true });
    await writeFile(".local/variant-images-browser-verification.json",JSON.stringify({ at: new Date().toISOString(), checks: evidence },null,2));
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
main().catch(error => { console.error("Variant image browser verification failed:", error.cause?.message ?? error.message.split("\nparams:")[0]); process.exitCode=1; });
