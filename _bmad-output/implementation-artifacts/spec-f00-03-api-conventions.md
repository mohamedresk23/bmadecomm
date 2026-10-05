---
title: 'F00-03 — API conventions: DTO, errors, money, time, correlation'
type: 'chore'
created: '2026-10-05'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

## Intent

**Problem:** We need a unified API contract format across endpoints to handle validations, error envelopes, time zones, paging, correlation tracking, and safe money representation, preventing inconsistent behavior across modules.

**Approach:** 
1. Install `zod` for validation schemas.
2. Implement `MoneyUtils` for exact-decimal math using minor integer units.
3. Implement `ApiError` class and a central `withErrorHandler` to wrap Next.js routes, returning generic 5xx errors or 400 validation errors safely.
4. Implement Next.js `proxy.ts` (formerly middleware) to inject and extract `x-correlation-id` to trace requests.
5. Create standard paging parameter extraction.
6. Provide a Frontend `ApiClient` that reads the envelope and throws typed `ClientApiError`.

## Code Map

- `package.json` -- Added `zod` dependency.
- `src/shared/money/money.ts` -- Money types and utilities safely handling minor units.
- `src/shared/api/errors.ts` -- API Error envelope and standard HTTP responses.
- `src/shared/api/validation.ts` -- Validation helper mapping Zod errors to `ApiError`.
- `src/shared/api/paging.ts` -- Pagination schema using Zod, ensuring max page size.
- `src/shared/time/time.ts` -- UTC ISO generators and formatter for timezone display.
- `src/shared/api/error-handler.ts` -- Generic error wrapper for API handlers.
- `src/proxy.ts` -- Edge proxy injecting `x-correlation-id` to request and response headers.
- `src/shared/api/client.ts` -- FE fetch client handling the error envelope.
- `src/app/api/correlation-test/route.ts` -- Integration testing route.

## Tasks & Acceptance

**Acceptance Criteria Verified:**
- [x] invalid payload → 4xx with field errors (`validation.ts` + `error-handler.ts`).
- [x] unhandled error → generic 5xx with correlation ID only (`error-handler.ts` + tests).
- [x] money round-trips without precision loss (`money.ts` minor unit integer enforcement).
- [x] paging params validated with max page size (`paging.ts` max 100 limit).

## Spec Change Log
- Initial implementation completed successfully. Renamed Next.js middleware to proxy.ts based on deprecation warning during build.

## Review Triage Log
- All type checks, linter, and tests passed.
