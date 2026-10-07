---
id: SPEC-e02-02-permission-enforcement
story: E02-02
epic: Epic 02
created: 2026-10-07
companions:
  - implementation-requirements.md
  - api-contracts.md
  - acceptance-and-tests.md
  - brownfield.md
  - ../../planning-artifacts/prds/prd-bmadecomm-v2-2026-10-05/prd.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/SOLUTION-DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/EXPERIENCE.md
  - ../../planning-artifacts/stories/stories-bmadecomm-2026-10-05/stories.md
  - ../../planning-artifacts/epics/epics-bmadecomm-2026-10-05/epics.md
sources: []
---

# E02-02 — Action and field permission enforcement

> Derived from canonical memory and cited sources. Read all companions. The user explicitly approved matrix v2/A1 and binding clarifications on 2026-10-07. E02-01 must be implemented and verified first; this contract does not claim either story complete.

## Why

Staff access must remain least privilege after roles change, even when an old session or a direct request bypasses the visible navigation. E02-02 provides Epic 02's action, resource and field enforcement foundation: denied operations have no business effect, and unauthorized data never reaches the client. Product authority is PRD FR-06/07 and §8; identity owns grants under AD-2, while AD-9 defines authorization.

## Capabilities

- **CAP-1**
  - **intent:** Staff actions and resource access are authorized against current server identity and grants on every request.
  - **success:** After a committed role revocation or account disable, the next administrative request using the same session is denied; unauthorized commands make no business changes.
- **CAP-2**
  - **intent:** Staff receive only resource fields they are permitted to read.
  - **success:** Disallowed keys are absent from serialized API, HTML and RSC DTO payloads, including nested data; allowed fields remain available.
- **CAP-3**
  - **intent:** Administrative roles and permissions have repeatable baseline provisioning.
  - **success:** An approved matrix reproduces PRD §8 restrictions; rerunning its seed creates no duplicate definitions or unexpected grants and preserves existing identities and explicit grants.

## Constraints

- Deny by default for action, resource and field; customer/guest sessions and client role claims never confer administrative access.
- Check active session, expiry, account state and current grants on the server for each request/command. Reuse within one request is permitted; grants cannot be cached across requests. Private output cannot enter shared caches.
- Identity owns grant persistence; application policies protect all entry points. Proxy, navigation or layout checks alone cannot authorize access.
- Use existing PostgreSQL/Drizzle migration and shared authorization/API conventions; reconcile missing E02-01 prerequisites before building on them.
- Matrix v2/A1 are approved: union of current explicit grants, exact action keys, actual-key nested DTO allowlists, secret prohibition for Owner too, and password+TOTP security lifecycle. refund_operator additionally requires current Owner/Manager and orders.read on every refund check. A new/unclassified field is absent by default.
- E02-01 verification precedes E02-02 implementation. Keep approved nested error compatibility and development/test-only reference availability; no WebAuthn, other staff creation or export feature in this phase.

## Non-goals

- Within E02-02: admin login/MFA/provisioning/navigation shell, staff management and last-Owner guard (E02-03), resource audit panel (E02-04). The user separately authorizes E02-01 as prerequisite work, to be verified first.
- New inventory, refund or other business modules; role editor; global client interceptor; P1 features; new session lifetimes or authentication policies.

## Success signal

Fresh matrix-driven tests and a protected reference fixture demonstrate permitted access, next-request revocation, zero denied business effects and absence of unauthorized fields. Real PostgreSQL verifies persistence, seed reruns/rollback, concurrent session changes and refund eligibility after Manager removal. Prior foundation test results do not verify newly implemented workflows.

## Assumptions

- A reference test endpoint uses harmless synthetic resources while downstream business modules are absent; its field/grant mapping is included in the pending matrix proposal. Its actual staff authentication and production exclusion are approved requirements.

## Approved security decisions

- Password+TOTP for all staff; 30-minute idle and 12-hour absolute session; rotation never extends absolute expiry. Sensitive refund/grant/secret actions need MFA proof within 15 minutes; factor/code changes require fresh proof in that operation.
- Five cumulative MFA failures/account/15 minutes across all challenges, twenty verification attempts/source/15 minutes and five failures per five-minute challenge. New challenges cannot reset budgets.
- Restricted recovery never grants normal admin access before newly confirmed MFA; lost all factors/codes fails closed and offline emergency-code custody is documented.
- Preserve earlier drafts, but their unsupported in-flight cancellation or global interceptor behavior is not adopted.

## Approved continuation decisions — 2026-10-07

- Inspect available refs without automatically merging a branch; if E02-01 is absent, implement it separately and verify before E02-02. Real staff sessions are required.
- Preserve `{error:{...}}` without a consumer migration; document the AD-10 divergence.
- `/api/v1/admin/test-protected` is development/test-only and inaccessible in production; use actual staff sessions/live authorization with no bypass.
- Explicit subsequent approval authorizes the displayed v2/A1, superseding earlier pending questions. Only first Owner provisioning is in scope; other staff creation remains E02-03. Replace media x-mock-user through actual session/CSRF/live authorization and test spoofed headers.
