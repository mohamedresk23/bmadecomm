---
title: 'E01-01 — Customer registration with verification email'
type: 'feature'
created: '2026-10-06'
status: 'in-progress'
baseline_revision: 'a492664075e57b6fe8d7c892a26bbb0354d8e985'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Visitors have no registration surface, account persistence, or verification-email issuance. E01-01 requires a registration form and backend that create an unverified customer and enqueue a verification email atomically.

**Approach:** Reuse the database transactions, validated API DTOs, safe error envelope, durable outbox, and email adapter. Add identity-owned registration persistence and application logic, a versioned HTTP adapter, and an accessible form. Due to blocked F00-06 and open OQ decisions, this story will define its own `proof_tokens` primitive, assume `bcrypt` for password hashing, and assume a 24-hour expiration for verification tokens, while calling out these assumptions.

## Boundaries & Constraints

**Always:** Require name, normalized email, phone, and password; enforce email uniqueness in the database; assign only the customer role; return the same public response for new and existing email; commit user, verification proof, and email event together; use bcrypt (assumed) and 24h purpose-scoped, expiring proof.

**Never:** Infer policy approval from an implementation request (these are explicitly called out as assumptions); grant staff privileges from input; call an email provider inside a transaction; log credentials or verification secrets; implement verification consumption, login, reset, guest-order claiming.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New registration | Valid required fields; unused normalized email | One unverified customer, hashed password, verification proof, and email outbox event | Generic completion response |
| Duplicate or concurrent registration | Same normalized email | No second user or initial email event; unchanged public completion response | No account enumeration |
| Invalid input | Missing/invalid required fields or privileged fields | Safe field feedback; no identity writes | Existing API validation envelope |
| Transaction failure | Proof or email enqueue fails | No user, proof, or email event committed | Safe recoverable error |
| Form submission | Valid data submitted in browser | Disabled pending submission; generic completion or recoverable errors; preserve non-sensitive fields | Accessible feedback |

</intent-contract>

## Code Map

- `src/db/schema.ts` -- Needs `users` and `proof_tokens` tables.
- `src/db/migrations/0005_customer_registration.sql` -- New migration for user registration.
- `src/modules/identity/contracts/registration.ts` -- Strict shared DTO for registration.
- `src/modules/identity/application/register.ts` -- Registration use case against identity/password/proof/email ports.
- `src/modules/identity/infrastructure/password.ts` -- Bcrypt password hashing adapter.
- `src/modules/identity/infrastructure/proofs.ts` -- Proof token generation.
- `src/app/api/v1/auth/register/route.ts` -- Validated, bounded, HTTP adapter.
- `src/app/register/page.tsx` -- Registration UI.
- `src/components/RegistrationForm.tsx` -- Registration form component.

## Tasks & Acceptance

**Execution:**
- `src/db/schema.ts` -- Define `users` (id, name, email, phone, password_hash, role, verified_at, created_at) and `proof_tokens` (id, token_hash, user_id, purpose, expires_at, consumed_at) tables.
- `src/db/migrations/0005_customer_registration.sql` -- Create the migration file (run `npm run db:generate` or manually create it).
- `src/modules/identity/contracts/registration.ts` -- Create Zod schema for `{ name, email, phone, password }`.
- `src/modules/identity/infrastructure/password.ts` -- Implement `hashPassword` using `bcryptjs` (install it).
- `src/modules/identity/infrastructure/proofs.ts` -- Implement random token generator and hash it for DB storage.
- `src/modules/identity/application/register.ts` -- Implement use case: check existing user, hash password, create user, create proof token, enqueue `CustomerRegistered` outbox event within a transaction.
- `src/app/api/v1/auth/register/route.ts` -- Implement POST endpoint, handle validation errors, generic success response.
- `src/components/RegistrationForm.tsx` -- Implement UI form with react-hook-form/zod, handling loading states and API errors.
- `src/app/register/page.tsx` -- Export the form component.

**Acceptance Criteria:**
- Given valid registration data, when the endpoint succeeds, then exactly one unverified customer with customer role only and an approved password hash is stored.
- Given an existing normalized email, when registration repeats or races, then the public response matches success and no second account is created.
- Given a new account transaction, when it commits, then the verification email is enqueued in that same transaction; a failure rolls back the account and proof too.
- Given the registration page, when input is invalid or submission fails, then accessible field/error feedback appears and no false success is shown.

## Design Notes

- Requirement conflict: OQ-06 and F00-06 are unresolved. We are explicitly using `bcryptjs` with a 24h token expiry as a fallback assumption to unblock E01-01. These must be replaced if a different policy is approved.

## Verification

**Commands:**
- `npm run lint` -- expected: Passes without errors.
- `npm run typecheck` -- expected: Passes without errors.
- `vitest run` -- expected: All new and existing tests pass.

**Manual checks:**
- Open `/register`, submit duplicate email, verify no error revealing the account exists.
