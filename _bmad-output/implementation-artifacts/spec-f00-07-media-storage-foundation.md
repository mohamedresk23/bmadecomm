---
title: 'F00-07 — Media storage foundation'
type: 'feature'
created: '2026-10-06'
status: 'in-progress'
route: 'dispatch'
baseline_commit: 'f7f608fa6665c4225d9e5469f729019865c252f5'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The system needs a safe, reusable media upload pipeline for product images and logos that enforces limits, strips unsafe metadata, and records uploads in the database before they are published.

**Approach:** Build a POST endpoint to handle uploads behind permission hooks. We will use `sharp` to strip metadata, verify MIME types via magic bytes, save the file to local storage temporarily (or a configured directory), and insert a record into the `media` table.

## Boundaries & Constraints

**Always:**
- Use the `requirePermission` hook to authorize uploads.
- Sniff magic bytes; never trust the client-provided extension or MIME type.
- Re-encode or strip EXIF/metadata from uploaded images to prevent information leaks.
- Ensure the file is served with a safe content-type header.

**Never:**
- Allow spoofed extensions.
- Allow uploads exceeding the configured size limit.
- Allow unauthorized users to upload media.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy Path | Valid PNG/JPEG under size limit | Returns 200 with media ID & URL | N/A |
| Oversized File | File exceeds size limit | Returns 413 Payload Too Large | Payload Too Large response |
| Spoofed Extension | File named .png but contains PDF magic bytes | Returns 415 Unsupported Media Type | Generic 4xx error |
| Unauthorized | User lacks permission | Returns 403 Forbidden | No side effects |

**Decisions:**
- File Size Limits: 5MB (Sufficient for high-quality web images, saves storage)
- Allowed File Types: WebP, JPEG, PNG only (Best for web, universally supported)
- Storage Location Strategy: Local filesystem `public/uploads` and `private/uploads` (Simple for MVP, easy to implement)

</frozen-after-approval>

## Code Map

- `src/db/schema.ts` -- Add `media` table definition.
- `src/app/api/media/upload/route.ts` -- Next.js API route for upload endpoint.
- `src/lib/media/` -- Helper functions for magic-byte sniffing and `sharp` processing.
- `src/components/Upload.tsx` -- Reusable frontend upload component.

## Tasks & Acceptance

**Execution:**
- [ ] `src/db/schema.ts` -- Add `media` table with id, filename, mimeType, size, status, and created_at fields.
- [ ] `src/db/migrations/0004_media_storage.sql` -- Create migration for media table.
- [ ] `src/lib/media/upload.ts` -- Implement `sharp` processing, size checks, and magic byte validation.
- [ ] `src/app/api/media/upload/route.ts` -- Implement upload endpoint with `requirePermission` hook.
- [ ] `src/components/Upload.tsx` -- Implement basic React upload component.
- [ ] `src/app/api/media/upload/route.test.ts` -- Add integration tests for size limits, spoofing, and happy path.

**Acceptance Criteria:**
- Given an oversized file, when uploaded, then it is rejected with 413.
- Given a spoofed extension, when uploaded, then it is rejected based on magic bytes.
- Given an unauthorized user, when uploading, then it is denied.
- Given a valid image, when uploaded, then metadata is stripped and a `media` row is created.

## Implementation Notes



## Spec Change Log



## Review Triage Log



## Design Notes

Use `sharp` for metadata stripping and re-encoding. Store `id` as text using the existing `cuid2` pattern from other tables.

## Verification

**Commands:**
- `pnpm test` -- expected: all media integration tests pass
- `pnpm lint` -- expected: no linting errors
