# Epic 2 Context: Admin access & staff permissions

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give the Store Owner a protected administration area and the ability to operate a team with least privilege. Administrative access, staff lifecycle, action and field authorization, and resource-level audit visibility must preserve account boundaries, prevent unauthorized effects, and protect continued access by an active Owner. Other domains' operational screens are outside this epic.

## Stories

- Story E02-01: Admin login and admin shell
- Story E02-02: Action and field permission enforcement
- Story E02-03: Staff management and last-Owner protection
- Story E02-04: Resource audit panel

## Requirements & Constraints

Every administrative request must check the current account state and authorization on the server. A disabled account or revoked role must prevent the next administrative request. Hidden navigation and buttons are presentation aids, never authorization controls. Unauthorized requests must leave business state, inventory, and money unchanged; rejection must not disclose private resource existence or sensitive snapshots.

Authorization is deny by default at the action, resource, and field levels. Explicit permission grants and resource ownership determine access; a role name alone is insufficient. Sensitive fields must be omitted from server-produced response DTOs rather than merely concealed in the UI. Customer and guest contexts cannot acquire administrative access or another customer's resources.

The documented role baseline is:

- Store Owner can operate functions, roles, settings, and audit, but cannot bypass financial invariants or delete history.
- Store Manager has catalog, inventory, customer, order, coupon, and basic-report access; role grants and secret management are excluded, and refunds require the explicit `orders.refund` grant.
- Warehouse has necessary order-preparation data, preparation/shipping transitions, and reasoned inventory movements; refunds, permission changes, price changes, cost, and financial reports are excluded.
- Customer Support has necessary customer/order support data, notes, and policy-permitted cancellation; inventory edits, prices, refunds, and permission changes are excluded.
- Marketing has authorized coupon, content, and marketing-report access; payment, refunds, inventory, and unnecessary personal data are excluded.

The user explicitly approved permission matrix v2 and staff authentication A1 on 2026-10-07. Apply current-role grant union, default denial, actual-key nested field allowlists and Owner secret masking. Support has no administrative prices/payment details, only payment state. Refund needs current Owner/Manager, orders.read, orders.refund, resource rules and fresh MFA even with refund_operator assigned. Staff password+TOTP is mandatory, with 30-minute idle/12-hour absolute sessions, no absolute extension on rotation, bounded restricted recovery and no lost-all-factors bypass. WebAuthn and other staff creation are excluded from E02-01/02; other staff creation belongs to E02-03. Non-staff A-09/A-10/A-11 and production provider/operator/retention choices remain separately unapproved.

Only an authorized Store Owner manages staff and role assignments. The last active Owner must remain protected even under concurrent disable/demotion attempts. Identity changes and relevant resource mutations require durable, redacted audit evidence. Audit history is operationally read-only; global audit search/export belongs to a later epic.

## Technical Decisions

The application is a modular Next.js/TypeScript system backed by PostgreSQL. Identity owns credentials, sessions, and grants; audit owns append-only audit events. Administrative adapters delegate authorization and business commands to module application services rather than trusting the browser.

Use separate staff and customer session contexts. Server-side opaque sessions store token hashes and enforce active/expiry/account checks; cookies are host-only, Secure, and HttpOnly with an appropriate SameSite policy. Permissions must be evaluated against current data for each request/command; stale JWT claims or shared caches must not keep a revoked grant alive. Administrative and account responses are private/no-store.

Relevant identity data includes users, sessions, roles, permissions, and user-role associations. Actor or service scope must be explicit for administrative endpoints and worker commands. Return only allowed fields from DTO serializers, including nested representations; avoid exposing costs, internal notes, unnecessary personal data, payment secrets, or raw card data outside their authorized scope.

Cookie-authenticated mutations require the approved Origin/CSRF mechanism in addition to RBAC. Validate input on the server and use the shared versioned DTO/error contracts, with code, message, details, and request correlation. State-changing operations use the existing transaction context; account/role changes must support revocation and concurrent last-Owner protection.

Audit records contain redacted actor/action/resource/time/diff/request correlation, committed with the mutation. The application role must not update or delete them. Diagnostic logs must exclude credentials, proof tokens, raw card data, and unnecessary personal data.

Verification includes matrix-driven action/field authorization coverage, revocation followed by the next request, no-effect denial, payload redaction, and PostgreSQL-backed integration/concurrency checks for identity changes. UI coverage exercises permitted navigation, denied direct access, and accessible error states; mock-only evidence is insufficient for database locks and rollback guarantees.

## UX & Interaction Patterns

Administration has its own login and navigation shell. Staff see only sections and actions allowed by current permissions. On session validation after revocation, stale private data must be removed and unauthorized access rejected. The staff surface supports creation, role assignment, and disabling, with explicit confirmation and error feedback for protected changes.

Warehouse sees shipping contact information only as needed for fulfillment and payment/COD status only as a shipping condition. Support sees only data needed for support; internal notes remain distinct from customer messages. Manager, Warehouse, and Support do not gain financial badges or sections simply by entering administration. Resource audit views show authorized actor/action/time/changed-field information with the same server-side redaction rules.

Apply the shared accessible form, keyboard/focus, label, and error patterns. Visual branding and Arabic RTL are not resolved by this epic; RTL remains conditional on market/language approval.

## Cross-Story Dependencies

Epic 1 account/session primitives and the shared foundation's session, permission, DTO/error, transaction, and audit contracts precede administrative access. E02-01 depends on E01-03 and F00-04. E02-02 depends on E02-01; E02-03 and E02-04 depend on E02-02.

Approved v2/A1 and their binding clarifications are in e02-permission-matrix-proposal.md and e02-authentication-contract-proposal.md. MFA account failures accumulate across regenerated challenges: five/account/15 minutes, plus twenty verification attempts/trusted source/15 minutes and five/challenge/five minutes. Refunds, grants, secrets, factor/code operations require the approved fifteen-minute/fresh-operation proof. Verify full E02-01 before E02-02, with new executed tests rather than prior foundation evidence. Downstream modules must consume the same authorization/field policy. Named production operators, providers and retention remain release setup, not invented decisions.
