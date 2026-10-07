---
title: "Implementation Spec: E02-02 — Action and field permission enforcement"
status: "proposed"
created: "2026-10-07"
epic: "Epic 02"
story: "E02-02"
---

# Implementation Spec: E02-02 — Action and field permission enforcement

## Objective
Ensure least-privilege enforcement on every admin request by validating permissions per-request at the server level. This prevents unauthorized actions and strictly redacts sensitive fields in responses based on the user's role (AD-2).

## Scope
- Role-to-permission matrix seeding based on OQ-08 requirements.
- Per-request permission evaluation mechanism (middleware/hooks).
- Server-side field redaction in DTOs for API responses.
- Reference protected test endpoint to verify permission evaluation.
- Applies to all backend admin-facing endpoints.

## Out of Scope
- UI implementation for Role/Staff management (handled in E02-03).
- Creation of actual business feature endpoints (other than a reference test endpoint).
- Client-side routing guards (while important for UX, the focus here is robust backend/database enforcement).
- Customer-facing permission evaluation (covered by ownership checks in respective customer stories).

## Business Rules
- **Deny by Default:** All admin requests must be explicitly authorized. Endpoints without defined permissions must reject all requests.
- **No Cached Grants:** Permissions must be evaluated per-request against the live database state to ensure immediate revocation impact.
- **UI Visibility != Authorization:** Hiding a button in the UI does not grant security. The backend must enforce the rule regardless of UI state.
- **Redaction over Hiding:** Unauthorized fields must be stripped from the API payload (DTOs), not just hidden by the frontend.

## Frontend Requirements
- Handle HTTP `403 Forbidden` and `401 Unauthorized` responses generically.
- Display "Permission Denied" states when direct access to an unauthorized route is attempted (UX-07).
- Ensure navigation components respect roles by hiding inaccessible sections, matching backend enforcement.
- Do not expose resource details on unauthorized access screens.

## Backend Requirements
- Implement an authorization middleware/hook that checks `user_roles` and `permissions` for the authenticated admin session.
- Middleware must fetch live grants on every request to guarantee immediate revocation (AC-13).
- Implement field-level redaction utility for DTOs before serialization to the client.
- Provide a test endpoint (e.g., `GET /api/v1/admin/test-protected`) to assert permission logic.

## Database Changes
- Seed the roles and permission matrix (from OQ-08 baseline).
- Ensure `roles`, `permissions`, and `user_roles` tables are correctly joined for fast permission lookup. *(Note: Base schemas should already exist from F00-04; this story populates the seed and utilizes them).*

## API Contracts
- All admin endpoints must return standard errors:
  - `401 Unauthorized` (Invalid/expired session)
  - `403 Forbidden` (Valid session, lacking required permission for action/field)
- No leak of sensitive fields in `200/201` responses if the role lacks read access to those fields.

## Validation Rules
- Session token must be valid, active, and belong to a staff account.
- The associated role must not be disabled.
- The role must possess the specific permission string required by the route/action.

## Authentication and Permissions
- Relies on opaque session token hash validation.
- Staff sessions are strictly separated from customer sessions (Customer session cannot access admin endpoints).
- Permissions are evaluated dynamically against the database.

## Error Handling
- `403` responses must be generic and safe: `{"error": {"code": "FORBIDDEN", "message": "Permission denied", "request_id": "..."}}`.
- Do not log or leak details to the client about why the permission was denied.
- Securely log the denied access event internally with the associated `request_id` for audit purposes.

## Loading / Empty / Failure States where applicable
- **Frontend:** Permission denied surface blocks navigation entirely. Direct URL access shows a generic "Permission Denied" message without providing resource context or details.

## Edge Cases
- **Role Revocation Race Condition:** If an admin's role is revoked while a request is in flight, the live DB lookup in the middleware will catch it and deny the request immediately (AC-13).
- **Overlapping Roles:** If multiple roles are assigned, permissions are additive.
- **Non-existent Permission Check:** If a developer secures an endpoint with a permission string that doesn't exist in the database, it must fail closed (Deny).

## Acceptance Criteria
- Unauthorized requests have no side effects and return `403 Forbidden`.
- Revoking a role blocks the very next request from that user via live DB check.
- Redacted fields are entirely absent from the response JSON payload.
- Accessing admin endpoints with a customer session returns `403 Forbidden`.
- Reference protected endpoint behaves correctly under permitted, unauthorized, and unauthenticated scenarios.

## Testing Requirements
- **Integration Test:** Revoke-then-request scenario to prove immediate security impact.
- **Matrix-driven tests:** Parameterized authorization tests validating various roles against various endpoints.
- **DTO serialization test:** Assert restricted fields are completely stripped from the JSON response.
- **Separation of Concerns:** Test that customer sessions cannot access the admin reference endpoint.

## Dependencies
- **E02-01** (Admin login and admin shell)
- **F00-04** (Authorization hooks and append-only audit)

## Migration or Backward Compatibility Considerations
- Seeding the permission matrix requires a database migration to insert base roles (e.g., `Store Owner`, `Manager`, `Support`) and their exact granular permissions.
- Must not affect existing customer user accounts or customer endpoint access.

