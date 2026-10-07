// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { VerificationForm } from "./VerificationForm";
import { POST } from "../app/api/v1/auth/verify/route";
import { db } from "../db";
import { users, proofTokens } from "../db/schema";
import { issueVerificationProof } from "../modules/identity/infrastructure/proofs";
import { setupTestDb } from "../test-utils/db";

let sourceIndex = 0;
beforeAll(setupTestDb);
beforeEach(() => {
  vi.stubEnv("EMAIL_ADAPTER", "sandbox"); vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("IDENTITY_TOKEN_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("IDENTITY_TRUSTED_IP_HEADER", "x-test-source");
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); window.history.replaceState(null, "", "/"); });
async function fixture() {
  const userId = randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, name: "UI test", phone: "123", passwordHash: "unused" });
  const { token, proofId } = await issueVerificationProof(db, userId);
  return { userId, token, proofId };
}
function open(input: { userId: string; token: string }) {
  window.history.replaceState(null, "", `/verify-email#user=${input.userId}&token=${input.token}`);
}
function bridge() {
  const source = `2001:db8::${(++sourceIndex).toString(16)}`;
  return async (url: string, init: RequestInit) => {
    if (url !== "/api/v1/auth/verify" || init.method !== "POST") throw new Error("Unexpected verification endpoint");
    return POST(new Request(`http://localhost:3000${url}`, { ...init, headers: { ...init.headers, "x-test-source": source } }));
  };
}
async function unchanged(input: Awaited<ReturnType<typeof fixture>>) {
  expect((await db.select().from(users).where(eq(users.id, input.userId)))[0].verifiedAt).toBeNull();
  expect((await db.select().from(proofTokens).where(eq(proofTokens.id, input.proofId)))[0].consumedAt).toBeNull();
}
async function activated(input: Awaited<ReturnType<typeof fixture>>) {
  const [user] = await db.select().from(users).where(eq(users.id, input.userId));
  const [proof] = await db.select().from(proofTokens).where(eq(proofTokens.id, input.proofId));
  expect(user.verifiedAt).not.toBeNull(); expect(user.verifiedAt).toEqual(proof.consumedAt);
}
it("requires deliberate confirmation and completes via actual POST/database in StrictMode", async () => {
  const input = await fixture(); open(input);
  const send = vi.fn(bridge()); vi.stubGlobal("fetch", send);
  render(<StrictMode><VerificationForm /></StrictMode>);
  expect(window.location.hash).toBe(""); expect(send).not.toHaveBeenCalled(); await unchanged(input);
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Email verified" })).toBeDefined());
  expect(send).toHaveBeenCalledTimes(1); await activated(input);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Email verified" })));
});
it.each(["network", "500", "429"])("retains proof and recovers after %s failure with accessible feedback", async failure => {
  const input = await fixture(); open(input);
  const send = vi.fn().mockImplementationOnce(async () => {
    if (failure === "network") throw new Error("Synthetic network failure");
    return Response.json({ error: { code: "SAFE_ERROR", message: "Safe error" } }, { status: Number(failure) });
  }).mockImplementation(bridge());
  vi.stubGlobal("fetch", send); render(<VerificationForm />); fireEvent.submit(document.querySelector("form")!);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("try again later"));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading")));
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false); await unchanged(input);
  fireEvent.submit(document.querySelector("form")!);
  await waitFor(() => expect(screen.getByRole("heading", { name: "Email verified" })).toBeDefined());
  expect(send).toHaveBeenCalledTimes(2); await activated(input);
  expect(send.mock.calls[0][1].body === send.mock.calls[1][1].body).toBe(true);
});
it("guards pending duplicate submissions", async () => {
  const input = await fixture(); open(input); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const actual = bridge();
  const send = vi.fn(async (url: string, init: RequestInit) => { await gate; return actual(url, init); });
  vi.stubGlobal("fetch", send); render(<VerificationForm />);
  const form = document.querySelector("form")!; fireEvent.submit(form); fireEvent.submit(form);
  expect(send).toHaveBeenCalledTimes(1); expect(form.getAttribute("aria-busy")).toBe("true");
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("Verifying");
  release(); await waitFor(() => expect(screen.getByRole("heading", { name: "Email verified" })).toBeDefined()); await activated(input);
});
it("aborts a stalled request at twenty seconds, restores retry and retains the proof", async () => {
  const input = await fixture(); open(input); let signal!: AbortSignal;
  const send = vi.fn().mockImplementationOnce((_url: string, init: RequestInit) => { signal = init.signal!; return new Promise(() => {}); }).mockImplementation(bridge());
  vi.stubGlobal("fetch", send); vi.useFakeTimers(); render(<VerificationForm />); fireEvent.submit(document.querySelector("form")!);
  await act(async () => { await vi.advanceTimersByTimeAsync(19999); }); expect(signal.aborted).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(signal.aborted).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("try again later");
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  vi.useRealTimers(); await unchanged(input); fireEvent.submit(document.querySelector("form")!);
  await waitFor(() => expect(screen.getByRole("heading", { name: "Email verified" })).toBeDefined()); await activated(input);
});
it("aborts on unmount and instructs a remounted form to reopen its original email link", async () => {
  const input = await fixture(); open(input); let signal!: AbortSignal;
  const send = vi.fn((_url: string, init: RequestInit) => { signal = init.signal!; return new Promise(() => {}); });
  vi.stubGlobal("fetch", send); const view = render(<VerificationForm />);
  fireEvent.submit(document.querySelector("form")!); view.unmount(); expect(signal.aborted).toBe(true); render(<VerificationForm />);
  expect(screen.getByRole("alert").textContent).toContain("Reopen the original email link");
  expect(screen.queryByRole("button")).toBeNull(); expect(send).toHaveBeenCalledTimes(1); await unchanged(input);
});
it("shows generic rejection and reopen guidance for used and expired links", async () => {
  vi.stubGlobal("fetch", vi.fn(bridge()));
  for (const expired of [false, true]) {
    const input = await fixture();
    if (expired) await db.update(proofTokens).set({ expiresAt: new Date(0) }).where(eq(proofTokens.id, input.proofId));
    else await POST(new Request("http://localhost:3000/api/v1/auth/verify", { method: "POST", headers: { "Content-Type": "application/json", "x-test-source": `2001:db8::${(++sourceIndex).toString(16)}` }, body: JSON.stringify({ userId: input.userId, token: input.token }) }));
    open(input); render(<VerificationForm />); fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Verification link is invalid or expired."));
    expect(screen.getByRole("alert").textContent).toContain("Reopen the original email link");
    expect(screen.queryByRole("button")).toBeNull(); if (expired) await unchanged(input); cleanup();
  }
});
