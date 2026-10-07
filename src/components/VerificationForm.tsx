"use client";

import { useEffect, useRef, useState } from "react";
import { verifyRequestSchema, INVALID_VERIFICATION, type VerifyRequestDto } from "../modules/identity/contracts/verification";
import { ApiClient, ClientApiError } from "../shared/api/client";

export function VerificationForm() {
  const proof = useRef<VerifyRequestDto | null>(null);
  const guard = useRef(false);
  const initialized = useRef(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const status = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "pending" | "success" | "invalid" | "error">("loading");
  const [message, setMessage] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    // Remove the bearer secret from the address bar before any request.
    window.history.replaceState(null, "", window.location.pathname);
    const parsed = verifyRequestSchema.safeParse({ userId: fragment.get("user"), token: fragment.get("token") });
    proof.current = parsed.success ? parsed.data : null;
    setState(parsed.success ? "ready" : "invalid");
  }, []);
  useEffect(() => {
    if (["success", "invalid", "error"].includes(state)) status.current?.focus();
  }, [state]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (guard.current || !proof.current) return;
    guard.current = true;
    setState("pending");
    const controller = new AbortController();
    request.current = controller;
    let timer!: ReturnType<typeof setTimeout>;
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("Verification request interrupted")), { once: true });
      timer = setTimeout(() => controller.abort(), 20000);
    });
    try {
      await Promise.race([ApiClient.fetch("/api/v1/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(proof.current), signal: controller.signal }), aborted]);
      if (!mounted.current) return;
      proof.current = null;
      setState("success");
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ClientApiError && error.status === 400) {
        proof.current = null;
        setState("invalid");
      } else {
        setMessage("Verification could not complete. Please try again later.");
        setState("error");
      }
    } finally { clearTimeout(timer); request.current = null; guard.current = false; }
  }
  return <form onSubmit={submit} aria-busy={state === "pending"} className="max-w-md mx-auto p-6 space-y-4 bg-white shadow-md rounded-md">
    <h1 ref={status} tabIndex={-1} className="text-2xl font-bold">{state === "success" ? "Email verified" : "Verify your email"}</h1>
    {state === "success" ? <p role="status">Your account email is verified.</p>
      : state === "invalid" ? <p role="alert">{INVALID_VERIFICATION} Reopen the original email link to try again.</p>
      : <><p>Confirm to verify your account email.</p>
        {state === "error" && <p role="alert">{message}</p>}
        <p role="status">{state === "pending" ? "Verifying…" : ""}</p>
        <button type="submit" disabled={state === "loading" || state === "pending"} className="py-2 px-4 bg-blue-600 text-white rounded-md disabled:opacity-50">Verify email</button></>}
  </form>;
}
