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
