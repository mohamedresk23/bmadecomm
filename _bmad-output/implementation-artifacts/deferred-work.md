- source_spec: none
  summary: Store Owner Payment Methods Management UI (/admin/settings?tab=payments) (E03-03-02)
  evidence: Split from E03 to maintain vertical slice standards and ensure isolated review of admin API and DB foundations first.

- source_spec: none
  summary: Storefront Payment Metadata & Server-Side Checkout Eligibility Engine (E03-03-03)
  evidence: Split from E03 to ensure public metadata and checkout eligibility engine are layered on top of verified admin APIs.

- source_spec: none
  summary: Versioned Financial and Operational Policies (E03-04)
  evidence: Split from E03 as it represents an independent feature deliverable for financial and operational policies.


- source_spec: none
  summary: Product and Variant Drafts (E04-02)
  evidence: Split from Epic 04 to deliver category management foundation as an independent vertical slice.

- source_spec: none
  summary: Product Images & Media Management (E04-03)
  evidence: Split from Epic 04; depends on product drafts and media storage foundation.

- source_spec: none
  summary: Publish, Slug Redirects & SEO Metadata (E04-04)
  evidence: Split from Epic 04; depends on product drafts and images.

- source_spec: none
  summary: Product Duplicate, Archive and Delete Lifecycle (E04-05)
  evidence: Split from Epic 04; depends on product publish and catalog lifecycle.

- source_spec: `spec-e04-02.md`
  summary: Stabilize the existing staff TOTP replay test across time-step boundaries.
  evidence: staff-auth.test.ts regenerates otp(f.seed) for each replay assertion; crossing its 30-second window generates a genuinely new permitted code. The final full run exposed this once; all 20 unchanged auth tests passed on isolated rerun. Reuse the original code in the replay assertion in a separate authentication-test change.

- source_spec: `_bmad-output/implementation-artifacts/spec-e04-03-01-secure-media-preparation.md`
  summary: Make legacy explicit media publication expose complete public files atomically.
  evidence: Baseline storage.publish used fs.copyFile directly into the publicly served destination; current exclusive writing prevents overwrite but retains this pre-existing exposure window. Stage and atomically expose complete bytes in a separately scoped reliability change.
- source_spec: `_bmad-output/implementation-artifacts/spec-e04-03-01-secure-media-preparation.md`
  summary: Define and implement serialized concurrent publication of the same pending media record.
  evidence: Baseline selected status, copied bytes and updated status without a lock. Current exclusive creation safely rejects a concurrent collision; sequential idempotency is verified, concurrent idempotency is not. A separate transaction/locking design and race test must settle concurrent publication behavior.

- source_spec: `_bmad-output/implementation-artifacts/spec-e04-03-03-upload-draft-image.md`
  summary: Production Orphan Media Discovery and Automated Reaper
  evidence: In E04-03-03, handled transaction aborts delete private staged files immediately via catch blocks, and un-deleted files are recorded in an append-only audit log (.local/orphans.log). However, an abrupt process crash (SIGKILL/power failure) prior to DB commit may leave unreferenced orphan files in private storage without application log execution. An administrative periodic background reaper is required for production readiness to reconcile storage bytes against the media table and purge stale unreferenced files (> 1 hour old).
