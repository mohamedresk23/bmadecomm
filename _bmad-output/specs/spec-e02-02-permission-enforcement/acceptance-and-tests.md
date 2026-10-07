# Acceptance criteria, tests and requirement traceability

These are new implementation verification obligations, not execution claims. Matrix v2/A1 are now approved with refund eligibility, actual-key nested default-deny and cumulative MFA requirements; every affected row must have newly executed evidence.

| ID | Acceptance criterion | Required verification | PRD / architecture / capability |
|---|---|---|---|
| E02-02-AC1 | Every administrative request/command checks current staff identity, session and action/resource permission; absent grants deny | Unit policy cases plus reference HTTP and direct application consumer integration | FR-06/07; NFR-12; AD-2/9; CAP-1 |
| E02-02-AC2 | Committed role revocation or disable denies the next request with the same session; no cross-request grant cache | Permit, commit revoke/disable in a separate transaction, then request again; repeat on a second app context/instance | FR-06; AC-13; AD-9/12; CAP-1 |
| E02-02-AC3 | Denied commands have no business side effects | Compare resource, stock, money, grant and outbox state before/after denial; no successful business audit event | FR-07; AC-13; AD-9/15/17; CAP-1 |
| E02-02-AC4 | Warehouse refund/role-grant and Support inventory operations are rejected without effect | Matrix-driven action tests on harmless reference commands until real downstream modules exist; later module integration owns real effects | FR-06/07; §8.1; AC-13; CAP-1/3 |
| E02-02-AC5 | Customer/guest contexts and forged role/permission headers cannot authorize admin | HTTP cases for customer/guest/missing/expired sessions, unknown permission and `x-mock-user` tampering | FR-02/06/07; NFR-12; AD-9/10; CAP-1 |
| E02-02-AC6 | Restricted fields are absent from serialized DTOs, including nested payloads; permitted fields are retained | Assert actual serialized JSON/HTML/RSC boundary output and nested arrays/objects, not just helper return shape or hidden CSS | FR-07; UX-07; AD-9/10/12; CAP-2 |
| E02-02-AC7 | Seeds implement approved baseline definitions/links repeatably without duplicates, accidental grants or customer migration | Fresh/current-schema upgrade, seed twice, uniqueness/FKs, explicit grant preservation, forced failure rollback | FR-06/07; §8.1; OQ-08; NFR-14; AD-16/17; CAP-3 |
| E02-02-AC8 | Dependency failure denies safely; reference success/failure obey the approved error and cache contracts | Authority DB outage after a successful request, 401/403/404/503/500 fixtures as applicable, no-store/private and correlation checks | FR-58; NFR-12; AD-10/12; CAP-1/2 |
| E02-02-AC9 | Existing consumers handle denied/session-expired/omitted-field output without leaking data; permitted navigation remains usable | Existing-shell/API-client contract tests, mobile rendering and keyboard/error announcements where integrated | FR-06/07/58; NFR-08/09; UX-07; AD-11; CAP-1/2 |

## Test levels and execution plan

Use existing colocated Vitest tests and shared PostgreSQL transaction fixtures. Extend `src/shared/authz/policy.test.ts` with matrix-driven allow/deny, unknown permission and projection coverage. Add identity persistence and reference route integration tests when E02-01 supplies real sessions. Reuse shared API error/validation tests and adapt media consumer tests to trusted session fixtures.

The existing harness uses PGlite for tests. It is useful for fast checks but does not replace real PostgreSQL evidence for committed revocation between requests, upgrade constraints and rollback (AD-17). A revoke-then-request test must commit the revocation before the next request; one rollback-only transaction or a mock permissions array cannot demonstrate live authority across requests.

For field projection, exercise actual serialization of nested objects/arrays and success/error paths. Assert unauthorized keys are absent, authorized values are unchanged and database objects are not sent to client components. UI integration covers denial, session expiry, no protected loading flash and responsive alternatives only where a consumer exists; do not create unrelated screens to test the foundation.

At implementation time run the affected Vitest suites (`npx vitest run <affected test paths>`), relevant real PostgreSQL verification, `npm run lint`, `npm run typecheck`, and `npm run build` for adapter/import/client-boundary changes. Record exact commands, results and dependency skips. No application checks are claimed in this specification-only run.

## Readiness gates

1. E02-01's independent stage delivered the administrative session/role schema and passed lifecycle checks; complete its approved MFA/login/provisioning/shell and verification before E02-02.
2. Implement the explicitly approved v2 matrix and union, including actual leaf lists and current base-role refund requirement; no unclassified field or unknown permission may pass.
3. Retain approved nested errors and development/test-only reference availability. Verify actual-cookie media authorization and mocked-header rejection.
4. Reconcile the two existing proposed implementation artifacts; do not dispatch their extra global-frontend/in-flight-revocation requirements as approved work.

Coherence and source preservation can pass for this artifact while these implementation gates remain open. This is not a production-ready approval or a completed story.
