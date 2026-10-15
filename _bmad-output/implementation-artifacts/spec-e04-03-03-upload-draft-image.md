---
title: 'E04-03-03: Upload a Draft image with safe retry'
type: feature
created: '2026-10-15'
status: review
route: dispatch
story_id: E04-03-03
epic_num: 4
story_num: 303
story_key: 4-303-upload-a-draft-image-with-safe-retry
baseline_commit: 6ec6dc85adad4d3b551f293feca26733a020c7ed
adopted_decisions:
  max_active_images_per_product: 10
  rate_limit:
    attempts: 20
    window_seconds: 600
    scope: staff_user_all_sessions_and_products
    status_code: 429
    retry_after_header: true
  idempotency_window:
    window_hours: 24
    post_expiry_policy: reject_do_not_delete_or_reuse
  orphan_cleanup:
    policy: option_a_immediate_cleanup_and_audit_logging
    deferred_reaper: recorded_in_deferred_work_for_production_readiness
approval:
  date: '2026-10-15'
  decision: approved_for_implementation
context:
  - AGENTS.md
  - _bmad-output/implementation-artifacts/epic-4-context.md
  - _bmad-output/planning-artifacts/stories/stories-e04-03-product-images/stories.md
  - _bmad-output/specs/spec-e04-03-product-images/SPEC.md
  - _bmad-output/specs/spec-e04-03-product-images/implementation-contract.md
  - _bmad-output/implementation-artifacts/verification-e04-03-02.md
  - _bmad-output/implementation-artifacts/walkthrough-e04-03-02.md
---

<frozen-after-approval reason="owner approval gates ready-for-dev and execution">

## Intent

**Problem:** Authorized staff can view empty and seeded product galleries in Draft status (E04-03-02), but they cannot attach new images to a Draft product directly from the admin interface. Network interruptions during uploads risk creating duplicate attachments, inconsistent sort orders, or leaking orphaned files.

**Approach:** Deliver product-scoped multipart upload (`POST /api/v1/admin/catalog/products/{id}/images`) with actor/product-scoped idempotency keys (`operation_keys`), raw incoming byte hashing, staff-wide rate limiting (20 attempts / 10 minutes), capacity enforcement (max 10 active attachments), off-transaction private image processing through the Story 01 worker, transactional append under product row lock (`FOR UPDATE`), atomic single-transaction completion, 24-hour key expiry guards, safe orphan compensation on failure, and admin UI upload controls with retry support.

---

## Approved Acceptance Criteria (Original Baseline)

*Note: Preserved verbatim from `stories-e04-03-product-images/stories.md:110` without unapproved modifications.*

1. **AC 1:** **Given** a saved Draft and valid file, **When** staff uploads, **Then** 201 returns one image plus gallery, appended at the next position with one audit/revision increment **And** reload displays the protected thumbnail without publication.
2. **AC 2:** **Given** an unsaved product or a published/archived product, **When** attaching, **Then** unsaved UI requires saving first and non-Draft writes fail without mutation.
3. **AC 3:** **Given** parallel identical keys/files or a lost response, **When** upload is retried, **Then** one attachment/audit commits; reused key with different file returns 409; replay rechecks live authorization.
4. **AC 4:** **Given** concurrent uploads near the accepted capacity or exhausted adopted shared rate limit, **When** they execute, **Then** capacity is never exceeded and 429 provides Retry-After when applicable.
5. **AC 5:** **Given** injected storage/DB/audit failure or duplicate staging, **When** attachment cannot commit, **Then** no false success or public file appears; staged orphans are deleted via immediate compensation, and if deletion fails, are recorded in `.local/orphans.log` for maintenance reconciliation without disclosing internal paths to clients. (Unrecorded orphans from abrupt hard process crashes prior to commit are documented under deferred maintenance reaper).

---

## Architectural Design & Protocols

### 1. Request Lifecycle & Transaction Boundaries

The full sequence decouples CPU-bound image processing from database connections while enforcing strict cross-process idempotency and fencing:

```
[Client Request]
       │
       ▼
[1. Auth & Request Bounding]
  - requireCatalogStaffSession (staff session & catalog permission)
  - CSRF Token & Origin validation
  - Stream Bounding: abort if > 5,308,416 bytes (5,242,880 file + 65,536 framing)
  - Stream Timeout: 15s body read deadline
  - Compute raw incoming payload footprint:
      fileBytesHash = sha256(rawIncomingBytes)
      payload = { fileBytesHash, filename, mimeType, size: rawIncomingBytes.length }
      payloadHash = sha256(canonicalJson(payload))
       │
       ▼
[2. Durable Key Reservation & Replay Check (DB Tx #1: < 5 ms)]
  - Query operation_keys for (actor, operation, key)
  - IF completed_at IS NOT NULL:
      * IF created_at > 24h ago: RETURN 409 Conflict (Key Expired)
      * IF payload_hash != payloadHash: RETURN 409 Conflict (Payload Mismatch)
      * IF match: RETURN 201 Cached Result (0 rate quota consumed)
  - IF completed_at IS NULL (In-Progress by another worker):
      * IF now - created_at < 15s (Active Lease):
          WAIT / POLL every 250ms (up to 15s) for completion; RETURN 201 or 409
      * IF now - created_at >= 15s (Stalled / Zombie Lease):
          Take over reservation atomically with new leaseToken = randomUUID():
          UPDATE operation_keys SET id = leaseToken, created_at = now(), payload_hash = payloadHash
          WHERE actor = actor AND operation = operation AND key = key AND completed_at IS NULL
  - IF key does not exist:
      * INSERT INTO operation_keys (id = leaseToken, actor, operation, key, payload_hash, completed_at = NULL, created_at = now())
  - Check & Consume Rate Quota (20 attempts / 600s per staff):
      * IF attempts > 20: DELETE uncompleted reservation row, RETURN 429 with Retry-After
  - [COMMIT Tx #1] -> Connection returned to pool immediately!
       │
       ▼
[3. Off-DB Image Processing (No DB Connection)]
  - Spawn isolated child worker (image-process.ts)
  - Validate: <= 4096px per dimension AND <= 8M total pixels
  - Enforce static JPEG/PNG/WebP, strip EXIF metadata
  - Strict 10-second processing deadline (child killed on timeout)
       │
       ▼
[4. Atomic Persistence Transaction (DB Tx #2: < 15 ms)]
  - Begin Transaction
  - Global Canonical Lock Ordering (Deadlock-Free):
      Step 4a: Lock Product row:
               SELECT id, status, media_revision FROM products WHERE id = $productId FOR UPDATE
      Step 4b: Lock Operation Key row:
               SELECT id, payload_hash, completed_at FROM operation_keys
               WHERE actor = $actor AND operation = $operation AND key = $key FOR UPDATE
  - In-Transaction Fencing & Re-verification:
      * Verify product.status === 'draft' (else 409 Conflict)
      * Verify active attachment count < 10 (else 422 Unprocessable Entity)
      * Verify key.id === leaseToken (Fencing Token Check: if mismatch, a newer process took over; ABORT!)
      * Verify key.completed_at IS NULL
      * Verify key.payload_hash === payloadHash
  - Write private storage: storage.writePrivate(filename, processedBytes)
  - Insert media row (status: 'pending')
  - Insert product_media row (sort_order = max + 1)
  - Increment products.media_revision
  - Insert audit_events row
  - Update operation_keys SET result = $resultJson, completed_at = clock_timestamp() WHERE id = leaseToken
  - Commit Transaction -> [COMMIT Tx #2]
       │
       ▼
[5. Ambiguous Commit Resolution (if network drops during COMMIT)]
  - If COMMIT throws connection error (ECONNRESET/ETIMEDOUT):
      * Query operation_keys via fresh connection
      * IF completed_at IS NOT NULL -> Success! Keep file, return 201 result
      * IF completed_at IS NULL / absent -> Rolled back! Delete file via storage.deletePrivate, return 500
```

---

## Rate Quota & Concurrency Coupling

- **Rule:** Quota is consumed ONLY upon establishing ownership of a real processing attempt (Tx #1).
- **Waiting Requests:** Concurrent duplicate requests that detect an active lease (`completed_at IS NULL` and `< 15s`) enter a wait/poll state. They do **NOT** consume rate quota.
- **Completed Replays:** Completed idempotent replays return the cached response immediately and do **NOT** consume rate quota.
- **Failed Processing / Stalled Reclaims:** If a worker fails during image processing (corrupt file, 10s timeout), the rate quota slot remains consumed (protecting server CPU from infinite bad-file retry loops), and the uncompleted reservation row is deleted from `operation_keys` so the staff member can retry with a valid file.

---

## Resource Bounds & Server Protection Matrix

| Vector | Protection Mechanism | Limit / Threshold | Behavior on Breach |
|---|---|---|---|
| **Slowloris / Request Drip** | Bounded body read deadline | 15 seconds | Connection aborted; 408 Request Timeout. |
| **Oversized Upload Payload** | Stream byte counter | `5,308,416` bytes (`5,242,880 + 65,536`) | Stream canceled (`req.body.cancel()`); 413 Payload Too Large. |
| **Worker Process Flood** | Active worker semaphore | Max 4 concurrent child workers per instance | Excess requests wait up to 15s in FIFO queue, then 503 Server Busy. |
| **Staff Flood Abuse** | Shared `upload_rate_buckets` | 20 attempts / 600 seconds per staff user | 429 Too Many Requests with `Retry-After: <seconds>`. |
| **DB Pool Starvation** | Off-DB Processing Architecture | 0 DB connections held during decode/re-encode | DB pool connections held only during Tx #1 (<5ms) and Tx #2 (<15ms). |

---

## Detailed Fate of Key & Error Handling

| Scenario | HTTP Code | `operation_keys` State | Rate Quota Consumed? | Can Retry with Same Key? |
|---|---|---|---|---|
| **Auth / Stream Failure** | 401 / 403 / 413 / 429 | No row written. | No (except 429). | Yes. |
| **Image Processing Failure** | 415 / 422 / 504 | Row deleted from `operation_keys`. | Yes (CPU consumed). | Yes (with valid file). |
| **Storage Write Failure** | 503 / 500 | Tx #2 rolled back; row deleted; partial bytes removed. | Yes. | Yes (after disk space restored). |
| **Capacity (10 images) / Non-Draft** | 422 / 409 | Tx #2 rolled back; row deleted; staged file removed. | Yes. | Yes (after gallery modified). |
| **Fencing Token Mismatch (Zombie)** | 409 Conflict | Row owned by newer worker; zombie aborted; file removed. | Yes (by original). | Handled by winning worker. |
| **Ambiguous COMMIT Drop** | 201 or 500 | Resolved via DB probe. Kept if committed; cleaned if aborted. | Yes. | Handled safely. |
| **Expired Key (> 24h)** | 409 Conflict | Row permanently retained; marked expired; never reused. | No. | No (must generate new key). |

---

## Orphan Cleanup & AC 5 Scope Options

### The Technical Reality:
1. When transaction rollback is confirmed in application flow, `storage.deletePrivate(filename)` is executed. However, filesystem deletion is not mathematically guaranteed (e.g. `EPERM` / `EBUSY` on Windows locks, or disk failure).
2. If the Node.js process crashes abruptly (SIGKILL, power failure) between writing the file and completing Tx #2, the private file remains on disk while PostgreSQL rolls back.

### Decision for Owner Review:

- **Option A (Current Scope with Maintenance Logging):**
  - Implement immediate best-effort deletion in `catch`.
  - If `deletePrivate` fails, log the orphan filename and path to an append-only audit file (`.local/orphans.log`) with request correlation ID.
  - Defer physical sweep/reconciliation to an administrative maintenance reaper outside Story 03.
  - *Proposed AC 5 amendment:* `"Given injected failure, When attachment cannot commit, Then no false success/public file appears, and new staged orphans are safely cleaned or recorded in maintenance logs."*

- **Option B (Expand Story 03 Scope to Include Reaper):**
  - Implement an in-process startup/periodic reconciliation job that scans private storage, checks for matching `media` records, and removes unreferenced files older than 1 hour.
  - Increases Story 03 scope, files, and test requirements.

---

## Test Execution Matrix (Planned vs. Executed)

### Executed Tests (from E04-03-02 baseline):
- `route.test.ts`: 8 tests passed (read-only gallery, preview streaming, session 401/403, 404 foreign/deleted, 503 missing storage).
- `product-gallery.test.tsx`: 6 tests passed (UI loading, empty, populated, retry).
- `scripts/verify-gallery-schema.ts`: Real PostgreSQL 18.6 verification passed (exit 0).

### Planned Tests for E04-03-03:
1. **Multi-Process Concurrency Test (`scripts/verify-gallery-upload-concurrency.ts`):**
   - Two independent Node.js processes running concurrently with the exact same `Idempotency-Key` and file bytes.
   - Asserts: Exactly one process executes processing and attaches; second process waits and receives the exact same 201 result; exactly one attachment and one audit row exist in PostgreSQL.
2. **Zombie Fencing Test:**
   - Simulate Worker 1 stalling > 15s. Worker 2 reclaims the reservation with a new lease token. Worker 1 resumes and attempts to commit -> asserts Worker 1 is rejected with 409 Fencing Conflict, and cleans up its file.
3. **Slot 10 Capacity Race:**
   - Gallery seeded with 9 images. Two concurrent uploads race for the 10th slot.
   - Asserts: Exactly one upload succeeds (`sort_order = 9`); second upload fails with `422 Unprocessable Entity`. Total active attachments = 10.
4. **Footprint Divergence Test:**
   - Reused key with different raw incoming bytes -> asserts `409 Conflict ("Idempotency payload mismatch")`.
5. **Rate Limiting & Quota Exemption Test:**
   - 20 uploads within 10 minutes succeed; 21st upload returns `429` with `Retry-After`.
   - Replaying a completed 201 upload returns 201 without consuming rate quota.
6. **Cleanup Failure & Ambiguous Commit Test:**
   - Injected database failure after file write: asserts file is deleted.
   - Injected `deletePrivate` failure: asserts failure is recorded in orphan log without disclosing paths to client.
   - Ambiguous commit simulation: asserts DB probe resolves state correctly.
