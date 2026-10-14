# E04-02 walkthrough evidence report

Date: 2026-10-14. Reviewed commit: `a4e592d763130ca672a45d5a0bdd63da8c3ee4e5`.
Spec baseline: `ae6b77ea6d08499d6aa61d997f93ba10d3702aa0` (26 changed files, +1644/-21).
Workflow: project `bmad-walkthrough`. This report is a technical recommendation, not the user's acceptance, approval, or release decision.

## Recommendation

Current recommendation: **VERIFICATION INCOMPLETE**. Actual browser/HTTP/application-PostgreSQL creation, editing, validation rejection, CSRF denial, public isolation and assigned-category deletion evidence is recorded below. Only scenario 4c (authenticated staff without catalog permissions) remains unexecuted. A fresh read-only account inventory found one staff account and only the owner role, with no independent restricted staff account. No new application defect has been established. TOTP replay-test flakiness remains open as separate work. This recommendation is not owner acceptance.

## Evidence boundaries and database safety

- Source reviewed at the requested HEAD; the working tree was clean before this report. No application code, commit, application data or migration was changed during this walkthrough.
- Read-only connection configuration identifies the current local application target as `127.0.0.1:5432/bmadecomm_dev`. No credentials are reproduced here.
- Read-only schema/journal probe found `public.categories`, `public.products` and `public.product_categories`; pending migration tags were `[]`.
- The commit's final report correctly describes its earlier state: application migrations were not applied during implementation. They were subsequently applied with approval in the preceding category-CSRF troubleshooting session. Current state therefore differs from the commit-era report and the request's assumption. No migration is needed or authorized by this review.
- The existence/journal probe is not a complete constraint or row integrity audit of the live schema, nor proof that a currently running server uses an unchanged environment. That linkage remains part of the live observation.
- Automated outcomes below are **historical results recorded in the committed specification**, not newly executed results. Tests and builds were not rerun in this walkthrough. Reading assertions establishes coverage intent; it does not independently reproduce the recorded outcome.
- UI integration uses jsdom, a stubbed fetch transport calling real route handlers directly, generated staff sessions and migrated PGlite. It crosses component/service/database logic but does not exercise browser cookies, HTTPS attributes, Next HTTP routing or a real login.
- Historical real PostgreSQL evidence exercises four concurrency scenarios in a generated isolated schema. It does not establish a browser flow against the application schema.

## Scenario 4c follow-up preflight — 2026-10-14

Read-only inventory on the guarded local target found `restrictedAccounts: []`, `totalStaffAccounts: 1`, and role keys `[owner]`. No suitable independently enrolled restricted account exists. No account, role or session was created or modified during this follow-up.

The application has no implemented general staff invitation/provisioning endpoint or UI. `scripts/provision-owner.ts:24` provisions only the first Owner and must not be reused to provision another staff identity. The available project-supported **verification fixture pattern**, not a production staff onboarding workflow, is `scripts/verify-local-staff-access.ts:143`: create a separate user with the existing Argon2id helper, encrypt a new MFA seed with the existing account/purpose-bound helper, and assign a role. The existing script does this in an isolated schema and assigns owner; it cannot be run unchanged for this request.

Proposed adaptation, pending explicit user approval before creation: a temporary local-only verification script against the verified application's database, generating one uniquely marked staff user with a random password and MFA seed; add role key `support` if absent, one users row, one enabled/enrolled staff_accounts row and one user_roles association to support only, atomically. This seeds an enrolled **test fixture** directly; it is not evidence of a real onboarding flow. Subsequent authentication must use the real browser password/TOTP flow, with no injected/DB-created session. No owner row/role, store setting, migration or application code would change. Credentials must remain in memory or a restricted ignored local file, never printed. Retain the test account and resulting real authentication/audit records unless separately authorized otherwise.

Then verify real session GET 200 with support only; get the session-bound CSRF from that own-session endpoint, independently validate the proposed POST/PUT bodies against existing product contracts, use current authoritative pricing revision and exact Origin, and request POST/PUT through HTTP. Expected denial: 403 FORBIDDEN / Insufficient permissions for this operation. The existing authorization helper checks roles before CSRF, so correct CSRF/Origin must be verified independently rather than inferred from the denial response.

Before/after comparisons must include product count/new unique marker absence, complete target draft/variants/attributes/category links, and all product.created/product.updated audit rows. Record any other audit additions separately. The current catalog role-denial helper itself does not write an access-denied audit; authentication events are distinct and should not be mistaken for product modifications. Until this scenario is executed, the recommendation remains verification incomplete. TOTP remains open; no story acceptance is implied.

## Walkthrough stops

1. **Draft entry and recovery** — `src/app/admin/catalog/products/page.tsx:5`; `src/app/admin/catalog/products/product-manager.tsx:169`; `src/app/admin/catalog/products/product-manager.test.tsx:42`. Protected Arabic form, exact decimal input, state preservation and save/edit/remount.
2. **Mutation contract and authorization** — `src/app/api/v1/admin/catalog/products/route.ts:27`; `src/app/api/v1/admin/catalog/products/[id]/route.ts:28`; `src/modules/content/settings/infrastructure/admin-auth.ts:58`. Session/role checks and mutation CSRF precede persistence; bounded JSON and pricing revision are required; create supports actor-scoped idempotency.
3. **Atomic persistence and money** — `src/modules/catalog/products/application/product-service.ts:65`; `src/modules/catalog/products/contracts/product.ts:1`; `src/db/migrations/0014_product_drafts.sql:1`. Draft-only updates, locked settings/categories, integer-string contracts, bigint storage, uniqueness/FKs and transactional audits.
4. **Private drafts and protected associations** — `src/modules/catalog/products/application/product-service.ts:10`; `src/app/api/v1/store/products/route.ts:6`; `src/app/api/v1/store/products/[id]/route.ts:6`; `src/modules/catalog/products/application/product-service.test.ts:12`. Published-only SQL selection, draft ID 404 and assigned-category deletion conflict.

## Acceptance criteria traceability

IDs below follow the seven criteria in `spec-e04-02.md:75`, in order. The original table preserves historical coverage; its missing-observation statements are superseded by the current-status table below and the actual-verification section.

| Criterion | Current actual verification status |
|---|---|
| AC1 | Browser create/refresh and HTTP 201; application DB values and creation audit verified. |
| AC2 | Browser edit/refresh and HTTP 200; retained IDs, Draft and update audit verified. |
| AC3 | Duplicate SKU and invalid comparison price rejected in the browser with preserved inputs; equivalent combinations rejected via real browser HTTP. Scoped DB/audit unchanged. Equivalent-combination UI injection was not observed. |
| AC4 | Exact 0.29/19.99 decimals and 29/1999 stored minor units verified; current currency/scale captured. Global currency-change observation excluded by instruction. |
| AC5 | Anonymous HTTP list excludes the draft; direct ID returns 404 without checked identifiers/SKUs leaking. |
| AC6 | Invalid input, missing/invalid CSRF and anonymous mutation denied with unchanged scoped business/audit snapshots. Authenticated unrelated-role POST/PUT remains missing. |
| AC7 | Browser category deletion yields HTTP 409; category and association remain. |

| Criterion | Implementation and automated evidence | Assessment / missing actual observation |
|---|---|---|
| AC1: Authorized matrix save/reload persists name, description, categories, attributes, SKU and money as Draft, with audit and success | UI integration `src/app/admin/catalog/products/product-manager.test.tsx:42` checks a two-row matrix, exact values, success, category selection, remount and audit. Service `src/modules/catalog/products/application/product-service.test.ts:12`; route `src/app/api/v1/admin/catalog/products/route.test.ts:19`. | Supported. Browser save, refresh and live PostgreSQL row/audit correlation not observed. |
| AC2: Complete edit is atomic/audited without lifecycle change | Service save transaction `src/modules/catalog/products/application/product-service.ts:65`; retained IDs/SKU swap and Draft assertion in service test `:12`; audit-failure rollback test `:64`; UI edit/remount `src/app/admin/catalog/products/product-manager.test.tsx:42`. | Supported. Real HTTP edit and independent live DB before/after comparison missing. |
| AC3: Duplicate SKU/equivalent combinations produce field errors and preserve existing state | Normalization and canonical combination contract; global/per-product unique indexes. Route `src/app/api/v1/admin/catalog/products/route.test.ts:59`; service collision-after-preflight rollback `src/modules/catalog/products/application/product-service.test.ts:89`; UI conflict/retry `src/app/admin/catalog/products/product-manager.test.tsx:74`. | Supported. Equivalent-combination error coverage is API-level; actual browser conflict display and unchanged live audit/business state missing. |
| AC4: Store currency/exponent, integer minor units, persisted currency/scale and string DTO amounts | Bigint storage, SQL casts to text and text decimal conversion. Service tests `src/modules/catalog/products/application/product-service.test.ts:12`, `:103`, `:111`; currency review UI tests `src/app/admin/catalog/products/product-manager.test.tsx:153`, `:167`, `:193`. | Supported, including values beyond JS safe integers. Actual browser/API/DB price comparison and currency-review experience missing. |
| AC5: Public list/direct ID return neither draft nor its variants | SQL status filter in `src/modules/catalog/products/application/product-service.ts:10`; route test `src/app/api/v1/admin/catalog/products/route.test.ts:19` verifies absent draft, ID 404, no leaked SKU and a positive published fixture. UI integration repeats draft isolation. | Supported. Real unauthenticated HTTP list/detail against a newly created application draft not observed. |
| AC6: Invalid/unauthorized mutations cause no partial business/audit changes | Route negatives `src/app/api/v1/admin/catalog/products/route.test.ts:49`, `:73`, `:108`, `:121`; service unchanged-state test `src/modules/catalog/products/application/product-service.test.ts:49` and audit-failure rollback `:64`. Includes role, missing/expired/revoked/disabled session, Origin and CSRF cases. | Supported with a coverage limit: route authorization test asserts no product rows, but does not explicitly assert unchanged audit counts for every denial. Actual HTTP security negatives and corresponding live state checks missing. |
| AC7: Assigned-category deletion clearly conflicts and preserves association | Category deletion locks/checks assignments; service test `src/modules/catalog/products/application/product-service.test.ts:12`; API DELETE 409 in `src/app/api/v1/admin/catalog/products/route.test.ts:19`; historical independent PostgreSQL association/deletion races. | Supported. Category UI conflict and preserved association after an actual deletion attempt missing. |

## Recorded verification and TOTP qualification

Authoritative historical source: `spec-e04-02.md:130` (final evidence explicitly supersedes earlier notes).

- Typecheck and production build passed. Lint reported zero new errors, with the existing Upload image warning.
- A complete post-review suite recorded 382 passes. After the last POST-validation change, the complete suite recorded **381 passes and one TOTP test failure**. One existing skip and one todo remain.
- The unchanged staff-auth file subsequently recorded 20 isolated passes. Final product route/UI rerun recorded 18 passes.
- The concurrency script recorded four real PostgreSQL groups passing and removal of its generated schema.

`src/modules/identity/infrastructure/staff-auth.test.ts:21` generates OTP from the current 30-second step; the replay flow at `:37` regenerates it. If the step advances, the later assertion may submit a new valid OTP instead of replaying the original. This explains a plausible false failure and is recorded in `deferred-work.md`; it does **not** prove an authentication bypass. The isolated rerun does not remove the timing dependence. Consequently, the final exact code does not have a uniformly green full-suite run recorded. Stabilizing the replay assertion belongs to separate authentication-test work; no auth code was changed here.

## Findings, limits and outstanding evidence (initial review; current disposition below)

Current disposition: the browser-flow gap is closed for the recorded executable scenarios. Scoped draft business/audit rollback checks have actual evidence; authenticated unrelated-role denial remains open. Earlier historical-documentation inconsistencies and accepted design limits remain recorded. TOTP reproducibility remains open. The original findings below are retained as review history, not a claim that completed browser observations are still missing.

- **Acceptance evidence gap:** browser-to-HTTP-to-application-PostgreSQL create/edit flow remains unobserved. PGlite integration and isolated PostgreSQL concurrency cannot substitute for it, particularly after the category CSRF incident.
- **Test reproducibility issue:** existing TOTP flake qualifies full-suite confidence; do not summarize the final suite as simply “all passed.”
- **Coverage gap:** strengthen or explicitly observe unchanged audit/business state on each authorization rejection; existing coverage combines route no-product assertions with separate service rollback/audit assertions.
- **Historical documentation inconsistency:** earlier notes say 128 KiB, no external PostgreSQL run and no commit. Final notes/code establish 256 KiB and isolated PostgreSQL verification; the supplied commit proves the work was committed. Treat earlier notes as history, not current operational facts.
- **Accepted design limits:** concurrent draft editors use serialized last-writer-wins; there is no product version conflict contract. New/Edit replacement and destructive matrix regeneration prompt, but page navigation/unload lacks a dirty guard. Lists remain unbounded. These are recorded scope decisions, not newly discovered violations of the seven criteria.

## Optional actual observation trail

Before any run, confirm the running server's DB configuration matches the verified target. If a different target requires migrations, stop and present that target, the exact command and its pending DDL/data effects for explicit approval. No such command was executed in this review.

1. Sign in through the real staff login and open `/admin/catalog/products`. Create a two-row matrix with unique SKUs, `0.29` and `19.99`, comparison price and an existing category. Expect loading/save feedback, success and Draft after browser refresh. Compare returned IDs with live product, variant, attribute, category-link and audit rows without displaying credentials.
2. Edit name, description, categories and a price; save and refresh. Expect retained matching variant IDs, complete new values, Draft and one additional update audit. Regenerate a populated matrix and cancel deletion; expect preserved inputs.
3. Save a normalized duplicate SKU and an invalid comparison price. Expect visible field errors, retained inputs, and no additional product change/audit. Observe missing/invalid CSRF and unrelated-role mutation denial through real HTTP separately.
4. Request public list and direct draft ID without staff authentication. Expect draft absence and 404, with no variant leakage. Attempt deletion of its assigned category in the admin UI; expect conflict and unchanged link.
5. If worth observing, exercise expired-session recovery and lost-create-response retry in an isolated verification environment; expect preserved inputs and a single committed creation/audit. Currency changes affect store-wide settings, so do not use existing application settings casually for this observation.

No actual observation above is marked executed. The user retains the final approve/rework/discuss decision. This report does not change story status or authorize shipping.

## Actual local verification — 2026-10-14 (new evidence)

This section supersedes the earlier missing-browser statements for the scenarios executed below. Historical test outcomes above remain historical. Final recommendation: **VERIFICATION INCOMPLETE**, solely because authenticated unrelated-role denial has not been observed. The user confirmed no suitable independent account is available and explicitly requested recording the gap. No new application defect was established by these observations; this is not owner acceptance.

### Preflight and real authentication

- Running Next server PID 56308 listens at `127.0.0.1:3000`, with parent process pointing into this workspace's Next installation. Its PostgreSQL connections had local client ports 54216, 56285, 58124 and 58372, all connected to `127.0.0.1:5432`. A read-only `pg_stat_activity` query matched those exact client ports to `bmadecomm_dev`. This verifies the running server target, rather than relying only on the environment file.
- Read-only migration journal check: pending tags `[]`; categories/products/product_categories exist. No migration was run. No global currency setting was changed.
- The already-open browser had no remote-debugging connection. A separate headless installed Edge browser authenticated through the real `/admin/login` password form and real TOTP challenge using the existing private local development-owner credentials internally. No session injection, direct session creation, MFA bypass, role change, password change, or secret output occurred. The resulting real browser session made all privileged requests through the running Next HTTP server.
- Verification scripts lived in the OS temp directory, outside application sources. The scripted comparisons queried the application's public PostgreSQL tables directly. No test suite or build was rerun.

### Scenario outcomes

| Scenario | Expected | Actual observation | HTTP | DB / audit comparison |
|---|---|---|---|---|
| 1. Matrix create and browser refresh | Two distinct SKUs, 0.29 / 19.99, existing category, Draft, success and creation audit | Created `Color: Red, Blue`; success displayed; refreshed browser, reopened draft and read both original decimal values | POST 201; collection GET 200 | Stored 29 / 1999 minor units, normalized red/blue attributes, selected category link, Draft, one product.created audit; snapshot below |
| 2. Edit and refresh | Persist edited fields, retain matching IDs, Draft and one additional audit | Updated name/description and second price to 20.01; refreshed and reopened with 20.01 | PUT 200 | Same two variant IDs, second amount 2001, Draft, exactly two product audit rows including one product.updated; snapshot below |
| 3a. Normalized duplicate SKU | Field error, retain entered value, no persisted change | Second SKU set to lowercase/space-padded first SKU; Arabic SKU error and aria-invalid=true; entered value remained | PUT 409 | Complete scoped product/variants/attributes/links/audit snapshot unchanged |
| 3b. Invalid compare price | Field error, retain input, no persisted change | Entered 0.01 comparison against 0.29 regular price; Arabic comparison-price error; 0.01 remained in input | PUT 422 | Complete scoped business/audit snapshot unchanged |
| 3c. Equivalent attributes | Attribute field rejection, no persisted change | Browser-context fetch submitted second combination `{COLOR: ' RED '}` against first red; response details identify variants.1.attributes / Duplicate attribute combination | PUT 422 | Complete scoped business/audit snapshot unchanged |
| 4a. Missing/invalid CSRF | Reject both mutations, no changes | Two real browser-context HTTP requests denied with FORBIDDEN | PUT 403 each | Complete scoped business/audit snapshot unchanged after each request |
| 4b. No authentication | Reject mutation, no changes | Fresh separate browser context without login denied | PUT 401 | Complete scoped business/audit snapshot unchanged |
| 4c. Authenticated unrelated role | Reject staff without catalog permission, no changes | NOT EXECUTED: no separate suitable account; owner roles/session were not changed | No result | No actual evidence; historical role-negative test remains the only support |
| 5. Public isolation without login | Draft absent from list, direct ID 404, no variant leakage | Fresh anonymous context: list contains neither test run marker nor product ID; detail contains neither marker nor checked variant ID | GET list 200; detail 404 | Scoped business/audit snapshot unchanged |
| 6. Assigned-category delete | Conflict visible; category/link remain | Opened category page, clicked Delete and confirmed; displayed “Cannot delete category assigned to products” | DELETE 409 | Category still exists; product link and complete scoped business/audit snapshot unchanged |

The matrix editor produces unique combinations by construction, so an equivalent-combination rejection was observed through actual browser HTTP, not by forcing duplicate form rows. UI field/input-preservation evidence was observed for duplicate SKU and invalid comparison price. Do not claim an equivalent-combination UI rejection was manually observed.

For failed PUTs and DELETE, “unchanged” means an exact JSON comparison of this test product's complete rows, ordered variants/attributes/category links and all its product audit rows to the post-edit baseline. This closes the scoped draft partial-write/audit evidence gap. It is not a global audit of unrelated application activity or a separately tested failed POST. The failed category deletion also checked category existence; it did not snapshot every category audit event.

### Traceability update

AC1, AC2 and AC4 now have actual browser/HTTP/application-PostgreSQL evidence. AC3 has browser negative evidence for SKU/comparison and HTTP evidence for equivalent combinations. AC5 and AC7 have actual HTTP/browser and scoped DB evidence. AC6 has actual invalid-input, CSRF and unauthenticated denial evidence, but authenticated unrelated-role denial remains missing. No currency-change experiment was performed because global currency settings were excluded by the user.

### Harness interruptions and retained test data

Two preliminary attempts created distinct marked fixtures before the temporary harness stopped: one read the form before its detail load completed; another selector matched both the form alert and Next's route announcer. These were harness issues corrected only in temporary verification code. The final attempt completed every executable scenario. No speculative application fix was made.

Retained fixtures (no deletion performed):
- `E04LIVE-1791967468202` / `prd_kmgd8bbhcyibptjo8shgel52` (preliminary created draft).
- `E04LIVE-1791967525191` / `prd_bp31uyo5x09ieif03hfbkgf3` (preliminary created/edited draft).
- `E04LIVE-1791967556570` / `prd_zv17px9ag5i1zywf2hnqja3l` (final complete executable run).

All use the existing category `cat_ujdqaphdtvzi5q60qfsrabcg` (احذيه). Test drafts and their audits remain distinguishable by the run marker. The deletion attempt was denied, so the existing category was preserved.

TOTP test flakiness remains OPEN as separate work. A successful real MFA login does not stabilize the historical replay test or provide a uniformly green final suite. No story status, owner acceptance, commit, publication or application-code change occurred.

### Final-run captured DB evidence (test data only)
Run: `E04LIVE-1791967556570`; product: `prd_zv17px9ag5i1zywf2hnqja3l`.

Creation snapshot:
```json
{
    "products":  [
                     {
                         "id":  "prd_zv17px9ag5i1zywf2hnqja3l",
                         "name":  "E04LIVE-1791967556570",
                         "description":  "Local E04-02 verification",
                         "status":  "draft",
                         "created_at":  "2026-10-14T08:45:59.394Z",
                         "updated_at":  "2026-10-14T08:45:59.394Z"
                     }
                 ],
    "variants":  [
                     {
                         "id":  "var_cfm6v38w6q36m17ktnwhg201",
                         "sku":  "E04LIVE-1791967556570-RED",
                         "price_minor":  "29",
                         "compare_price_minor":  null,
                         "currency":  "EGP",
                         "currency_scale":  2,
                         "combination_key":  "[[\"color\",\"red\"]]",
                         "sort_order":  0
                     },
                     {
                         "id":  "var_ne3dr7m9axy8tp1sgegh9gxc",
                         "sku":  "E04LIVE-1791967556570-BLUE",
                         "price_minor":  "1999",
                         "compare_price_minor":  null,
                         "currency":  "EGP",
                         "currency_scale":  2,
                         "combination_key":  "[[\"color\",\"blue\"]]",
                         "sort_order":  1
                     }
                 ],
    "attributes":  [
                       {
                           "variant_id":  "var_cfm6v38w6q36m17ktnwhg201",
                           "name":  "color",
                           "value":  "red"
                       },
                       {
                           "variant_id":  "var_ne3dr7m9axy8tp1sgegh9gxc",
                           "name":  "color",
                           "value":  "blue"
                       }
                   ],
    "links":  [
                  {
                      "product_id":  "prd_zv17px9ag5i1zywf2hnqja3l",
                      "category_id":  "cat_ujdqaphdtvzi5q60qfsrabcg"
                  }
              ],
    "audit":  [
                  {
                      "id":  "ee04e514-daf1-4f27-8926-2cf29cf73d79",
                      "action":  "product.created",
                      "resource":  "product:prd_zv17px9ag5i1zywf2hnqja3l",
                      "diff":  {
                                   "after":  {
                                                 "id":  "prd_zv17px9ag5i1zywf2hnqja3l",
                                                 "name":  "E04LIVE-1791967556570",
                                                 "status":  "draft",
                                                 "variants":  [
                                                                  {
                                                                      "id":  "var_cfm6v38w6q36m17ktnwhg201",
                                                                      "sku":  "E04LIVE-1791967556570-RED",
                                                                      "currency":  "EGP",
                                                                      "attributes":  {
                                                                                         "color":  "red"
                                                                                     },
                                                                      "priceMinor":  "29",
                                                                      "currencyScale":  2,
                                                                      "comparePriceMinor":  null
                                                                  },
                                                                  {
                                                                      "id":  "var_ne3dr7m9axy8tp1sgegh9gxc",
                                                                      "sku":  "E04LIVE-1791967556570-BLUE",
                                                                      "currency":  "EGP",
                                                                      "attributes":  {
                                                                                         "color":  "blue"
                                                                                     },
                                                                      "priceMinor":  "1999",
                                                                      "currencyScale":  2,
                                                                      "comparePriceMinor":  null
                                                                  }
                                                              ],
                                                 "createdAt":  "2026-10-14T08:45:59.394Z",
                                                 "updatedAt":  "2026-10-14T08:45:59.394Z",
                                                 "categoryIds":  [
                                                                     "cat_ujdqaphdtvzi5q60qfsrabcg"
                                                                 ],
                                                 "description":  "Local E04-02 verification"
                                             }
                               },
                      "request_id":  "f74ea7c9-d132-42c3-9991-a9126c59c815"
                  }
              ]
}
```

Edit snapshot:
```json
{
    "products":  [
                     {
                         "id":  "prd_zv17px9ag5i1zywf2hnqja3l",
                         "name":  "E04LIVE-1791967556570 edited",
                         "description":  "Updated local E04-02 verification",
                         "status":  "draft",
                         "created_at":  "2026-10-14T08:45:59.394Z",
                         "updated_at":  "2026-10-14T08:46:01.969Z"
                     }
                 ],
    "variants":  [
                     {
                         "id":  "var_cfm6v38w6q36m17ktnwhg201",
                         "sku":  "E04LIVE-1791967556570-RED",
                         "price_minor":  "29",
                         "compare_price_minor":  null,
                         "currency":  "EGP",
                         "currency_scale":  2,
                         "combination_key":  "[[\"color\",\"red\"]]",
                         "sort_order":  0
                     },
                     {
                         "id":  "var_ne3dr7m9axy8tp1sgegh9gxc",
                         "sku":  "E04LIVE-1791967556570-BLUE",
                         "price_minor":  "2001",
                         "compare_price_minor":  null,
                         "currency":  "EGP",
                         "currency_scale":  2,
                         "combination_key":  "[[\"color\",\"blue\"]]",
                         "sort_order":  1
                     }
                 ],
    "attributes":  [
                       {
                           "variant_id":  "var_cfm6v38w6q36m17ktnwhg201",
                           "name":  "color",
                           "value":  "red"
                       },
                       {
                           "variant_id":  "var_ne3dr7m9axy8tp1sgegh9gxc",
                           "name":  "color",
                           "value":  "blue"
                       }
                   ],
    "links":  [
                  {
                      "product_id":  "prd_zv17px9ag5i1zywf2hnqja3l",
                      "category_id":  "cat_ujdqaphdtvzi5q60qfsrabcg"
                  }
              ],
    "audit":  [
                  {
                      "id":  "ee04e514-daf1-4f27-8926-2cf29cf73d79",
                      "action":  "product.created",
                      "resource":  "product:prd_zv17px9ag5i1zywf2hnqja3l",
                      "diff":  {
                                   "after":  {
                                                 "id":  "prd_zv17px9ag5i1zywf2hnqja3l",
                                                 "name":  "E04LIVE-1791967556570",
                                                 "status":  "draft",
                                                 "variants":  [
                                                                  {
                                                                      "id":  "var_cfm6v38w6q36m17ktnwhg201",
                                                                      "sku":  "E04LIVE-1791967556570-RED",
                                                                      "currency":  "EGP",
                                                                      "attributes":  {
                                                                                         "color":  "red"
                                                                                     },
                                                                      "priceMinor":  "29",
                                                                      "currencyScale":  2,
                                                                      "comparePriceMinor":  null
                                                                  },
                                                                  {
                                                                      "id":  "var_ne3dr7m9axy8tp1sgegh9gxc",
                                                                      "sku":  "E04LIVE-1791967556570-BLUE",
                                                                      "currency":  "EGP",
                                                                      "attributes":  {
                                                                                         "color":  "blue"
                                                                                     },
                                                                      "priceMinor":  "1999",
                                                                      "currencyScale":  2,
                                                                      "comparePriceMinor":  null
                                                                  }
                                                              ],
                                                 "createdAt":  "2026-10-14T08:45:59.394Z",
                                                 "updatedAt":  "2026-10-14T08:45:59.394Z",
                                                 "categoryIds":  [
                                                                     "cat_ujdqaphdtvzi5q60qfsrabcg"
                                                                 ],
                                                 "description":  "Local E04-02 verification"
                                             }
                               },
                      "request_id":  "f74ea7c9-d132-42c3-9991-a9126c59c815"
                  },
                  {
                      "id":  "d3a551a4-f493-438f-9a3c-d21c52f7c0c8",
                      "action":  "product.updated",
                      "resource":  "product:prd_zv17px9ag5i1zywf2hnqja3l",
                      "diff":  {
                                   "after":  {
                                                 "id":  "prd_zv17px9ag5i1zywf2hnqja3l",
                                                 "name":  "E04LIVE-1791967556570 edited",
                                                 "status":  "draft",
                                                 "variants":  [
                                                                  {
                                                                      "id":  "var_cfm6v38w6q36m17ktnwhg201",
                                                                      "sku":  "E04LIVE-1791967556570-RED",
                                                                      "currency":  "EGP",
                                                                      "attributes":  {
                                                                                         "color":  "red"
                                                                                     },
                                                                      "priceMinor":  "29",
                                                                      "currencyScale":  2,
                                                                      "comparePriceMinor":  null
                                                                  },
                                                                  {
                                                                      "id":  "var_ne3dr7m9axy8tp1sgegh9gxc",
                                                                      "sku":  "E04LIVE-1791967556570-BLUE",
                                                                      "currency":  "EGP",
                                                                      "attributes":  {
                                                                                         "color":  "blue"
                                                                                     },
                                                                      "priceMinor":  "2001",
                                                                      "currencyScale":  2,
                                                                      "comparePriceMinor":  null
                                                                  }
                                                              ],
                                                 "createdAt":  "2026-10-14T08:45:59.394Z",
                                                 "updatedAt":  "2026-10-14T08:46:01.969Z",
                                                 "categoryIds":  [
                                                                     "cat_ujdqaphdtvzi5q60qfsrabcg"
                                                                 ],
                                                 "description":  "Updated local E04-02 verification"
                                             },
                                   "before":  {
                                                  "id":  "prd_zv17px9ag5i1zywf2hnqja3l",
                                                  "name":  "E04LIVE-1791967556570",
                                                  "status":  "draft",
                                                  "variants":  [
                                                                   {
                                                                       "id":  "var_cfm6v38w6q36m17ktnwhg201",
                                                                       "sku":  "E04LIVE-1791967556570-RED",
                                                                       "currency":  "EGP",
                                                                       "attributes":  {
                                                                                          "color":  "red"
                                                                                      },
                                                                       "priceMinor":  "29",
                                                                       "currencyScale":  2,
                                                                       "comparePriceMinor":  null
                                                                   },
                                                                   {
                                                                       "id":  "var_ne3dr7m9axy8tp1sgegh9gxc",
                                                                       "sku":  "E04LIVE-1791967556570-BLUE",
                                                                       "currency":  "EGP",
                                                                       "attributes":  {
                                                                                          "color":  "blue"
                                                                                      },
                                                                       "priceMinor":  "1999",
                                                                       "currencyScale":  2,
                                                                       "comparePriceMinor":  null
                                                                   }
                                                               ],
                                                  "createdAt":  "2026-10-14T08:45:59.394Z",
                                                  "updatedAt":  "2026-10-14T08:45:59.394Z",
                                                  "categoryIds":  [
                                                                      "cat_ujdqaphdtvzi5q60qfsrabcg"
                                                                  ],
                                                  "description":  "Local E04-02 verification"
                                              }
                               },
                      "request_id":  "06114219-79b7-4c63-aa52-c3ba596752e3"
                  }
              ]
}
```
