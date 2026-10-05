# PRD reconciliation — architecture

Reviewed: 2026-10-05. Source: PRD v2 `prd-bmadecomm-v2-2026-10-05/prd.md`, read in full. Targets: `ARCHITECTURE-SPINE.md` and explanatory `SOLUTION-DESIGN.md`, initial draft. No source or architecture files were changed by this reviewer.

The source governs product behavior. Coverage below means an architectural owner, invariant, or explicit deferred boundary exists; it does not mean a field-level API contract, schema, or implemented test exists. No Critical issue or necessary new product feature was identified. Medium findings require reconciliation before the package is represented as ready for dependent implementation stories.

## Findings

| ID | Severity | Source / target | Finding and correction |
|---|---|---|---|
| PRD-R1 | Medium | PRD §6.1, FR-20, AC-09; AD-3/4; SOLUTION-DESIGN §3 | The companion describes coupon consumption in the submit transaction, without distinguishing a usage reservation from accepted consumption. The PRD releases usage for a failed attempt before Paid/COD Confirmed and does not restore it after an accepted Order is cancelled/refunded. Bind the reserve → consume/release lifecycle and its concurrency/idempotency guards to the same acceptance reducer; preserve the source policy's proposed status. Also make verified guest proof/customer eligibility explicit so a typed email does not bypass per-customer limits. |
| PRD-R2 | Medium | AD-2 versus SOLUTION-DESIGN §1 | The spine assigns settings to a content submodule, while the companion assigns FR-42 settings to individual functional owners. Two implementers can choose incompatible write ownership. Choose one model: content/settings owns persistence and exposes authorized versioned changes, or functional owners own distinct settings groups with a read-only aggregation. Reflect the same model in both documents. |
| PRD-R3 | Medium | PRD §12, FR-58; SOLUTION-DESIGN §3/4 | The source expressly expects ERD and detailed API contracts during architecture, while the current package offers table/route families and defers the complete contracts to stories. Provide at least relationship cardinalities and a shared concrete contract seed for checkout, payments, inventory and administration, with explicit blocked fields for unresolved OQs. Alternatively record this as an unfulfilled architecture deliverable; do not label the list of entities/routes a completed ERD/API design. |
| PRD-R4 | Medium | NFR-12; spine Deferred, companion §5 | Proposed numeric login/reset/guest/checkout limits now exist in the spine, but upload has no numeric proposal and the companion still says no numeric limits have been fixed. Add a technical proposed upload budget with size/count/actor/IP scope and the OQ-06 adoption gate, and synchronize the companion with the existing proposed table. This follows NFR-12 rather than inventing a product feature. |

## Functional coverage audit

| FR | Architecture coverage |
|---|---|
| 01 | identity owner; normalized unique email; validation; session/proof gates |
| 02 | identity sessions; active state and revoke; generic response/security contracts |
| 03 | scoped single-use proof; guest/claim separation |
| 04 | reset revocation and hash/expiry proof; AC-17 |
| 05 | customers owner, ownership DTO, address snapshots; email-change detail remains source behavior |
| 06 | Owner grant/revoke and concurrent last-Owner guard |
| 07 | server action/resource/field deny-by-default authorization |
| 08 | content draft/publication, preview cache isolation |
| 09 | published catalog SSR; pagination count; P1 controls absent |
| 10 | PostgreSQL search and URL query; Arabic normalization explicitly deferred |
| 11 | URL filters and stable sorting; exact source ranking/window remains PRD contract |
| 12 | catalog variants and interactive selection; server revalidation |
| 13 | variant ownership, SKU/combo uniqueness, money fields and sensitive cost DTO |
| 14 | catalog publication/archive and upload constraints; CRUD specifics remain PRD |
| 15 | category cycles/FKs, media quarantine and safe archive |
| 16 | SSR metadata and slug redirect data; robots/sitemap obligations remain FR-16 |
| 17 | cart ownership/server totals; no cart stock reservation inferred |
| 18 | server-backed cart and sum/clamp merge; source retains unavailable items and coupon revalidation |
| 19 | authoritative pricing, exact money, quote review |
| 20 | pricing/coupon owner and atomic limits; lifecycle gap PRD-R1 |
| 21 | guest checkout owner, non-sensitive recovery, no card persistence |
| 22 | shipping eligibility in submit; policy and schema await source gates |
| 23 | local Order/snapshot/reservation/idempotency before provider |
| 24 | actor-scoped payload hash and replay; no new unknown payment attempt |
| 25 | provider adapter/query/callback authority |
| 26 | receipts and independent COD collection; not Delivered=Paid |
| 27 | durable inbox, verified callback, dedupe/reducer and reconciliation |
| 28 | late payment recorded, full reacquisition or safe refund exception |
| 29 | scoped guest proof and private Order DTO |
| 30 | inventory balance/allocation/ledger owner and atomic movement |
| 31 | paid reservation conversion; ship reduces OnHand/Reserved once |
| 32 | transaction locks/constraints and real concurrent tests |
| 33 | orders snapshots/history and admin API; private fields excluded |
| 34 | three state dimensions, command guards and expected_version |
| 35 | separate customer cancellation request/admin execution and money tasks |
| 36 | manual shipment seed; no partial shipment or premature failed-delivery restock |
| 37 | receipt/refund budget including unresolved reserves; external COD payout |
| 38 | inspected item-quantity return and idempotent independent restock |
| 39 | authorized snapshot print; no newly asserted tax invoice |
| 40 | customer owner, profile/notes DTO and identity proof |
| 41 | read-only reporting from ledger/receipts, PRD §10 definitions |
| 42 | financial policy snapshots and settings gates; ownership mismatch PRD-R2 |
| 43 | durable transactional notification delivery/retries/dead-letter |
| 44 | notifications/operational queues; deferred New Return Request |
| 45 | append-only transactional redacted audit, restricted resource details |
| 46 | unique accepted purchase event, consent and no PII |
| 47 | P1 boundary only; correctly absent from P0 implementation |
| 48 | P1 boundary only; moderation assumption not adopted |
| 49 | P1 boundary only; no premature brand schema/control |
| 50 | P1 portal deferred; P0 inspection/refund remains available |
| 51 | P1 advanced reports deferred; P0 basic reports retained |
| 52 | P1 advanced coupons deferred; financial invariants unchanged |
| 53 | P1 channels deferred; email P0 retained |
| 54 | P1 search/export deferred; audit capture/detail P0 retained |
| 55 | immutable item/address/totals snapshots and retention gate |
| 56 | archive/FKs/quarantine and actual content checks |
| 57 | unique/check/FK, money caps, ownership and UTC instants |
| 58 | API shape/errors/concurrency/idempotency, incomplete detailed contract PRD-R3 |
| 59 | adapters, sandbox/failure/retry, no assumed provider adoption |
| 60 | durable recovery queues and audited safe replay, no usual manual DB repair |

## NFR and acceptance coverage

NFR-01/02: SSR, conditional public cache, indexed PostgreSQL and measured load gate. NFR-03/04: web/worker separation, backup/restore, release rollback and unapproved service targets. NFR-05/06/07: reconciliation, expiry validity, durable mail/outbox and correlated alerts. NFR-08/09: UX keyboard/mobile/manual accessibility, visual identity unapproved. NFR-10/11: idempotent business effects and real database concurrency. NFR-12: authorization/session/CSRF/encoding/secrets/log redaction; numeric upload budget gap PRD-R4. NFR-13: consent, privacy minimization and retention/residency source gates. NFR-14: separate environments/service identities, compatible migrations, runbooks and restore evidence.

All AC-01–AC-24 appear in the spine's test binding and companion QA table. Specific evidence types cover happy path/snapshots (01/02/19), order retries/stock/payment races (03/04/06/07/08), pricing/coupon/shipping (05/09/10/11), guest/RBAC/reset (12/13/17), cancel/refund/COD (14/15/16), email/upload/logs/stale (18/20/23), accessibility/mobile (21), load/restore/alerts/rollback (22), and financial reports/purchase dedupe (24). No actual implementation/test execution is claimed.

All A-01–A-11 and OQ-01–OQ-08 remain source decisions awaiting adoption. The user's stack/structure approval does not resolve these business decisions. Full P1 tables/services and P2 features were not added to P0.

## Resolution recheck

Re-read the revised spine and companion on 2026-10-05 after corrective edits. The findings above describe the initial draft and are retained as review history.

| Finding | Current disposition | Evidence |
|---|---|---|
| PRD-R1 | Resolved at architecture level | AD-4 and companion §3 now distinguish Reserved/Consumed/Released, source acceptance timing, non-restoration after acceptance, atomic cap and verified eligibility. |
| PRD-R2 | Resolved | Companion §1 now makes settings a content submodule with policy-reading contracts, matching AD-2. |
| PRD-R3 | Resolved for architecture seed; detailed contracts remain an explicit story-readiness gate | Companion §3 adds ER cardinalities and nullable-customer/component explanations; §4 adds request/response/guard examples for quote, submit, order transition, refund and webhook. This is a proposed contract seed, not final complete schemas or a claim that every dependent story is ready. Full field-level contracts and OQ-dependent policy values must still be fixed jointly before those stories, as FR-58 requires. |
| PRD-R4 | Resolved | Spine Deferred now proposes upload 20 files/10min per authorized actor with body-size constraints alongside login/reset/guest/checkout limits; companion §5 points to these proposals and explicitly retains OQ-06 adoption/abuse-test gates. |

No unresolved Critical/High/Medium architecture-level issue remains from this PRD reconciliation. This result does not approve unresolved product decisions, final API fields, provider policies, production deployment or actual implementation.
