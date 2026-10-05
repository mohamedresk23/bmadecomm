---
title: "bmadecomm — P0 Implementation Stories"
status: proposed
created: 2026-10-05
source: ../../epics/epics-bmadecomm-2026-10-05/epics.md
prd: ../../prds/prd-bmadecomm-v2-2026-10-05/prd.md
architecture: ../../architecture/architecture-bmadecomm-2026-10-05/ARCHITECTURE-SPINE.md
scope: "F-00 + Epics 01–20 (P0). P1 Epics 21–28 deliberately not decomposed."
---

# bmadecomm — P0 Implementation Stories

## Conventions

- **ID:** `F00-nn` for enabling foundation, `Enn-nn` for epic stories. Dependencies refer only to earlier story IDs.
- **Layers:** FE = frontend, BE = backend, DB = database (migration). Each story ships its own migration, DTOs, permission checks, audit events and tests — no "security/tests later" stories.
- **Size target:** one AI coding session (≈ one vertical slice, 1–3 endpoints, 1–2 screens, ≤ 1 migration).
- **Definition of Done (applies to every story, not repeated):** server-side validation and authorization (FR-07/58), audit event for state changes (FR-45/AD-15), error envelope per F00-03, unit + integration tests green in CI, a11y/RTL check for any new screen (NFR-08/09), no secrets/PII in logs (NFR-13).
- **🚧 Gate:** story is not ready until the listed OQ/A decision is approved (see epics.md §blocking decisions).
- Seed DB names follow the architecture spine; they are not approved DDL.

---

## F-00 — Enabling Foundation (only what the first slices need)

### F00-01 — Project skeleton, CI and environments
- **Objective:** A buildable, testable repo that every later story extends.
- **Scope:** Install the approved stack and lockfile; FE app shell (RTL, Arabic default); BE app with health endpoint; CI running lint, typecheck, unit and integration tests; env/secrets loading per environment. Out: any business feature, new library choices.
- **Dependencies:** none.
- **Layers:** FE, BE.
- **Acceptance criteria:** clean clone → install → build → test passes locally and in CI; health endpoint returns 200 with build version; secrets never committed (CI secret scan); FE shell renders `dir="rtl"`.
- **Tests:** CI smoke job; health endpoint integration test; secret-scan step.

### F00-02 — DB migrations, transaction context and test DB harness
- **Objective:** Safe, repeatable schema evolution and transactional units of work.
- **Scope:** Migration runner (up/down), transaction context helper, per-test isolated DB, seed fixture helper. Out: business tables.
- **Dependencies:** F00-01.
- **Layers:** BE, DB.
- **Acceptance criteria:** migrations apply/rollback idempotently; failure inside a transaction leaves no partial writes; tests run against isolated DB.
- **Tests:** migration up/down test; transaction rollback test; parallel test isolation check.

### F00-03 — API conventions: DTO, errors, money, time, correlation
- **Objective:** One contract format for all endpoints (FR-58, AD-1).
- **Scope:** Request validation layer, error envelope (code/message/field errors, no internal leak), money type (minor units + currency, no floats), UTC timestamps + store timezone formatting, paging/filter params, request correlation ID in logs and responses.
- **Dependencies:** F00-01.
- **Layers:** FE (API client + error display helper), BE.
- **Acceptance criteria:** invalid payload → 4xx with field errors; unhandled error → generic 5xx with correlation ID only; money round-trips without precision loss; paging params validated with max page size.
- **Tests:** unit tests for money arithmetic/rounding, validation, error mapping; integration test asserting correlation header.

### F00-04 — Authorization hooks and append-only audit
- **Objective:** Primitives for permission/ownership checks and audit trail (FR-07/45, AD-2/15).
- **Scope:** `requirePermission`, `requireOwnership` middleware/hooks (deny by default), field-level redaction helper, `audit_events` append-only table and writer within the business transaction. Out: roles UI (E02).
- **Dependencies:** F00-02, F00-03.
- **Layers:** BE, DB.
- **Acceptance criteria:** endpoint without declared policy fails closed; denied request produces no side effects; audit row written atomically with the change and cannot be updated/deleted by app role.
- **Tests:** unit tests for policy evaluation; integration test that denied mutation leaves DB unchanged; DB-permission test blocking UPDATE/DELETE on audit_events.

### F00-05 — Outbox, worker and email adapter
- **Objective:** Durable side effects decoupled from request transactions (AD-13).
- **Scope:** `outbox` table written in-transaction; worker with retry/backoff, dedupe key, `job_attempts`; email adapter interface with sandbox/dev implementation; `notification_deliveries`. Out: business templates.
- **Dependencies:** F00-02.
- **Layers:** BE, DB.
- **Acceptance criteria:** rolled-back transaction emits nothing; worker crash mid-job → retried, not duplicated (dedupe key); exhausted retries marked failed and visible in DB.
- **Tests:** integration tests for commit/rollback emission, retry, dedupe, failure terminal state.

### F00-06 — Idempotency keys, sessions and proof tokens
- **Objective:** Shared primitives for safe retries and secure tokens (AD-5/9/10).
- **Scope:** `operation_keys` (key + request hash + stored result); session store (httpOnly secure cookie, rotation, revoke-all); `proof_tokens` (hashed, purpose-scoped, single-use, expiry).
- **Dependencies:** F00-02, F00-03.
- **Layers:** BE, DB.
- **Acceptance criteria:** same key + same payload returns stored result; same key + different payload rejected; token stored only as hash, consumed once, expired token generic failure.
- **Tests:** concurrency test (parallel same key → one execution); token single-use/expiry tests.

### F00-07 — Media storage foundation
- **Objective:** Safe upload pipeline reused by logo and product images (FR-56, AD-14).
- **Scope:** Upload endpoint behind permission hook, size/type limits, magic-byte sniffing, re-encode/strip metadata, private→public publishing, `media` metadata table. 🚧 A-11 / OQ-05 limits.
- **Dependencies:** F00-04.
- **Layers:** BE, DB, FE (reusable upload component).
- **Acceptance criteria:** spoofed extension/MIME rejected; oversize rejected; stored file served with safe content-type; unauthorized upload denied.
- **Tests:** integration tests with fake image, oversized file, valid image; component test for upload states.

---

## Epic 01 — Customer account access

### E01-01 — Customer registration with verification email
- **Objective:** A visitor creates an account and receives a verification link.
- **Scope:** S-08 register form, `POST /auth/register`, `users`, verification proof token, outbox email. Generic response for existing email. 🚧 OQ-05/06 password & retention policy.
- **Dependencies:** F00-03, F00-05, F00-06.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** valid data creates unverified customer with customer role only; duplicate email gives same public response as success (no enumeration) and no second user; email enqueued in same transaction; password stored with approved hash.
- **Tests:** API tests (new, duplicate, invalid); assert no admin permission; FE form validation & error state test.

### E01-02 — Email verification
- **Objective:** Customer proves email ownership.
- **Scope:** S-09 verify page (success/expired/invalid), `POST /auth/verify`, resend verification with rate limit.
- **Dependencies:** E01-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** valid token verifies once; reused/expired/forged token → generic failure; resend invalidates previous token; rate limit enforced.
- **Tests:** token reuse/expiry tests; resend rate-limit test; FE state rendering tests.

### E01-03 — Customer login and logout
- **Objective:** Customer signs in and out securely.
- **Scope:** S-10 login, `POST /auth/login`, `/auth/logout`, session cookie, login throttling, session-expired UX.
- **Dependencies:** E01-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** wrong email or password → identical generic error; throttling after N failures; logout invalidates server session; customer session cannot reach admin endpoints (AC-17).
- **Tests:** API tests incl. timing-insensitive generic error; admin endpoint returns 403 with customer session; E2E login → logout.

### E01-04 — Password reset and session revocation
- **Objective:** Customer recovers access; old sessions die.
- **Scope:** S-11/S-12 request + set new password, reset proof token, email via outbox, revoke all sessions on success.
- **Dependencies:** E01-03.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** request response identical whether email exists; token single-use and time-limited; successful reset revokes all existing sessions; new password policy enforced.
- **Tests:** integration test: two active sessions → reset → both rejected; token reuse test; E2E reset flow with sandbox mailbox.

---

## Epic 02 — Admin access & staff permissions

### E02-01 — Admin login and admin shell
- **Objective:** Staff sign in to a separate, protected admin area.
- **Scope:** A-01 login, staff session (stricter expiry), admin nav shell showing only permitted sections, seed first Owner via provisioning script. 🚧 OQ-06/08, A-09 (MFA/recovery method).
- **Dependencies:** E01-03, F00-04.
- **Layers:** FE, BE, DB (`roles`, `permissions`, `user_roles`).
- **Acceptance criteria:** customer credentials cannot open admin; nav hides unpermitted sections and server still enforces; MFA step per approved method.
- **Tests:** API authz tests; FE nav rendering per role; E2E owner login.

### E02-02 — Action and field permission enforcement
- **Objective:** Least-privilege enforcement on every admin request (AD-2).
- **Scope:** Role→permission matrix seed (per OQ-08), per-request permission evaluation (no cached grants beyond request), field redaction in DTOs, reference protected test endpoint.
- **Dependencies:** E02-01.
- **Layers:** BE, DB.
- **Acceptance criteria:** revoking a role blocks the very next request (AC-13); unauthorized request has no side effect; redacted fields absent from response payload, not just hidden in UI.
- **Tests:** integration test revoke-then-request; matrix-driven parametrized authz tests.

### E02-03 — Staff management and last-Owner protection
- **Objective:** Owner creates, disables and grants roles to staff.
- **Scope:** A-14 staff list/create/disable/role grant; disable revokes sessions; last active Owner guard with row lock.
- **Dependencies:** E02-02.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** disabling/demoting the last Owner rejected, including two concurrent attempts on the last two Owners (one must fail); disabled staff session invalid immediately; each change audited with actor.
- **Tests:** concurrency test for last-Owner; API tests for grant/disable; FE form/confirm dialog tests.

### E02-04 — Resource audit panel
- **Objective:** Authorized staff see who changed a resource.
- **Scope:** Reusable audit timeline component + `GET /admin/audit?resource=` filtered by permission and redacted.
- **Dependencies:** E02-02.
- **Layers:** FE, BE.
- **Acceptance criteria:** shows actor/action/time/changed fields; unauthorized user cannot read; redacted fields never exposed.
- **Tests:** API authz + redaction tests; component test.

---

## Epic 03 — Store operational settings

### E03-01 — Store profile, locale and currency lock
- **Objective:** Owner configures store identity and locale.
- **Scope:** A-13 profile section: name, support contacts, logo (F00-07), language, currency, timezone. Currency change blocked once first Order exists (migration path out of scope). 🚧 OQ-01/03.
- **Dependencies:** E02-02, F00-07.
- **Layers:** FE, BE, DB (`settings`).
- **Acceptance criteria:** settings persisted and audited; currency change after an Order exists is rejected with explanation; timezone used for display formatting.
- **Tests:** API tests incl. currency lock with seeded order; FE form test.

### E03-02 — Shipping methods and zones
- **Objective:** Define where and how the store ships (FR-22 eligibility).
- **Scope:** CRUD shipping methods, zones, rates; enable/disable; eligibility query contract `isEligible(address, method)`. 🚧 OQ-01/04.
- **Dependencies:** E03-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** disabled method or ineligible zone rejected by server-side eligibility contract; changes do not alter existing order snapshots.
- **Tests:** unit tests for eligibility matrix; API CRUD + authz tests.

### E03-03 — Payment method enablement
- **Objective:** Enable/disable COD and online payment per policy.
- **Scope:** Payment methods section; server read contract for allowed methods. No provider credentials UI beyond approved config. 🚧 OQ-02/04.
- **Dependencies:** E03-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** disabled method rejected server-side; secrets never returned to FE.
- **Tests:** API tests; response does not contain secrets.

### E03-04 — Versioned financial and operational policies
- **Objective:** Tax, rounding, confirmation and inventory policies versioned so history never changes (AD-4).
- **Scope:** `policy_versions` (tax mode/rate, rounding, reservation TTL, order confirmation mode, low-stock threshold default); new version on edit; `currentPolicy()` contract. 🚧 OQ-03/04.
- **Dependencies:** E03-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** editing creates a new version; previously referenced versions immutable; pending operations keep their version (AC-11/19).
- **Tests:** integration test: snapshot referencing v1 unchanged after v2.

---

## Epic 04 — Sellable catalog management

### E04-01 — Category tree management
- **Objective:** Staff organize categories.
- **Scope:** A-05 category CRUD, parent/child, order, slug uniqueness, cycle prevention.
- **Dependencies:** E02-02.
- **Layers:** FE, BE, DB (`categories`).
- **Acceptance criteria:** cycle (A→B→A) rejected; duplicate slug rejected; delete with children/products blocked or archived per rule.
- **Tests:** unit cycle detection; API tests; FE tree form test.

### E04-02 — Product and variant drafts
- **Objective:** Create products with variants as Drafts.
- **Scope:** A-03/A-04 product form: name, description, price, category links, variant attributes, SKU; Draft by default; no stock editing here.
- **Dependencies:** E04-01, E03-01.
- **Layers:** FE, BE, DB (`products`, `variants`, `variant_attributes`, `product_categories`).
- **Acceptance criteria:** SKU unique; duplicate attribute combination rejected; Draft invisible to public APIs; price stored as money type.
- **Tests:** API tests for uniqueness; public query excludes Draft; FE variant matrix test.

### E04-03 — Product images
- **Objective:** Attach and order images per product/variant.
- **Scope:** Upload via F00-07, reorder, alt text, variant image mapping, remove.
- **Dependencies:** E04-02, F00-07.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** spoofed image rejected (AC-20); alt text required for publish; removing image does not break order history references.
- **Tests:** integration upload tests; FE gallery editor test.

### E04-04 — Publish, slug and SEO metadata
- **Objective:** Safely publish products with stable URLs.
- **Scope:** Publish/unpublish with validation (price, ≥1 variant, image alt), slug edit with `slug_redirects`, meta title/description.
- **Dependencies:** E04-03.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** incomplete product cannot publish; slug change creates redirect; unique slug enforced.
- **Tests:** API publish validation tests; redirect record test.

### E04-05 — Duplicate, archive and delete
- **Objective:** Lifecycle operations without corrupting history (FR-14).
- **Scope:** Duplicate (new Draft, new slug, SKUs cleared), Archive (hidden, history kept), Delete only if never referenced.
- **Dependencies:** E04-04.
- **Layers:** FE, BE.
- **Acceptance criteria:** duplicate is unpublished and has no copied SKU; archive keeps order/category relations; delete of referenced product rejected.
- **Tests:** API tests per operation; FE confirm dialogs.

---

## Epic 05 — Inventory control

### E05-01 — Stock balances, ledger and manual adjustments
- **Objective:** Staff see and adjust stock with a reason (FR-30/32).
- **Scope:** `stock_balances` (OnHand/Reserved/Available derived), `inventory_ledger`, A-06 adjust screen and variant availability panel; reason + actor required. 🚧 OQ-04, A-05.
- **Dependencies:** E04-02.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** every change writes ledger row; balance equals ledger sum; adjustment below zero Available rejected; reason mandatory.
- **Tests:** property test balance==ledger; API tests; FE adjust form test.

### E05-02 — Reserve and release commands
- **Objective:** Atomic reservation primitives for checkout (AC-04).
- **Scope:** Internal `reserve(variant, qty, ref, key)` / `release(ref)` with row locks, idempotent by reference; `inventory_allocations`.
- **Dependencies:** E05-01, F00-06.
- **Layers:** BE, DB.
- **Acceptance criteria:** 100 concurrent reserves on Available=1 → exactly one success, no negative balance; repeated release is no-op.
- **Tests:** concurrency test (100 parallel); idempotency tests.

### E05-03 — Allocate, ship-deduct and restock commands
- **Objective:** Commands later used by fulfillment and returns.
- **Scope:** `allocate(ref)`, `ship(ref)` (decrement OnHand + Reserved once), `restock(ref, qty, condition)` (only sellable condition increases Available).
- **Dependencies:** E05-02.
- **Layers:** BE, DB.
- **Acceptance criteria:** ship twice deducts once; damaged restock does not increase Available; all moves ledgered.
- **Tests:** unit + integration idempotency tests.

### E05-04 — Reservation expiry worker
- **Objective:** Release abandoned reservations safely.
- **Scope:** Worker expiring reservations past policy TTL; guard against race with payment success / order confirmation (state check under lock).
- **Dependencies:** E05-02, E03-04, F00-05.
- **Layers:** BE, DB.
- **Acceptance criteria:** expired reservation released once; concurrent confirm vs expire → exactly one wins, consistent state.
- **Tests:** race test confirm vs expire; worker retry test.

### E05-05 — Low-stock indicator
- **Objective:** Staff see low-stock variants.
- **Scope:** Threshold per variant (default from policy), low-stock badge/list in admin, outbox event `stock.low` for later alerts.
- **Dependencies:** E05-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** crossing threshold emits one event per crossing; list filters correctly.
- **Tests:** API/list tests; event dedupe test.

---

## Epic 06 — Product discovery & variant selection

### E06-01 — Catalog and category listing
- **Objective:** Shoppers browse published products.
- **Scope:** S-02 listing + category page, paging, availability badge, URL-restorable state, empty/error states.
- **Dependencies:** E04-04, E05-01.
- **Layers:** FE, BE.
- **Acceptance criteria:** only Published, non-archived products; page/category restored from URL; responsive & RTL.
- **Tests:** API visibility tests; FE URL-state test; a11y scan.

### E06-02 — Arabic search, filters and sort
- **Objective:** Find products by query, filter and order.
- **Scope:** Arabic-normalized search (per agreed contract), price/category/availability filters, sort (newest, price, best selling via Delivered−Returned contract; empty → stable tie-break). 🚧 search contract (FR-58).
- **Dependencies:** E06-01.
- **Layers:** FE, BE, DB (indexes).
- **Acceptance criteria:** Arabic variants (أ/ا, ة/ه, diacritics) match per contract; filters combine; best selling never invents counts; state in URL.
- **Tests:** search normalization unit tests; API filter/sort tests; FE filter state test.

### E06-03 — Product detail page with variant selection
- **Objective:** Shopper picks a buyable variant.
- **Scope:** S-03 PDP, gallery, variant selector updating SKU/price/image/stock, add-to-cart disabled until valid selection, Buy Now handoff stub to cart contract.
- **Dependencies:** E06-01, E04-03.
- **Layers:** FE, BE.
- **Acceptance criteria:** variant change updates SKU/price/image/stock; no selection → cannot add; out-of-stock variant not addable; Draft PDP → 404.
- **Tests:** FE component tests; API PDP visibility test; E2E select variant.

### E06-04 — SEO, redirects and indexing rules
- **Objective:** Search engines index only public content.
- **Scope:** Meta tags, canonical, sitemap, robots, 301 from old slug, noindex for non-public.
- **Dependencies:** E06-03, E04-04.
- **Layers:** FE, BE.
- **Acceptance criteria:** old slug 301 to new; Draft/archived never in sitemap; canonical present.
- **Tests:** integration tests for sitemap/redirect; HTML meta snapshot test.

---

## Epic 07 — Homepage content publishing

### E07-01 — Homepage sections draft editor
- **Objective:** Staff compose homepage sections.
- **Scope:** A-12 editor for approved section types, product/category references, editorial order; `homepage_drafts`. 🚧 content schema.
- **Dependencies:** E04-04, E02-02.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** only approved section types; references validated; draft autosave audited.
- **Tests:** API validation tests; FE editor test.

### E07-02 — Authorized preview
- **Objective:** Staff preview the draft before publishing.
- **Scope:** Preview route rendering draft with S-01 components, permission-protected, noindex.
- **Dependencies:** E07-01.
- **Layers:** FE, BE.
- **Acceptance criteria:** unauthenticated/customer cannot access preview; preview never cached publicly.
- **Tests:** authz tests; cache header test.

### E07-03 — Publish and public homepage
- **Objective:** Shoppers see a consistent published homepage.
- **Scope:** Publish → immutable `homepage_publications` snapshot, S-01 renders latest publication, unpublished/archived products filtered, cache invalidation.
- **Dependencies:** E07-02, E06-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** draft changes invisible until publish; published page consistent; archived product removed at render; cache refreshed on publish.
- **Tests:** integration test publish/invalidate; E2E homepage.

---

## Epic 08 — Pricing & basic coupons

### E08-01 — Server-side quote engine
- **Objective:** Trustworthy totals (FR-19).
- **Scope:** `quote(lines, address?, method?, coupon?)` → subtotal, discount, shipping, tax, total with line allocations; policy version recorded; TotalsSummary FE component. 🚧 OQ-01/03.
- **Dependencies:** E03-02, E03-04, E04-02.
- **Layers:** FE, BE.
- **Acceptance criteria:** client totals ignored; sum of allocations == total exactly; rounding per policy.
- **Tests:** table-driven unit tests incl. rounding edge cases; component test.

### E08-02 — Coupon admin editor
- **Objective:** Staff create basic coupons.
- **Scope:** A-11 CRUD: code, % or fixed, min subtotal, validity window, eligibility (products/categories), usage limits; `coupons`, `coupon_eligibility`. No Buy X Get Y.
- **Dependencies:** E02-02, E04-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** unique code (case-insensitive); invalid combos rejected; changes audited.
- **Tests:** API validation tests; FE form test.

### E08-03 — Apply coupon in quote
- **Objective:** Shopper sees eligible discount and clear feedback.
- **Scope:** Coupon evaluation in quote engine; reasons (expired, ineligible, min not met, exhausted); discount capped at eligible amount.
- **Dependencies:** E08-01, E08-02.
- **Layers:** FE, BE.
- **Acceptance criteria:** discount never exceeds eligible lines; each failure reason distinct; allocations still sum to total (AC-09).
- **Tests:** unit tests per rule; FE feedback states.

### E08-04 — Atomic coupon usage lifecycle
- **Objective:** Usage limits hold under concurrency (AC-10).
- **Scope:** `coupon_usages` Reserved/Consumed/Released commands, idempotent by order ref; late-paid exception per approved policy. 🚧 OQ-03/04 (AD-4 late paid).
- **Dependencies:** E08-03, F00-06.
- **Layers:** BE, DB.
- **Acceptance criteria:** concurrent attempts on last use → one Reserved; release frees exactly once; consumed not double-counted.
- **Tests:** concurrency test; state transition tests.

---

## Epic 09 — Persistent guest & customer cart

### E09-01 — Guest cart
- **Objective:** Guests keep a cart across visits.
- **Scope:** S-04 cart page, add/update/remove, guest cart token cookie, `carts`, `cart_items`, quantity validation, totals via quote.
- **Dependencies:** E06-03, E08-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** guest reopens browser and sees cart; another guest token cannot read it; cart does not reserve stock.
- **Tests:** API ownership tests; E2E persist cart.

### E09-02 — Customer cart
- **Objective:** Logged-in customers have an account-bound cart.
- **Scope:** Cart owned by user; same UI; ownership enforced.
- **Dependencies:** E09-01, E01-03.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** customer A cannot access customer B's cart; cart available on another device.
- **Tests:** authz tests.

### E09-03 — Merge on login
- **Objective:** Guest selections merge into customer cart on login.
- **Scope:** Merge same variant (sum, cap at available), idempotent merge key, change notice UI.
- **Dependencies:** E09-02.
- **Layers:** FE, BE.
- **Acceptance criteria:** retry of merge does not double quantities; capped quantities explained to user.
- **Tests:** idempotent merge test; FE notice test.

### E09-04 — Revalidation and Buy Now handoff
- **Objective:** Cart shows current price/stock and blocks invalid checkout.
- **Scope:** Reprice/stock check on load; unavailable items kept but flagged; checkout CTA disabled while blocking issues; Buy Now creates single-item checkout context.
- **Dependencies:** E09-03, E05-01.
- **Layers:** FE, BE.
- **Acceptance criteria:** price change visible; unavailable item prevents submission; Buy Now does not wipe existing cart.
- **Tests:** API revalidation tests; E2E Buy Now.

---

## Epic 10 — Checkout & safe COD order creation

### E10-01 — Checkout contact, addresses and shipping method
- **Objective:** Guest or customer enters delivery details and picks an eligible method.
- **Scope:** S-05 steps: contact, shipping/billing address, method list filtered by eligibility; customers can pick saved address. 🚧 OQ-01/04, A-10.
- **Dependencies:** E09-04, E03-02.
- **Layers:** FE, BE.
- **Acceptance criteria:** no account required; ineligible zone/method rejected server-side; address validated.
- **Tests:** API eligibility tests; FE form tests.

### E10-02 — Review quote and price-change acknowledgement
- **Objective:** Shopper confirms final totals.
- **Scope:** Review step with quote ID/hash; if totals changed since review, submission requires re-review.
- **Dependencies:** E10-01, E08-03.
- **Layers:** FE, BE.
- **Acceptance criteria:** changed price → submit rejected with "review again" (AC-09/11).
- **Tests:** integration test with price change between review and submit.

### E10-03 — Atomic COD order submission
- **Objective:** One order, one reservation per submission (AC-02–05).
- **Scope:** `POST /checkout/submit` with idempotency key; single transaction: create `orders`, `order_items`, `order_address_snapshots`, reserve stock (E05-02), reserve coupon (E08-04), outbox `order.created`; status Pending. 🚧 OQ-04 (COD approval, A-02).
- **Dependencies:** E10-02, E05-02, E08-04, F00-06.
- **Layers:** BE, DB.
- **Acceptance criteria:** same key ×10 → one order, one reservation; insufficient stock → no order, no coupon usage; snapshots immutable after settings change.
- **Tests:** concurrency/idempotency test; rollback test; snapshot immutability test.

### E10-04 — Order result page and guest read-only proof
- **Objective:** Shopper sees order outcome; guest gets a safe link.
- **Scope:** S-06 result page; guest proof token (read-only, scoped to one order) emailed via outbox.
- **Dependencies:** E10-03.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** proof shows only its order; wrong/expired token reveals nothing about existence; refresh does not resubmit.
- **Tests:** authz tests; E2E guest COD checkout end-to-end.

---

## Epic 11 — Online payment & reconciliation
🚧 All stories: OQ-02 provider + sandbox, OQ-03/04.

### E11-01 — Payment attempt and redirect/return
- **Objective:** Shopper pays online; return page never trusts redirect.
- **Scope:** Provider adapter (sandbox), `payment_attempts` created inside submit flow, redirect, return page polling server state (pending/failed/unknown).
- **Dependencies:** E10-03, E03-03.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** return URL alone never marks Paid (AC-06); one attempt per order submission key.
- **Tests:** integration with sandbox mock; FE state tests.

### E11-02 — Signed webhook, inbox dedupe and payment reducer
- **Objective:** Correct Paid state from provider events.
- **Scope:** Signature verification, `provider_events` inbox with dedupe, reducer with monotonic state rules, `payment_receipts`, outbox `payment.paid`.
- **Dependencies:** E11-01.
- **Layers:** BE, DB.
- **Acceptance criteria:** invalid signature rejected; duplicate/out-of-order event does not regress Paid; receipt written once.
- **Tests:** replay/out-of-order tests; signature tests.

### E11-03 — Query reconciliation for unknown outcomes
- **Objective:** Recover state after crashes/timeouts without new charge (AC-07).
- **Scope:** `reconciliation_tasks`, worker querying provider for same attempt, backoff, terminal states.
- **Dependencies:** E11-02, F00-05.
- **Layers:** BE, DB.
- **Acceptance criteria:** crash after charge → same attempt reconciled to Paid; never creates second charge.
- **Tests:** fault-injection test (crash after provider success).

### E11-04 — Late paid and refund-task creation
- **Objective:** Handle payment success after reservation expired or order cancelled (AC-08).
- **Scope:** Guards: if stock/coupon no longer held → record receipt, block fulfillment, create durable refund task (no execution), apply approved late-coupon policy.
- **Dependencies:** E11-03, E05-04, E08-04.
- **Layers:** BE, DB.
- **Acceptance criteria:** late paid never silently ships; refund task created once; receipt preserved.
- **Tests:** race tests expire vs paid.

---

## Epic 12 — Admin order management

### E12-01 — Orders list, filters and detail
- **Objective:** Staff find and inspect orders.
- **Scope:** A-07 list (status, payment, date, search), A-08 detail from snapshots, payment attempts panel, field redaction per role.
- **Dependencies:** E10-03, E02-02.
- **Layers:** FE, BE.
- **Acceptance criteria:** details come from snapshots, not live catalog; restricted fields redacted per role.
- **Tests:** API filter/authz tests; FE list test.

### E12-02 — Order history, internal notes and print document
- **Objective:** Traceable history and printable order sheet.
- **Scope:** `order_history` timeline, internal notes (staff only), print view matching snapshots with redaction. Not a tax invoice.
- **Dependencies:** E12-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** notes invisible to customers; print matches snapshot totals (AC-23).
- **Tests:** API tests; print snapshot test.

### E12-03 — Confirm and preparation transitions
- **Objective:** Move orders through Confirmed → Processing → ReadyForShipping.
- **Scope:** Transition commands with expected-version (stale guard), payment preconditions (online must be Paid), confirm dialogs; outbox events. 🚧 OQ-04/08.
- **Dependencies:** E12-01, E11-02.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** stale version → rejected; illegal transition rejected; each change audited.
- **Tests:** state machine unit tests; concurrency stale test.

### E12-04 — Cancellation and cancel-request backend
- **Objective:** Cancel before shipment with correct side effects (AC-14).
- **Scope:** Admin cancel: release stock once, release coupon, create refund task if Paid; reject after Shipped; `cancellation_requests` API for customers (consumed in E15-04).
- **Dependencies:** E12-03, E11-04.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** double cancel releases once; Paid → one refund task; Shipped → rejected; customer request does not cancel by itself.
- **Tests:** idempotency tests; transition tests.

---

## Epic 13 — Shipping, delivery, COD collection, returns receipt
🚧 OQ-02/04/08, A-02/05/07 (manual carrier).

### E13-01 — Ship order with tracking
- **Objective:** Record shipment and deduct stock once.
- **Scope:** Ship action (carrier, tracking no.), `shipment_records`, calls E05-03 ship; online unpaid rejected.
- **Dependencies:** E12-03, E05-03.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** ship twice deducts once; unpaid online rejected.
- **Tests:** idempotency/precondition tests.

### E13-02 — Delivered, failed delivery and retry
- **Objective:** Record delivery outcomes; feed best-selling facts.
- **Scope:** Delivered / DeliveryFailed / retry ship; delivered-units writer for E06-02 contract; failed delivery does not restock.
- **Dependencies:** E13-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** failed delivery leaves stock unchanged; delivered units counted once.
- **Tests:** transition tests; best-selling contract test.

### E13-03 — COD collection and discrepancy
- **Objective:** COD stays Pending until collection is documented (AC-16).
- **Scope:** Record collected amount → `payment_receipts`; discrepancy flagged; permission-gated.
- **Dependencies:** E13-02.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** Delivered COD shows payment Pending until receipt; mismatch flagged, not auto-resolved.
- **Tests:** API tests; authz test.

### E13-04 — Returned shipment receipt and inspection
- **Objective:** Restock only inspected sellable items.
- **Scope:** `return_inspections` per item (sellable/damaged), calls E05-03 restock once; no automatic refund.
- **Dependencies:** E13-02, E05-03.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** inspection idempotent; damaged does not increase Available; no refund created.
- **Tests:** idempotency tests.

---

## Epic 14 — Full & partial refunds
🚧 OQ-02/03/04/06/08.

### E14-01 — Refund budget and authorization
- **Objective:** Never refund more than captured (AC-15).
- **Scope:** A-09 refund form, `refunds`, `refund_allocations`, budget reducer with lock (Requested reserves budget), permission check, refund task in A-08.
- **Dependencies:** E12-04, E13-03, E08-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** captured 100, refunded 30 → 80 rejected; two concurrent 60 → one rejected.
- **Tests:** concurrency test; budget unit tests.

### E14-02 — Provider full/partial refund execution
- **Objective:** Execute online refunds idempotently.
- **Scope:** Adapter refund call with idempotency key, webhook/query to final state, outbox events.
- **Dependencies:** E14-01, E11-02.
- **Layers:** BE, DB.
- **Acceptance criteria:** retry does not double refund; stock untouched.
- **Tests:** sandbox integration; retry test.

### E14-03 — COD payout confirmation
- **Objective:** Record manual refunds for COD orders.
- **Scope:** Staff confirm payout with reference; completes refund.
- **Dependencies:** E14-01.
- **Layers:** FE, BE.
- **Acceptance criteria:** payout confirmed once; audited with actor.
- **Tests:** API tests.

### E14-04 — Unknown refund settlement
- **Objective:** Unknown outcomes keep budget held until resolved.
- **Scope:** Reconciliation task for refund; query provider; definitive failure releases budget.
- **Dependencies:** E14-02, E11-03.
- **Layers:** BE, DB.
- **Acceptance criteria:** unknown keeps cap reserved; definitive failure releases once.
- **Tests:** fault-injection tests.

---

## Epic 15 — Customer self-service & guest tracking
🚧 OQ-05/06, A-09/10.

### E15-01 — Profile and address book
- **Objective:** Customer manages profile and addresses.
- **Scope:** S-13/S-14 profile edit, email change with re-verification, address CRUD.
- **Dependencies:** E01-04.
- **Layers:** FE, BE, DB (`customer_addresses`).
- **Acceptance criteria:** editing address/email does not change existing orders; other customer's address inaccessible.
- **Tests:** authz tests; snapshot immutability test.

### E15-02 — My orders list and detail
- **Objective:** Customer sees own order history.
- **Scope:** S-15/S-16 list + detail with status timeline from snapshots.
- **Dependencies:** E12-02, E15-01.
- **Layers:** FE, BE.
- **Acceptance criteria:** other customer's order → not found; internal notes never shown.
- **Tests:** authz tests; E2E.

### E15-03 — Guest tracking and link reissue
- **Objective:** Guest tracks order with proof.
- **Scope:** S-07 tracking page via proof token; reissue link by email+order number (generic response).
- **Dependencies:** E10-04.
- **Layers:** FE, BE.
- **Acceptance criteria:** wrong/expired link reveals no existence; reissue response generic; read-only.
- **Tests:** enumeration tests.

### E15-04 — Cancel request UI and guest order claim
- **Objective:** Customer requests cancellation; claim guest orders by proof.
- **Scope:** Cancel request button (uses E12-04 API), claim guest order into account only with proof (not by email alone).
- **Dependencies:** E15-02, E15-03, E12-04.
- **Layers:** FE, BE.
- **Acceptance criteria:** request does not cancel order; claim without valid proof rejected.
- **Tests:** API tests; E2E.

---

## Epic 16 — Admin customer profile & support
🚧 OQ-05/08.

### E16-01 — Customer list and profile
- **Objective:** Support finds a customer and sees context.
- **Scope:** A-10 list/filters, profile with contacts, addresses, order history (redacted per role).
- **Dependencies:** E15-01, E12-01.
- **Layers:** FE, BE.
- **Acceptance criteria:** support sees only permitted fields; cannot modify inventory/grants.
- **Tests:** authz/redaction tests.

### E16-02 — Customer notes and spending
- **Objective:** Notes and lifetime spending from financial facts.
- **Scope:** `customer_notes`; spending = receipts − refunds query.
- **Dependencies:** E16-01, E14-01.
- **Layers:** FE, BE, DB.
- **Acceptance criteria:** pending COD not counted; partial refunds subtracted.
- **Tests:** seeded financial query tests.

### E16-03 — Disable customer and support handoff
- **Objective:** Disable abusive accounts safely.
- **Scope:** Disable (revoke sessions), keep financial records; guest support requires independent proof.
- **Dependencies:** E16-01.
- **Layers:** FE, BE.
- **Acceptance criteria:** disabled cannot log in; orders/receipts intact; audited.
- **Tests:** API tests.

---

## Epic 17 — Order lifecycle messages & alerts
🚧 OQ-02/05/06/08, A-11.

### E17-01 — Order and payment emails
- **Objective:** Customers get accurate order/payment emails.
- **Scope:** Templates for order.created (pending wording), payment.paid; subscribers on outbox.
- **Dependencies:** E10-03, E11-02, F00-05.
- **Layers:** BE.
- **Acceptance criteria:** Pending email never says Paid; one email per event.
- **Tests:** template snapshot tests; dedupe test.

### E17-02 — Shipping, delivery, cancel and refund emails
- **Objective:** Lifecycle notifications.
- **Scope:** Templates and subscribers for shipped/delivered/cancelled/refunded.
- **Dependencies:** E17-01, E13-02, E14-02.
- **Layers:** BE.
- **Acceptance criteria:** correct template per event; email failure never rolls back order.
- **Tests:** subscriber tests.

### E17-03 — Delivery list and controlled retry
- **Objective:** Staff see failed deliveries and retry.
- **Scope:** A-15 notification delivery list, retry action (dedupe preserved).
- **Dependencies:** E17-01.
- **Layers:** FE, BE.
- **Acceptance criteria:** retry visible and audited; no duplicate if already delivered (AC-18).
- **Tests:** API tests.

### E17-04 — Staff business alerts
- **Objective:** Team notified of new orders, low stock, payment/refund issues.
- **Scope:** Role-based alert subscriptions on existing outbox events.
- **Dependencies:** E17-01, E05-05.
- **Layers:** BE, FE (minimal settings).
- **Acceptance criteria:** only permitted roles receive alerts; dedupe per event.
- **Tests:** subscriber tests.

---

## Epic 18 — Operational recovery
🚧 OQ-06/08; retry parameters defined per action.

### E18-01 — Exceptions queue
- **Objective:** One view of stuck operations.
- **Scope:** A-15 queue listing unknown payments/refunds, failed jobs, expiry issues with detail.
- **Dependencies:** E11-03, E14-04, E17-03.
- **Layers:** FE, BE.
- **Acceptance criteria:** permission-gated; no secrets displayed.
- **Tests:** authz/redaction tests.

### E18-02 — Safe recovery actions
- **Objective:** Authorized replay without force-success.
- **Scope:** Actions: re-query, retry job; no "mark paid"; actor + reason audited.
- **Dependencies:** E18-01.
- **Layers:** FE, BE.
- **Acceptance criteria:** retry never duplicates money or stock; no force-success endpoint exists.
- **Tests:** idempotency tests.

### E18-03 — Alerting, escalation and runbooks
- **Objective:** Operators know when to act.
- **Scope:** Threshold alerts for aging tasks, runbook docs linked from queue, metrics/logs.
- **Dependencies:** E18-01.
- **Layers:** BE, FE (links).
- **Acceptance criteria:** aged task triggers one alert; runbooks cover each task type.
- **Tests:** alert trigger test.

---

## Epic 19 — Operations & finance dashboard
🚧 OQ-07/08.

### E19-01 — Metric query layer
- **Objective:** Fixed metric definitions from financial facts.
- **Scope:** Queries for sales, orders, AOV, collected vs pending COD, refunds, timezone-aware windows.
- **Dependencies:** E13-03, E14-01.
- **Layers:** BE.
- **Acceptance criteria:** totals match financial seed; pending COD not collected (AC-24).
- **Tests:** seeded golden dataset tests.

### E19-02 — KPI cards and date range
- **Objective:** Owner views KPIs.
- **Scope:** A-02 KPI cards, date picker, store timezone, field permissions.
- **Dependencies:** E19-01.
- **Layers:** FE, BE.
- **Acceptance criteria:** range boundaries respect store timezone; hidden fields per role.
- **Tests:** FE tests; authz tests.

### E19-03 — Sales chart, recent orders, top selling, low stock
- **Objective:** Complete dashboard widgets.
- **Scope:** Chart with accessible table alternative, recent orders, top selling (Delivered−Returned), low stock, empty states.
- **Dependencies:** E19-02, E05-05.
- **Layers:** FE, BE.
- **Acceptance criteria:** chart has data table alternative; empty data handled.
- **Tests:** component + a11y tests.

---

## Epic 20 — Purchase-funnel measurement
🚧 OQ-02 (if provider), OQ-05 consent, OQ-07.

### E20-01 — Consent and event schema
- **Objective:** Collect events only with consent and no PII.
- **Scope:** Consent banner/state, typed event schema, adapter interface.
- **Dependencies:** F00-01.
- **Layers:** FE, BE.
- **Acceptance criteria:** no events before consent; schema rejects PII fields.
- **Tests:** unit schema tests; FE consent tests.

### E20-02 — Funnel events
- **Objective:** Instrument browsing → checkout.
- **Scope:** view_item_list, search, view_item, add_to_cart, begin_checkout etc. per source.
- **Dependencies:** E20-01, E10-01.
- **Layers:** FE.
- **Acceptance criteria:** each event fires once per action; no PII.
- **Tests:** FE event assertion tests.

### E20-03 — Server-side purchase event dedupe
- **Objective:** Purchase counted once from business truth.
- **Scope:** Online purchase on Paid, COD on Confirmed, unique per order via outbox.
- **Dependencies:** E20-01, E11-02, E12-03.
- **Layers:** BE, DB.
- **Acceptance criteria:** refresh/duplicate callback → no second event.
- **Tests:** dedupe tests.

---

## Suggested first vertical path

`F00-01 → F00-02 → F00-03 → F00-04/05/06 → E01-01..04 → E02-01..03 → E03-01..04 → E04-01..04 → E05-01/02 → E06-01/03 → E08-01 → E09-01 → E10-01..04` = first end-to-end guest COD purchase (still behind release gate).

## Not decomposed

P1 Epics 21–28 stay deferred until their launch is requested. Release-gate evidence (load, restore, rollback, sandbox, a11y) is not a story.
