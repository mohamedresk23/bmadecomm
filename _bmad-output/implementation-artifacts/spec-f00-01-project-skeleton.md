---
title: 'F00-01 — Project skeleton, CI and environments'
type: 'chore'
created: '2026-10-05'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
baseline_revision: '456a15254c651e1176bdc399f31dab6bfca3fdac'
---

## Intent

**Problem:** The project lacks a foundational repository structure, making it impossible to begin feature development or ensure code quality through CI.

**Approach:** Initialize a Next.js App Router project with TypeScript and Tailwind CSS. Configure the root layout for Arabic/RTL by default. Add a `/api/health` endpoint for readiness checks. Setup a basic GitHub Actions CI pipeline for linting, typechecking, and testing. Provide environment variable templates.

## Boundaries & Constraints

**Always:** Use strict TypeScript; enforce RTL layout default; ensure CI checks for secrets.

**Never:** Add database ORM, authentication libraries, or business logic in this foundational story.

## Code Map

- `package.json` -- Define scripts for linting, testing, and building.
- `src/app/layout.tsx` -- Update `html` tag to enforce `dir="rtl"` and `lang="ar"`.
- `src/app/api/health/route.ts` -- New health check endpoint returning 200 OK.
- `.github/workflows/ci.yml` -- New CI pipeline definition.
- `.env.example` -- Example environment variables file.

## Tasks & Acceptance

**Execution:**
- `.` -- Initialize Next.js project (App Router, src dir, TypeScript, Tailwind, ESLint). -- Establish the core framework.
- `src/app/layout.tsx` -- Set `lang="ar" dir="rtl"` on the html tag. -- Meet the RTL/Arabic default requirement.
- `src/app/api/health/route.ts` -- Implement `GET` returning `{"status": "ok", "version": "1.0.0"}`. -- Provide a readiness check.
- `.github/workflows/ci.yml` -- Create CI pipeline running `npm ci`, `npm run lint`, `npm run build`. -- Enforce code quality on CI.
- `.env.example` -- Create placeholder for environment variables. -- Guide developers on required configuration.

**Acceptance Criteria:**
- Given a clean repository, when running `npm install` and `npm run build`, then the build succeeds without errors.
- Given the server is running, when requesting `GET /api/health`, then the response is `200 OK` with JSON containing the version.
- Given the root layout renders, when inspected, then the `<html>` tag includes `dir="rtl"` and `lang="ar"`.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm run lint` -- expected: completes without errors.
- `npm run build` -- expected: completes without errors.
