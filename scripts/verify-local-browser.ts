import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { eq } from "drizzle-orm";
import type { DbContext } from "../src/db/tx";
import { users, proofTokens } from "../src/db/schema";
import { INVALID_VERIFICATION } from "../src/modules/identity/contracts/verification";

type BrowserCheckInput = {
  db: DbContext;
  origin: string;
  trustedHeader: string;
  source: string;
  synthetic(label: string): { name: string; email: string; phone: string; password: string };
  prepareMail(userId: string): Promise<unknown>;
  stage(label: string): void;
};

/** Installed Edge only; ephemeral context/profile, no screenshots, traces or secret logs. */
export async function verifyLocalBrowser(input: BrowserCheckInput) {
  input.stage("headless Edge launch");
  const browser = await chromium.launch({ channel: "msedge", headless: true, timeout: 20000 });
  try {
    const context = await browser.newContext({ extraHTTPHeaders: { [input.trustedHeader]: input.source } });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    let verifyPosts = 0, leakedUrl = false;
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.protocol === "http:" || url.protocol === "https:") {
        if (url.hash || url.searchParams.has("token")) leakedUrl = true;
        if (url.pathname === "/api/v1/auth/verify" && request.method() === "POST") verifyPosts++;
      }
    });
    async function register(label: string) {
      const dto = input.synthetic(label);
      await page.goto(`${input.origin}/register`);
      for (const [label, value] of [["Name", dto.name], ["Email", dto.email], ["Phone", dto.phone], ["Password", dto.password]]) await page.getByLabel(label, { exact: true }).fill(value);
      await page.getByRole("button", { name: "Register", exact: true }).click();
      await page.getByRole("heading", { name: "Registration successful" }).waitFor();
      const [user] = await input.db.select().from(users).where(eq(users.email, dto.email));
      assert.ok(user); assert.equal(user.verifiedAt, null);
      await input.prepareMail(user.id);
      return user;
    }
    async function openMail(userId: string) {
      const filename = createHash("sha256").update(`register-verification-${userId}`).digest("hex") + ".html";
      await page.goto(pathToFileURL(path.resolve(".local", "sandbox-mail", filename)).toString());
      // Click the actual private Sandbox document, not a synthesized application URL.
      await page.getByRole("link", { name: "Verify your email" }).click();
      await page.waitForFunction(() => window.location.pathname === "/verify-email" && window.location.hash === "");
      await page.locator('button[type="submit"]:enabled').waitFor();
      assert.equal(new URL(page.url()).hash, "");
    }
    input.stage("browser registration, private mail link and deliberate confirmation");
    const customer = await register("browser-valid"); await openMail(customer.id);
    assert.equal(verifyPosts, 0);
    assert.equal((await input.db.select().from(users).where(eq(users.id, customer.id)))[0].verifiedAt, null);
    const [before] = await input.db.select().from(proofTokens).where(eq(proofTokens.userId, customer.id));
    assert.equal(before.consumedAt, null);
    await page.getByRole("button", { name: "Verify email", exact: true }).click();
    await page.getByRole("heading", { name: "Email verified" }).waitFor();
    assert.equal(verifyPosts, 1);
    const [activated] = await input.db.select().from(users).where(eq(users.id, customer.id));
    const [consumed] = await input.db.select().from(proofTokens).where(eq(proofTokens.id, before.id));
    assert.ok(activated.verifiedAt); assert.equal(activated.verifiedAt.getTime(), consumed.consumedAt?.getTime());

    input.stage("browser used-link rejection and reopen guidance");
    await openMail(customer.id); await page.getByRole("button", { name: "Verify email", exact: true }).click();
    // Next's document also has a route-announcer alert; keep the product rejection
    // locator scoped for both readiness and text assertions.
    const rejection = page.getByRole("alert").filter({ hasText: INVALID_VERIFICATION });
    await rejection.waitFor();
    assert.ok((await rejection.textContent())?.includes("Reopen the original email link"));
    assert.equal((await input.db.select().from(users).where(eq(users.id, customer.id)))[0].verifiedAt?.getTime(), activated.verifiedAt.getTime());
    assert.equal((await input.db.select().from(proofTokens).where(eq(proofTokens.id, before.id)))[0].consumedAt?.getTime(), consumed.consumedAt?.getTime());

    input.stage("browser expired-link rejection without activation");
    const expired = await register("browser-expired");
    assert.equal(expired.email, input.synthetic("browser-expired").email);
    await input.db.update(proofTokens).set({ expiresAt: new Date(0) }).where(eq(proofTokens.userId, expired.id));
    await openMail(expired.id); await page.getByRole("button", { name: "Verify email", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: INVALID_VERIFICATION }).waitFor();
    assert.equal((await input.db.select().from(users).where(eq(users.id, expired.id)))[0].verifiedAt, null);
    assert.equal((await input.db.select().from(proofTokens).where(eq(proofTokens.userId, expired.id)))[0].consumedAt, null);
    assert.equal(leakedUrl, false);
    await context.close();
  } finally { await browser.close(); }
}
