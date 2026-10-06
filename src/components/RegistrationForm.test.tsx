/** @vitest-environment jsdom */
import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { RegistrationForm } from "./RegistrationForm";
import { POST } from "../app/api/v1/auth/register/route";
import { db } from "../db";
import { users } from "../db/schema";
import { setupTestDb } from "../test-utils/db";
import { composeIdentityWorker } from "../modules/identity/infrastructure/worker";

beforeAll(setupTestDb);
beforeEach(() => {
  vi.stubEnv("EMAIL_ADAPTER", "sandbox"); vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("IDENTITY_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("IDENTITY_TRUSTED_IP_HEADER", "x-test-source");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const valid = () => ({ name: "UI Customer", email: `${randomUUID()}@example.test`, phone: "12345", password: "full ui passphrase" });
function fill(values: ReturnType<typeof valid>) {
  for (const [name, value] of Object.entries(values)) fireEvent.change(document.getElementById(name)!, { target: { value } });
}
const passwordInput = () => screen.getByLabelText("Password") as HTMLInputElement;
const nameInput = () => screen.getByLabelText("Name") as HTMLInputElement;
describe("registration form with real API/database/worker", () => {
  it("validates locally with accessible errors, Unicode policy, labels and autocomplete", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<RegistrationForm />);
    fill({ ...valid(), password: "😀".repeat(14) });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(fetch).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toContain("correct");
    expect(passwordInput().getAttribute("aria-invalid")).toBe("true"); expect(passwordInput().value).toBe("");
    expect(document.activeElement).toBe(passwordInput());
    expect(nameInput().getAttribute("autocomplete")).toBe("name");
    expect(passwordInput().getAttribute("autocomplete")).toBe("new-password");
  });
  it("guards pending submits, clears password and completes through real backend and sandbox email", async () => {
    const values = valid(); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      await gate;
      return POST(new Request("http://localhost:3000/api/v1/auth/register", { ...init, headers: { ...init.headers, "x-test-source": "192.0.2.1" } }));
    });
    vi.stubGlobal("fetch", fetch); render(<RegistrationForm />); fill(values);
    const form = document.querySelector("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    expect(fetch).toHaveBeenCalledTimes(1); expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(form.getAttribute("aria-busy")).toBe("true"); expect(passwordInput().value).toBe("");
    release();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Registration successful" })).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Registration successful" }));
    expect(screen.getByRole("status").textContent).toContain("check your email");
    const rows = await db.select().from(users).where(eq(users.email, values.email)); expect(rows).toHaveLength(1);
    const worker = composeIdentityWorker(db); await worker.runOnce();
    expect(worker.adapter.sent.find(message => message.to === values.email)?.data.verificationUrl).toContain("http://localhost:3000/verify-email?");
  });
  it("maps actual backend validation fields and preserves non-sensitive values", async () => {
    const values = valid();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string); body.phone = "";
      return POST(new Request("http://localhost:3000/api/v1/auth/register", { ...init, body: JSON.stringify(body) }));
    });
    render(<RegistrationForm />); fill(values); fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Validation failed"));
    expect(screen.getByLabelText("Phone").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Phone"));
    expect(nameInput().value).toBe(values.name); expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(values.email);
    expect(passwordInput().value).toBe("");
  });
  it("recovers after network failure and retains non-sensitive input", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    const values = valid(); render(<RegistrationForm />); fill(values); fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("try again"));
    expect(nameInput().value).toBe(values.name); expect(passwordInput().value).toBe("");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });
});
