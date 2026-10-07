# Implementation Stories: E02-02 (Action and field permission enforcement)

These stories break down the E02-02 implementation spec into small, independently testable vertical slices, suitable for one AI coding session each.

---

### Story: E02-02-1 — Database Seed & Live Evaluation Middleware
- **Objective:** Establish the foundation for role-based access control by implementing a live database lookup middleware and seeding the initial permission matrix.
- **Scope:** 
  - Seed the base roles (e.g., Store Owner, Manager, Support), permissions, and `user_roles` mappings (based on OQ-08).
  - Implement the `requirePermission(action, resource)` backend middleware/hook. This must perform a live DB check against the authenticated admin session on every request, ensuring no cached grants bypass security.
  - Create a protected reference test endpoint `GET /api/v1/admin/test-protected` to validate the middleware logic.
- **Dependencies:** E02-01 (Admin login), F00-04 (Authorization hooks base).
- **Affected Layers:** Backend, Database.
- **Acceptance Criteria:**
  - The middleware successfully parses the active session and checks live DB permissions.
  - The test endpoint returns `403 Forbidden` (with standard safe JSON) for unauthorized staff and customer sessions.
  - The test endpoint returns `200 OK` for authorized staff.
  - Revoking a role blocks the very next request from that user.
- **Test Expectations:** 
  - Integration test demonstrating the "revoke-then-request" race condition (AC-13).
  - Matrix-driven authorization tests verifying access for different seeded roles against the test endpoint.

---

### Story: E02-02-2 — Field Redaction Utility & Response Formatting
- **Objective:** Prevent unauthorized data leakage in API responses by redacting specific fields at the DTO serialization level.
- **Scope:** 
  - Create a utility function `redactResponse(payload, userPermissions)` that strips unauthorized fields from outgoing JSON objects before they are sent to the client.
  - Update the reference test endpoint (`GET /api/v1/admin/test-protected`) to return a mock complex object containing both public and sensitive fields, proving that the redaction works dynamically based on the caller's role.
- **Dependencies:** E02-02-1.
- **Affected Layers:** Backend.
- **Acceptance Criteria:**
  - Sensitive fields are completely stripped (absent from the JSON key space, not just nulled out) when the caller lacks the required field-level read permissions.
  - Authorized fields remain untouched.
  - Deeply nested fields can be targeted and redacted successfully.
- **Test Expectations:** 
  - Unit tests for the DTO serialization utility asserting that restricted fields are completely removed for unauthorized roles, and kept intact for authorized roles.

---

### Story: E02-02-3 — Generic Error Handling & Client-Side Routing Guards
- **Objective:** Standardize the frontend handling of `403 Forbidden` responses and block unauthorized navigation, aligning the UI with backend enforcement.
- **Scope:** 
  - Implement a global API interceptor on the frontend to catch `403` and `401` responses and route users to a safe, generic "Permission Denied" surface.
  - Add client-side route guards and navigation visibility toggles matching backend permissions, ensuring users do not see links to areas they cannot access (UX-07).
- **Dependencies:** E02-02-2.
- **Affected Layers:** Frontend.
- **Acceptance Criteria:**
  - Direct URL access to an unauthorized admin route shows the generic "Permission Denied" message without flashing or leaking restricted data.
  - The main admin shell navigation correctly hides items the logged-in role cannot access.
  - The frontend properly interprets the standard safe JSON error payload without crashing.
- **Test Expectations:** 
  - E2E or Component tests verifying that a user with restricted roles does not see hidden navigation items.
  - Test verifying that a direct URL hit to an unauthorized page displays the "Permission Denied" boundary.

