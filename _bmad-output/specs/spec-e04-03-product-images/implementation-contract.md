# E04-03 implementation contract

> **Precedence notice (2026-10-22, A4):** The [accepted delivery amendment](../../implementation-artifacts/e04-contract-reconciliation-2026-10-22.md) supersedes this document's scope/backend/public-projection statements that assign public image promotion or serving to E04-04. That delivery exposes image metadata only; public bytes remain future explicitly scoped work. A1 also supersedes the draft-only generic-publication guard with protection for all retained catalog ownership. Preserve other requirements and the historical wording below.

> The later testing-history reference to public historical URLs is conditional future scope, not a supported feature or an exception to A1 in the accepted metadata-only delivery; see the same amendment's privacy clarification.

Created 2026-10-14. Requirements below are derived from the memlog and linked sources. Endpoint names, schema layout and revision handling are spec-level design decisions; numerical policies marked proposed need adoption. No code or migration is implemented by this document.

Owner decisions recorded in the canonical memlog supersede earlier proposed references below: multipart total <=5,308,416 bytes with independent file maximum 5,242,880; <=4096 pixels per dimension AND <=8,000,000 pixels total; static-only, rejecting animated WebP/APNG; processing deadline ten seconds with actual termination/temporary cleanup and no partial persistence. Local development only; separate store deployments/databases/storage; legacy routes Owner-only. Logo CSRF adaptation is a separate prerequisite authorized for execution; this does not authorize image-story implementation. Count/alt/JSON/rate and production storage/retention remain open.

## Objective and scope

Deliver original **E04-03 — Product images** as a frontend/backend/database slice: attach validated images through F00-07, display a private gallery, reorder, edit alt text, select variant images and soft-remove attachments. Use the existing Products admin page (`/admin/catalog/products`) as the A-03/A-04 entry point. New products must first be saved as Draft and have persisted variant IDs before image operations become available.

Out of scope: publication controls and storage promotion orchestration (E04-04), duplication/archive/delete (E04-05), storefront gallery rendering (E06-03), inventory, pricing changes, SEO, bulk import, image transformations UI, and retention deletion jobs. Supply the readiness and read contracts those stories need.

## Source mapping

| Requirement | E04-03 obligation | Verification |
|---|---|---|
| FR-15 | Main image, ordered gallery, safe rejected uploads | IMG-01/02/03/08 |
| FR-13; FR-12 | Optional variant image, correct ownership; future selected-variant image fallback | IMG-04; storefront rendering deferred |
| FR-14; FR-09; AC-19 | Image editing within Draft workflow; no draft discovery or private media leakage | IMG-05/09 |
| FR-55/56; original E04-03 AC | Retain media and historical references when gallery attachment is removed | IMG-06/10 |
| FR-56; AC-20 | Size/type/content checks, no execution or publication of rejected bytes | IMG-01/02/05 |
| FR-06/07; NFR-12; AC-13 | Live staff sessions, deny unauthorized requests, CSRF/Origin, safe logs | IMG-05 |
| FR-57/58; AD-10 | Server validation, IDs/FKs, UTC timestamps, explicit errors, stale-write/retry contracts | IMG-07/08/09 |
| FR-45; AD-15 | Audit committed with each gallery mutation | IMG-08 |
| NFR-08/09; UX A-04, TF-2 | RTL, keyboard operation, accessible upload/error/loading states, supported formats | IMG-03/11; launch targets remain proposed |
| NFR-14; AD-14/16 | Additive migration, rollback evidence, durable production storage | IMG-12; provider adoption gated |

FR-14 is covered only for images; this slice does not claim completion of lifecycle management. AC-19 history and AC-20 log obligations apply to this slice, not the entire commerce system. AC-23 specifies order transitions: gallery stale-write protection is derived from FR-58, without claiming AC-23 completion.

## Current project context and dependencies

| Evidence in repository | Consequence for implementation |
|---|---|
| `implementation-artifacts/spec-e04-02.md` records original numbering, done status and PostgreSQL verification | Build on existing product/variant drafts; do not implement proposed decomposed E04-03 again |
| `src/db/schema.ts`, migration `0014_product_drafts.sql` | Products, variants, attributes and category links exist; product media tables do not |
| `src/modules/catalog/products/application/product-service.ts` | Product aggregate reads use one SQL snapshot; edits lock the product and delete/reinsert variants, retaining selected IDs |
| `src/lib/media/upload.ts`, `storage.ts`, migration `0004_media_storage.sql` | F00-07 provides 5 MiB checks, MIME sniffing, sharp re-encoding, pending/active metadata and local private/public files |
| `src/app/api/media/upload/route.ts`, `publish/route.ts` | Upload trusts `x-mock-user` before session resolution; publish relies on that header. Neither is safe to reuse unchanged |
| `src/components/Upload.tsx` | Sends mock permission headers and auto-publishes for preview; adapt or replace this behavior before catalog use |
| `src/modules/content/settings/infrastructure/admin-auth.ts` | Reuse `requireCatalogStaffSession`; current allowed roles: owner, staff, catalog_manager, catalog |
| `src/shared/api`, `shared/authz/audit.ts`, `shared/idempotency/execute.ts`, `src/db/tx.ts` | Reuse error handling, bounded JSON, audited transactions and actor-scoped operation keys |

Required dependencies: original E04-02 persisted Drafts and variants, F00-07 media processor/storage adapter, E02 staff identity/session/audit foundation, F00-02 transactions/migrations, F00-03 error conventions, F00-06 idempotency. E03-01 settings remain an existing dependency of product creation; image operations do not reinterpret money. Full database-backed permission grants are absent from the current framework; do not invent their completion here. Final grant policy remains OQ-08.

The compiled `epic-4-context.md` and proposed decomposed stories use different numbering. User confirmation selects original stories E04-03; decomposed E04-06 plus E04-07 are the corresponding image work. Keep upstream documents unchanged.

## Business rules and validation

1. Server owns product identity/status, file storage key, media MIME/size/status and gallery positions. Only existing Draft products accept image mutations in this slice; unknown product is 404, other lifecycle states 409.
2. Upload exactly one nonempty file/request. Allow JPEG, PNG and WebP only, matching decoded content. Reject declared type or recognizable extension that contradicts detected content; filenames never become executable storage paths. Sniffing alone is insufficient: malformed/truncated and undecodable content must fail. Reject SVG/HTML/PDF/executable content, strip metadata and re-encode to a safe supported format.
3. Preserve F00-07's exact current input limit `5 * 1024 * 1024` bytes. Proposed gallery maximum is 10 active attachments/product; enforce under product lock, including concurrent uploads. Adopted total multipart bound is file limit + 64 KiB framing overhead; JSON bound remains proposed at 64 KiB. Bound streamed input before materializing it; do not trust Content-Length. Decode only static inputs within <=4096 per side AND <=8M total pixels; actual processing must terminate within the adopted ten-second deadline, with scoped cleanup and no partial result. No silent animation flattening.
4. Gallery IDs are opaque existing repository-style IDs, at most 80 characters, with no control characters. Strict schemas reject unknown writable fields, duplicate IDs, malformed lists, invalid UTF-8/Unicode text and client-supplied URLs/paths/status/actor. All IDs must belong to the authorized product.
5. Active gallery positions are contiguous, zero-based and unique per product. First active attachment is primary; no independent primary flag. Upload appends; removal compacts; reorder includes each currently active attachment exactly once.
6. Alt text is plain Unicode text, trimmed, proposed maximum 500 characters, no NUL/control characters; never interpreted as markup. Draft may store an empty string. A readiness helper returns one field error per active attachment with blank alt; it does not change publication status or require at least one image unless the later publishing contract explicitly does so.
7. A variant optionally maps to one active attachment on its own product; one attachment may map to several variants. Unmapped variants fall back to the primary attachment; an empty gallery returns null rather than a broken URL.
8. Removal soft-removes only the product attachment, clears current variant mappings to it, compacts ordering and retains file/media row. Never mutate order snapshots or physically delete shared/historical bytes.
9. Images cannot be imported by arbitrary media ID or external URL. Product-scoped upload creates and links the media resource, preventing cross-resource attachment of unrelated files. Legacy unscoped media remains unattached unless a later controlled migration supplies ownership.
10. Successful changes write actor/action/product/attachment identifiers, redacted before/after metadata and request ID in the same transaction. No-op retries do not create duplicate audits. Log no session token, file bytes or sensitive EXIF.

Policies inherited from NFR-09/A-11 and architecture's proposed upload rate remain proposed: use a shared atomic limiter for 20 files/10 minutes/authorized actor if adopted; return 429 with Retry-After. Do not invent final IP or retention thresholds. Release requires adoption and abuse-test evidence for unresolved numeric policies.

## Frontend requirements and states

- Extend the persisted Draft editor with a labelled image section: supported formats/limit guidance, file selector, thumbnail gallery, position/primary indicator, alt input, variant image selector, remove and Save gallery. Preserve existing RTL Arabic conventions and visual tokens; no new design system.
- Upload and removal are immediate persisted operations; order/alt/mapping edits are local until Save gallery. Block them while conflicting operations are pending, or require saving/discarding local gallery edits first. Warn before leaving/replacing dirty gallery state, preserving it when cancelled. Never silently save or discard unrelated product fields.
- Use buttons such as Move earlier/Move later for keyboard/touch reordering; drag may supplement them. Keep logical image order independent of RTL direction. Maintain visible focus and announce reorder, upload and save results via accessible status text. Remove confirmation must explain detachment and mapping fallback without suggesting historical deletion.
- Variant selection shows stable SKU/attribute labels and persisted variant IDs. Do not allow mappings to unsaved generated rows. After variant edits, reload gallery/mapping state and show any cleared mappings.
- **Loading:** reserve thumbnail space, show gallery loading and disable writes until IDs/revision arrive. Upload shows busy state; show progress only if measured, otherwise an indeterminate state. Disable duplicate submission.
- **Empty:** “No images yet” plus accessible upload action. New unsaved product: save Draft first. No optional variant image: primary fallback label. No gallery image: neutral placeholder.
- **Validation/failure:** field errors adjacent to upload/alt/mapping and an accessible summary for unmatched/nested errors; focus the summary/first invalid field. Keep entered values. Upload failure leaves existing gallery intact and permits file reselection/retry. Thumbnail failure shows a placeholder/retry without deleting its attachment.
- **Stale/network:** 409 keeps local input and offers reload/review; no automatic overwrite. Unknown upload result is resolved by retrying the same key/file, not starting a second operation. Session expiry pauses writes, retains safe local edits and requires reauthentication; discard/revoke temporary object URLs on replacement/unmount.
- Render at 320/768/1024/1440px with reflow and no hover-only actions. Test keyboard focus, labels, screen-reader feedback and image alternatives; automatic accessibility scanning alone is insufficient.

## Backend and storage requirements

Catalog owns attachment/order/alt/mapping application commands; media processing stays behind the existing storage boundary. HTTP adapters authenticate, enforce CSRF/Origin/body limits, validate DTOs and call application services. Application code must not depend on Next.js. Read gallery/variants/revision from a single statement snapshot or an explicit consistent transaction.

Stage and validate bytes privately outside the short DB transaction. In the transaction, lock product, validate Draft/capacity, lock relevant media rows in stable ID order, then insert media/attachment, increment revision and audit. Storage success without DB success must not yield a successful response or public URL. Compensate orphan staged files when safe, and record unreclaimed resources for operator recovery; cleanup is scoped to the newly allocated key and never touches retained historical media. A crash between stages may leave private orphan bytes, but must never expose a broken committed attachment as success. Document recovery for that boundary and test injected failures.

Private preview needs an adapter read capability: resolve only the filename/storage key from DB after authorization, never accept arbitrary paths; use safe Content-Type, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`. Local storage is permitted for development per F00-07. AD-14's production requirement for durable object storage remains unresolved against the local foundation decision; select no provider in this spec. Missing object bytes return an unavailable response and diagnostic correlation ID, not a broken success payload.

Do not call `publishMedia` or copy Draft bytes into `public/uploads` for previews. Harden existing generic upload/publish entry points so `x-mock-user` never authorizes an HTTP request; tests inject server-side session dependencies instead. Generic publish must not promote product-owned media from a Draft, even for an otherwise authorized actor. A later publication command must perform readiness checks and storage promotion/recovery; this slice supplies the contract but no publish action.

## Database changes

Add the next unused additive migration after 0014; verify numbering at implementation time.

| Change | Required constraints and behavior |
|---|---|
| `products.media_revision` | Nonnegative bigint, default 0; API serializes as integer string; increment once per committed gallery mutation |
| `product_media` | Opaque text PK; product_id FK to products; media_id FK to media; alt_text nonnull default empty; sort_order integer; removed_at nullable timestamptz; created_at/updated_at UTC timestamptz |
| Attachment uniqueness | Unique `(product_id, media_id)`; partial unique `(product_id, sort_order)` for nonremoved rows; nonnegative sort_order; indexes for active ordered reads and reverse media references |
| `variant_media` | variant_id PK (one optional image); product_id and product_media_id required; composite FK `(product_id, variant_id)` to variants; composite FK `(product_id, product_media_id)` to product_media; matching unique keys on target pairs; index attachment reference |
| Lifecycle integrity | Prevent media deletion while referenced (restrict). Soft-remove attachments; application clears mappings under product lock. Same-product FKs supplement application validation; active/not-removed check is transactional |

Product/attachment destructive deletion is outside scope; use restrictive attachment FKs until E04-05 defines safe cleanup. Do not cascade deletion to shared media. No orders table or speculative snapshot migration is required.

Reordering cannot temporarily violate immediate position uniqueness. Use validated temporary distinct positions within the transaction before writing contiguous final positions, or equivalent deferred-safe design. Readers must see only the committed order.

**Critical compatibility:** E04-02 currently deletes all variants and reinserts retained IDs. Adding mapping FKs without changing that path will either fail product saves or erase mappings. Reconcile mappings in the same product transaction: capture existing mappings, remove dependent mapping rows before replacement if necessary, restore only retained variant IDs pointing to still-active attachments, and clear mappings for truly removed variants. Preserve mapped image on SKU/attribute changes when variant ID is retained. Keep product lock ordering identical to gallery commands. No stale foreign IDs can be restored.

## API contracts

Base: `/api/v1/admin/catalog/products/{productId}/images`. All JSON success bodies follow existing `{success:true,...}` conventions. IDs/revisions/time fields are strings; timestamps are ISO UTC. Every response, including errors and previews, is private/no-store.

Gallery DTO:

```json
{
  "success": true,
  "gallery": {
    "productId": "prd_opaque",
    "revision": "2",
    "primaryImageId": "pim_opaque",
    "images": [{"id":"pim_opaque","mediaId":"opaque","position":0,"altText":"Front view","mimeType":"image/webp","size":12000,"previewUrl":"/api/v1/admin/catalog/products/prd_opaque/images/pim_opaque/content"}],
    "variantImages": [{"variantId":"var_opaque","imageId":"pim_opaque"}],
    "publicationIssues": []
  }
}
```

`variantImages` contains explicit assignments only; absent assignment means fallback. Empty gallery has images/assignments empty and primaryImageId null. The preview URL is protected, never a public storage path. Readiness errors use `{field:"images.<attachmentId>.altText",message:"Alt text is required before publication"}`.

| Method/path | Input | Success | Semantics |
|---|---|---|---|
| GET base | No body/filter/pagination | 200 gallery DTO | Active gallery only; bounded by accepted count policy; no removed/history rows |
| POST base | Multipart `file` only; `Idempotency-Key` required | 201 `{success:true,image,gallery}` | Validate privately, append once; client refreshes/reviews local edits before upload |
| PUT base | JSON below | 200 gallery DTO | Atomic full order/alt/mapping replacement; same membership, no implicit attach/remove |
| DELETE `/{imageId}` | JSON `{ "expectedRevision":"2" }` | 200 gallery DTO | Soft-remove, clear assignments and compact order; matching revision required |
| GET `/{imageId}/content` | No body | 200 validated bytes | Authenticated active-attachment preview; absent/removed attachment 404 |

PUT request example:

```json
{
  "expectedRevision":"2",
  "images":[{"id":"pim_opaque","altText":"Front view"}],
  "variantImages":[{"variantId":"var_opaque","imageId":"pim_opaque"}]
}
```

Array order is gallery order. `images` must equal active membership; `variantImages` replaces explicit assignments, so an omitted variant clears its mapping. No duplicate image or variant entries. `expectedRevision` is a nonnegative integer string within bigint range. Under lock, mismatch is 409 `STALE_GALLERY`; reload required. A genuinely unchanged PUT is a no-op with unchanged revision/audit. Product variant changes that alter mapping membership also increment gallery revision.

All mutations require live staff cookie, trusted Origin and `X-CSRF-Token`. GET gallery may return the existing CSRF mechanism's token alongside its DTO, or reuse the Products metadata response; never derive actor/roles from JSON. Correlation ID follows existing request convention. No pricing-revision header is needed for images.

POST idempotency is actor + product + operation scoped; hash actual file bytes and canonical decoded request metadata, not multipart boundary. Reauthorize before replay; same key/same file returns original attachment result, different payload is 409. Use existing operation-key lifetime; do not introduce an unrelated TTL. Staging may precede execution, but concurrent duplicate requests must commit one attachment and one audit; discard redundant staged bytes safely. For PUT/DELETE, successful retry with an old revision may return 409: reload to confirm the committed outcome; never reapply an obsolete full-gallery body automatically.

Internal consumers: ordered active image metadata and optional mapped image lookup, with primary/null fallback; publication-readiness issues for blank alt and missing validated bytes. Public read projection must be selected only after existing published-product filtering and must exclude private preview URLs. Actual public media promotion and serving are E04-04 integration work.

## Authentication, permissions and errors

Require the existing catalog staff session on every gallery/preview request; re-resolve disabled/revoked/expired state before mutation/replay. Customer and guest sessions grant no access. Use current catalog roles as the brownfield baseline, with eventual action/resource/field checks through the existing authorization boundary. No client-generated grant or hidden-button authorization. Before supporting additional roles, resolve OQ-08.

Error envelope remains `{error:{code,message,details:[{field,message}],request_id}}`. Fields are optional only where existing handler permits them; request correlation must be available for operational failures. Details must not contain storage paths, secrets, file contents or resource metadata outside authorized scope.

| Status | Code / condition | Client behavior |
|---|---|---|
| 400 | BAD_REQUEST: malformed multipart/JSON, missing or multiple file parts | Show safe form error |
| 401 | UNAUTHORIZED: absent/expired/revoked session | Pause and reauthenticate |
| 403 | FORBIDDEN: wrong role, Origin or CSRF | No side effects; clear permission feedback |
| 404 | NOT_FOUND: product/active attachment absent or cross-product resource | Do not disclose another product |
| 409 | STALE_GALLERY, CONFLICT: lifecycle state, key/payload conflict | Retain edits, reload/review |
| 413 | PAYLOAD_TOO_LARGE: file or request bound exceeded | Explain permitted limit |
| 415 | UNSUPPORTED_MEDIA_TYPE: spoofed/unsupported or undecodable image | Reject without attachment/publication |
| 422 | UNPROCESSABLE_ENTITY: alt/list/map/count/revision validation | Field errors, unchanged persisted state |
| 429 | RATE_LIMITED when adopted limiter exhausted | Show Retry-After, preserve file/edits |
| 500/503 | INTERNAL_SERVER_ERROR / MEDIA_UNAVAILABLE: DB/storage/processor failure | Safe retry/recovery and request ID; no false success |

Processing timeouts/resource exhaustion must map to a safe failure. DB constraint errors are translated after rollback. An audit write failure rolls back the gallery mutation. Authorization failure precedes multipart decoding/file writes and any resource-sensitive response.

## Edge cases and acceptance criteria

| ID | Given / action | Required result |
|---|---|---|
| IMG-01 | Authorized user uploads valid JPEG/PNG/WebP to saved Draft | Safe re-encoded private image attached once; metadata stripped; reload reproduces gallery; Draft unchanged |
| IMG-02 | Empty, oversized, spoofed, truncated or unsupported file; oversized streamed body | Clear 4xx; no attachment/audit success/public file; existing gallery intact; limit boundary tested |
| IMG-03 | Two images reordered and alt edited with keyboard | Persist exact order/alt; first image primary; reload and accessible feedback correct |
| IMG-04 | Map image to one or many variants; submit foreign/removed image or foreign variant | Valid mappings persist; invalid request atomically rejected; absent mapping uses primary/null fallback |
| IMG-05 | Guest/customer, forged x-mock-user, bad CSRF/Origin, disabled/revoked staff, direct private preview/public path | Access denied without writes or bytes; no Draft public URL or shared-cache leak; generic endpoints cannot bypass guards |
| IMG-06 | Remove primary or mapped image, then last image | Soft-remove and clear relevant mappings; remaining primary/order valid; empty/null state; retained media row/bytes/history |
| IMG-07 | Two staff save same revision; concurrent uploads near limit; double submit/lost response | One stale save rejected, accepted limit never exceeded, same upload key attaches once; different payload key reuse rejected |
| IMG-08 | Inject storage/DB/audit error; fail mid-reorder/mapping/removal | No partial committed aggregate; private staged orphan safely recovered/recorded; each committed mutation has one audit |
| IMG-09 | Network/session error, stale edits, dirty gallery during navigation or product editing | Input retained, no silent overwrite, recoverable accessible state; successful save survives remount |
| IMG-10 | Edit retained variant SKU/attributes; remove variant; image has historical reference | Retained IDs retain mappings, truly removed IDs clear them, historical resource remains resolvable; no new order tables |
| IMG-11 | Draft image has blank alt; staff loads empty/broken-preview gallery on small screen | Draft save allowed, readiness reports field blockers, no publish controls; usable empty/loading/failure states and keyboard/RTL reflow |
| IMG-12 | Existing database upgraded, downgraded in isolated environment and reapplied | Existing product/variant/media data unaffected; constraints/indexes valid; unrelated feature regressions absent |

History guarantee: where order tables are not implemented, use a retained-reference fixture and verify removal never invokes physical media deletion. Once orders exist, the owning story must add an actual order-snapshot regression; a fixture is not evidence that future order integration is complete. Removing from gallery does not revoke public historical URLs for media already published through later lifecycle workflows.

## Testing requirements

- Unit: strict schemas, alt normalization, duplicate/permutation checks, primary/fallback, readiness, MIME mismatch, decode failure, revision parsing and request bounds. Include exact-limit and one-byte-over cases.
- API/service integration: each IMG case, auth before decoding, forged mock-header attempts on both legacy routes, no public promotion on upload/preview, uniform private error headers, missing storage objects, no partial DB/audit writes and upload replay.
- Real isolated PostgreSQL concurrency: competing revision writes, capacity race, remove versus map/reorder, variant replacement versus gallery operations, simultaneous same-key upload. Assert committed aggregate and audit counts; mocks alone are insufficient.
- Migration: up/down/reapply with existing products/variants/media; composite FK rejects cross-product mapping; duplicate active positions fail; restrictive media references retained; replacement variant save preserves mappings.
- Frontend component: upload/save/retry/empty/failure, alt field and unmatched error summary, keyboard reorder/removal focus, mapping clear/fallback, dirty-navigation protection and no silent discard of existing product form values.
- Browser/manual: actual upload/edit/reload/remove on persisted Draft, session expiry, 320px RTL, keyboard and screen-reader checks. Browser tests must use server-side auth fixtures, not client-granted headers.
- Run repository lint/typecheck, relevant Vitest tests, PostgreSQL verification and production build as appropriate at implementation time. Regress existing product create/edit, SKU/money validation, public Draft filtering, categories and media foundation. Record environmental limitations explicitly.

These are required future checks. No test suite, browser verification or migration was executed during specification authoring.

## Migration and backward compatibility

Use expand-first schema changes; existing products start with empty galleries and revision 0. Existing media rows retain pending/active status and filenames; do not bulk-associate or promote unowned files. No backfill may infer product ownership from filenames. Existing product create/edit DTOs remain unchanged; dedicated gallery APIs carry the new data. Existing public reads retain published filtering and never receive private preview URLs.

Update internal variant replacement and media security behavior atomically with the feature rollout. The removal of `x-mock-user` authorization is an intentional security correction; adapt tests/component callers to real sessions. Preserve legacy upload/publish response shapes for legitimate existing consumers where possible, but never preserve unsafe mock authorization or Draft auto-publication. Inventory of current consumers is a required implementation check.

Down migration removes new mapping/attachment tables before added target keys/revision columns; it never deletes media bytes or pre-existing data. Downgrade after live gallery use loses new gallery metadata, so export/backup it and prefer forward repair. Production rollout and rollback require a durable storage decision and a recovery procedure; no production provider, deployment or migration is authorized by this document.
