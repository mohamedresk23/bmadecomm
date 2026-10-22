# E04 contract and completion reconciliation (A4)

Recorded: 2026-10-22. Documentation baseline: `4996187c5af630776141193e1f89a5bec9ea38d2`.

## Precedence and purpose

This is an explicit amendment to the older E04-03/E04-04 canonical kernels and implementation contracts, limited to the discrepancies below. It records approved story decisions and historical evidence identified by [retrospective F4/A4](epic-4-retro-2026-10-21.md). For these discrepancies, apply the accepted story scope summarized here instead of the superseded earlier wording. Other requirements retain their existing precedence. Original frozen intent, historical checklists and historical walkthrough recommendations remain intact.

This amendment does not approve a new feature, broaden public access, rerun historical checks, close the broader epic, or change the retrospective's rejected aggregate verdict. It is documentation reconciliation only.

## Accepted delivery contract

| Topic | Superseded earlier expectation | Effective accepted contract | Primary evidence |
|-------|-------------------------------|-----------------------------|------------------|
| Public catalog images | Image contract scope, backend/storage paragraph and public projection paragraph assign public promotion/serving to E04-04 | E04-04-05 exposes image metadata only: attachment id, position and altText. No media IDs, filenames, storage keys, admin preview URLs, public content route or private bytes. Public image-byte delivery remains future explicitly scoped work; E04-04 is not an authorization to implement it. | [Story 405 frozen Always/Never and Design Notes](spec-4-405-public-catalog-slug-resolution-301-redirects-and-draft-isolation.md) |
| Slug and SEO writing | Publication contract section 3.1 proposes `PUT /api/catalog/products/[id]/seo` and a dedicated `product.seo_update` audit event | The editor saves through existing validated product POST `/api/v1/admin/catalog/products` and PUT `/api/v1/admin/catalog/products/[id]`. Reuse existing validation, slug uniqueness, redirect logic and the product writer's transactional audit; do not introduce the parallel SEO mutation endpoint or require its proposed dedicated audit event. | [Story 406 frozen Always/Never](spec-4-406-staff-admin-ui-for-publication-checklist-slug-and-seo-editing.md) |
| Publication schema numbering | Publication contract section 1 and section 4 item 1 refer to migration 0017 | The accepted publication schema migration is `0018_product_publish_slug_seo.sql` with its corresponding down migration. Older 0017 numbering is superseded for this feature, not a request to rename/reapply migrations. | [Story 401 frozen Intent/Constraints, completed tasks and verification](spec-4-401-schema-migration-for-slug-seo-fields-and-slug-redirects.md) |

Privacy follow-through: [A1 evidence](verification-a1-catalog-media-publication-privacy.md) and [operational documentation](../../docs/catalog-media-privacy.md) record rejecting generic publication for all retained catalog-owned attachments, regardless of product status. The older draft-only generic-publication guard wording must not be treated as permission to publish catalog bytes once a product is published. Noncatalog media compatibility remains governed by A1. Private preview remains authenticated; metadata-only public product reads do not make the original image bytes public.

The image contract's testing-history sentence about preserving public historical URLs is a conditional expectation for a future explicitly approved byte-delivery lifecycle. It is not evidence that this metadata-only delivery creates or serves those URLs, and cannot override A1's withdrawal of legacy public catalog copies. Future ownership, delivery and historical URL policies require their own explicit scope.

## Completion evidence index

| Record | Historical discrepancy | Current interpretation and evidence |
|--------|------------------------|-------------------------------------|
| [Story 302](spec-e04-03-02-gallery-read-and-private-preview.md) | Frontmatter says done, while nine original implementation boxes are unchecked; its [walkthrough](walkthrough-e04-03-02.md) still records the earlier review/ready-for-human-acceptance stage | Existing acceptance frontmatter and the Human Acceptance note explicitly record user approval dated 2026-10-15; story and scoped sprint lifecycle are done. Preserve the unchecked historical checklist and earlier walkthrough recommendation rather than invent task-by-task completion records. The walkthrough and [verification report](verification-e04-03-02.md) supply historical technical evidence; this amendment records existing acceptance, not a new acceptance or test run. |
| [Story 303](spec-e04-03-03-upload-draft-image.md) | Original frontmatter still says review despite later recorded completion | Align original frontmatter to done using [walkthrough section 4](walkthrough-e04-03-03.md), which explicitly records verified, approved and done, the [completed remediation](spec-e04-03-03-upload-review-remediation.md), and the scoped sprint story entry. Keep the original body and frozen scope as history. |
| E04-03-01..07 and E04-04-01..06 | All 13 scoped stories were done when the retrospective ran, while aggregate acceptance was rejected | Story lifecycle completion is distinct from aggregate acceptance. Preserve the retrospective's verdict and its open verification obligations; do not reopen stories from stale checkboxes or close the whole epic based on this scoped list. |

The [sprint file](sprint-status.yaml) is live tracking and may contain concurrent changes from other work. This amendment corrects only A4 and the cited original story lifecycle record; it neither endorses nor rewrites unrelated epic/story status changes.

## Evidence limits

Historical reports contain the checks their authors recorded, not newly executed results. This change verifies links, documented scope, retained frozen blocks and bounded diffs. It does not establish production storage delivery, real-browser accessibility or additional PostgreSQL race evidence. A5 remains separate. See [A2 packaging evidence](verification-a2-gallery-worker-packaging.md) and [A3 controls evidence](verification-a3-published-gallery-controls.md) for those later corrections and their own verification limits.
