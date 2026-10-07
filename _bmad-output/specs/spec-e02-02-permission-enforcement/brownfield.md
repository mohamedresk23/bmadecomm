# Current project context and conflicts

Inspected on 2026-10-07. Application code was not changed by this specification.

| Existing file / convention | Reuse or implementation implication |
|---|---|
| `src/shared/authz/policy.ts`, `policy.test.ts`, `index.ts` | Deny-by-default/ownership primitives and shallow field allowlist exist; supplied permission arrays are fixture-level authority, not live grants |
| `src/shared/authz/audit.ts`, `src/db/tx.ts`, migration `0002_audit_append_only.sql` | Transactional audit and protected history; reuse rather than replacing audit storage |
| `src/db/schema.ts` | Initial absence superseded by E02-01 independent stage: staff accounts, roles, permissions, user roles and hashed sessions now exist; full login/MFA remains pending; customer role default preserved |
| `src/db/migrations/`, `meta/_journal.json`, `src/db/migrate.ts` | E02-01 appended and locally applied 0007_staff_sessions; append later grant migrations without altering applied history |
| `src/shared/api/errors.ts`, `error-handler.ts`, `client.ts`, `validation.ts` | Existing nested error contract, client interpreter, runtime validation and safe status primitives |
| `src/proxy.ts` | Correlation header propagation; does not authenticate/authorize staff |
| `src/app/api/media/upload/route.ts`, `publish/route.ts` | Existing `media:upload` consumers currently parse `x-mock-user`; remove this production trust source when integrating live staff policy |
| `src/test-utils/db.ts`, `vitest.config.mts`, migration runner | Existing fixtures/colocated Vitest and PGlite harness; real PostgreSQL verification still required by AD-17 |
| `package.json` | Next.js 16.3.8, React 19.2.8, TypeScript, Drizzle, PostgreSQL adapter, Zod, Vitest; lint/typecheck/build scripts available |
| `AGENTS.md`, installed Next authentication guide | Read installed framework guidance before code; authorize near data access and on each entry point; layout/Proxy checks do not protect all routes or RSC payloads |

The planning architecture's description of an empty repository is historical. Preserve its adopted layering/security decisions while following the implemented `src/db/` and colocated-test conventions. No unrelated relocation to its suggested `database/` or `tests/` directories is required.

## Proposed artifact discrepancies

Two untracked files appeared during inspection and were preserved untouched: `../../implementation-artifacts/spec-e02-02-permission-enforcement.md` and `../../implementation-artifacts/tickets-e02-02.md`. They are proposals, not adopted contract companions. The authoritative story/PRD remains the source of scope.

| Proposal claim | Evidence / required resolution |
|---|---|
| F00-04 already created roles/permissions/user_roles | Current schema disproves this; E02-01 explicitly owns those foundational tables. Confirm prerequisite delivery before extending it |
| Multiple-role permissions are additive | PRD leaves final matrix OQ-08; composition is unresolved, not approved |
| Middleware catches any in-flight role revoke immediately | Sources guarantee next request after committed revocation; retroactive in-flight cancellation is unsupported |
| New global interceptor and client routing guards are part of E02-02 | Story layers are BE/DB; E02-01 owns shell/navigation. Limit frontend work to consumers required by this backend contract |
| Permission denial blocks navigation entirely | UX permits generic denial of the inaccessible surface; do not remove permitted shell destinations |
| Always 403 for customer sessions; omit error details | Align session classification with E02-01 and resolve AD-10 envelope/required fields first |

Identity owns grants under AD-2; authorization is AD-9. The story's AD-2 citation describes ownership, not the complete security policy. Preserve both references with their correct roles.

## Source routing

PRD/architecture/UX remain adopted companions because downstream implementers need their invariants and open decisions. Story/epic catalogs are adopted companions too: this spec absorbs only E02-02 and relevant Epic 02 boundaries, not the entire catalogs. Sibling stories are explicit non-goals. Planning ceremony, unrelated epic details and undecided visual branding are wrapper-only content, not omitted implementation obligations. The canonical memory carries this routing and the validation verdicts.
