"use client";

import { useEffect, useRef, useState } from "react";
import { registerRequestSchema, type RegisterRequestDto } from "../modules/identity/contracts/registration";
import { ApiClient, ClientApiError } from "../shared/api/client";

const fields = [
  { name: "name", label: "Name", type: "text", autocomplete: "name" },
  { name: "email", label: "Email", type: "email", autocomplete: "email" },
  { name: "phone", label: "Phone", type: "tel", autocomplete: "tel" },
  { name: "password", label: "Password", type: "password", autocomplete: "new-password" },
] as const;

export function RegistrationForm() {
  const [form, setForm] = useState<RegisterRequestDto>({ name: "", email: "", phone: "", password: "" });
  const [pending, setPending] = useState(false);
  const guard = useRef(false);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const completion = useRef<HTMLHeadingElement>(null);
  const focusError = useRef(false);
  useEffect(() => {
    if (success) completion.current?.focus();
    else if (!pending && focusError.current) {
      focusError.current = false;
      const first = fields.find(field => errors[field.name]);
      if (first) document.getElementById(first.name)?.focus();
    }
  }, [errors, pending, success]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (guard.current) return;
    const parsed = registerRequestSchema.safeParse(form);
    setMessage("");
    setErrors({});
    // Never retain a password after a submission, including local validation failure.
    setForm(current => ({ ...current, password: "" }));
    if (!parsed.success) {
      focusError.current = true;
      setErrors(Object.fromEntries(parsed.error.issues.map(issue => [issue.path.join("."), issue.message])));
      setMessage("Please correct the errors in the form.");
      return;
    }
    guard.current = true;
    setPending(true);
    try {
      await ApiClient.fetch("/api/v1/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      setSuccess(true);
    } catch (error) {
      focusError.current = true;
      setErrors(ApiClient.mapFieldErrors(error));
      setMessage(error instanceof ClientApiError ? error.message : "Registration failed. Please try again.");
    } finally { guard.current = false; setPending(false); }
  }

  if (success) return <div role="status" className="p-6 rounded-md bg-green-50 text-green-900">
    <h1 ref={completion} tabIndex={-1} className="text-xl font-semibold">Registration successful</h1>
    <p>Please check your email for the verification link.</p>
  </div>;

  return <form onSubmit={submit} noValidate aria-busy={pending} className="max-w-md mx-auto p-6 space-y-4 bg-white shadow-md rounded-md">
    <h1 className="text-2xl font-bold">Create an Account</h1>
    {message && <p role="alert" className="text-red-900">{message}</p>}
    {fields.map(field => <div key={field.name}>
      <label htmlFor={field.name} className="block text-sm font-medium mb-1">{field.label}</label>
      <input id={field.name} name={field.name} type={field.type} autoComplete={field.autocomplete}
        value={form[field.name]} required disabled={pending} aria-invalid={!!errors[field.name]}
        aria-describedby={errors[field.name] ? `${field.name}-error` : field.name === "password" ? "password-policy" : undefined}
        onChange={event => { setForm(current => ({ ...current, [field.name]: event.target.value })); setErrors(current => ({ ...current, [field.name]: "" })); }}
        className="w-full px-3 py-2 border rounded-md focus-visible:outline-2 focus-visible:outline-blue-600" />
      {errors[field.name] && <p id={`${field.name}-error`} className="text-red-700">{errors[field.name]}</p>}
    </div>)}
    <p id="password-policy" className="text-sm">Use 15–128 characters. Spaces and Unicode are welcome; no composition rules apply.</p>
    <p role="status" aria-live="polite">{pending ? "Registering…" : ""}</p>
    <button type="submit" disabled={pending} className="w-full py-2 px-4 bg-blue-600 text-white rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">
      {pending ? "Registering…" : "Register"}
    </button>
  </form>;
}
