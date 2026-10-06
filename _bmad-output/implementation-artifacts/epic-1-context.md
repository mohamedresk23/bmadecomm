# Epic 1 Context: Secure customer account access

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Enable customers to register, prove email ownership, sign in and out, and recover access securely without revealing whether an account exists or granting administrative access. This epic owns account access and transactional identity emails; profile editing, addresses, orders, and staff administration belong to later epics.

## Stories

- Story E01-01: Customer registration with verification email
- Story E01-02: Email verification
- Story E01-03: Customer login and logout
- Story E01-04: Password reset and session revocation

## Requirements & Constraints

Registration requires name, email, phone, and password. Email must be unique after consistent normalization; retries and concurrent requests must not create duplicate users. Invalid inputs receive safe field errors. Existing-email registration has the same public response as successful registration. New accounts are unverified customers with no administrative privileges. An unverified email never proves ownership of a guest order; guest purchasing remains available.

Login uses email and password, blocks inactive accounts, and returns a generic failure for invalid credentials. Logout invalidates the current server session. Password-recovery requests return the same public result for known and unknown email addresses; successful reset invalidates all previous account sessions. Verification and reset links are random, purpose-scoped, time-limited, and single-use; invalid, consumed, or expired proofs fail safely without revealing other accounts.

Passwords require a trusted library and modern secure hashing. Credentials, proof tokens, reset links, and unnecessary personal data must not appear in logs, analytics, client bundles, or client storage. Transactional identity emails are separate from marketing consent. Identity emails must work within this epic rather than waiting for the later notifications epic.

Password limits, proof/session lifetimes, security thresholds, email-provider selection, and retention/residency policies remain approval-dependent. Proposed values include passphrases of 15–128 characters, verification links lasting 24 hours, reset links lasting 30 minutes, and customer sessions lasting seven days; these are assumptions, not approved release policy. Do not silently turn them into final product requirements. Required privacy and security decisions must be resolved before affected production behavior is finalized.

## Technical Decisions

Use a layered modular monolith: one Next.js application and a worker from the same repository/revision, backed by PostgreSQL. HTTP routes and UI adapt module application APIs; application logic must not import Next.js or provider SDKs, and domain logic must not import HTTP or database implementations. A composition root connects ports to infrastructure adapters.

Identity owns credentials, sessions, and grants; notifications owns delivery records. The relevant persistent concepts are users, sessions, proof tokens, notification deliveries, and the durable outbox. Store random session and proof tokens as hashes. Proofs carry purpose, account scope, expiry, and consumption state. Database constraints enforce normalized email uniqueness under concurrency.

Create identity state and its email outbox event in the same transaction, with no provider network call inside that transaction. The worker dispatches through an email adapter, using durable leases, attempt tracking, bounded retry/backoff, and deduplication. Delivery is at least once; handlers must be idempotent. Process-memory timers or request callbacks cannot provide durability. Exhausted delivery failures remain observable and recoverable.

REST JSON endpoints live under `/api/v1`; story routes such as `/auth/register` are operation names within that versioned boundary. Use shared runtime-validated DTO schemas, reject unknown writable fields, and never accept role, actor, or privilege claims from registration input. Errors have exactly `code`, `message`, `details`, and `request_id`, with safe field details and no stack traces. HTTP adapters follow the architecture spine's status conventions.

Every protected request evaluates active session, expiry, account state, permissions, ownership, and allowed DTO fields on the server. Customer and administrative sessions have separate contexts; customer sessions confer no administrative access. Use opaque server sessions, token hashes, Secure/HttpOnly host-only cookies, rotation, and revocation. Validate Origin and provide CSRF protection for cookie-authenticated mutations. Authentication surfaces require shared database-backed rate limiting, body limits, parameterized queries, output encoding, and server-only secrets. Private identity/account and proof responses must not enter shared caches.

IDs are opaque UUID-backed identifiers; instants are stored in UTC and exposed as ISO8601 UTC strings. Verify persistence constraints and transactional rollback on real PostgreSQL, alongside API, form, authorization, proof expiry/reuse, and session-revocation tests. A mock-only pass does not establish database correctness.

## UX & Interaction Patterns

Registration presents the four required fields with explicit labels, field feedback, loading/disabled submission, generic completion feedback, and recoverable errors. Preserve non-sensitive inputs after recoverable failures. Identity flows must support keyboard use, visible focus, perceivable success/error messages, responsive layouts, and the approved language direction; email text must remain readable within RTL layouts. Visual brand identity and market locale are still undecided.

Follow the UX screen inventory by meaning: S-08 registration, S-09 login, S-10 email verification, S-11 reset request, S-12 new password. The story catalog swaps S-09/S-10 for verification/login; resolve this naming conflict by the actual flow when defining routes and tests. Verification and reset pages cover success, invalid, expired, and consumed proofs; expired sessions provide a safe return to sign-in. No account flow automatically claims guest orders.

## Cross-Story Dependencies

The epic depends on shared DTO/validation/error contracts, transactional persistence, durable outbox/email delivery, and session/proof primitives. Registration explicitly depends on F00-03, F00-05, and F00-06. Verification and customer login build on registration; reset and session revocation build on login. Administrative access in the next epic consumes the identity foundation without broadening customer permissions. Later guest-order linking requires both email ownership and order ownership proofs and remains outside this epic.
