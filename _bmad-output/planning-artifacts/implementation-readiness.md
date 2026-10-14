# E04-03 implementation readiness and sprint plan

Date: 2026-10-14, Africa/Cairo. Scope: original E04-03 Product images, seven approved stories. Gate: **CONCERNS**. The user explicitly authorized backlog-only tracking despite the concerns. This is not a waiver of implementation gates or adoption of proposed policies.

## Inventory and consistency

Reviewed epics.md (final), focused stories.md (approved-breakdown), validation.md, SPEC.md and implementation-contract.md; PRD v2 FR-06/07/12–15/45/55–58 and NFR-08/09/12/14; architecture spine, solution-design readiness gates, architecture/UX decision records; existing foundation/product implementation records and corresponding code/test files. No existing sprint tracking file was found under _bmad-output, including ignored files.

The seven story blocks in epics.md and stories.md match; scope and acceptance trace to CAP-1–4 and IMG-01–12. No future-story dependency or approved-scope change is required. The validation report proves documentation coverage only. Its Pass labels must not be read as executed acceptance, confirmed single-session effort or closed business-policy gates.

Readiness concerns:

1. **High, 01:** bounded multipart and decoded-pixel/resource limits are unresolved. Current code checks file.size only after formData materialization; sharp defaults are not an adopted product policy. Completing 01 without these decisions would invent a gate value.
2. **High, 01/03:** role behavior differs: generic upload allows owner sessions plus client x-mock-user; catalog baseline permits owner/staff/catalog_manager/catalog; publish accepts mock context only. Decide whether existing generic media routes keep owner-only legitimate access while product-scoped routes reuse catalog roles, or broaden generic media deliberately. Do not silently broaden permissions; final RBAC remains OQ-08.
3. **Medium, 03:** active-image capacity, shared actor rate budget, retry-window/operation-key retention are not approved in the supplied story sources. Existing idempotency code is reusable but file-digest replay, upload capacity races and redundant staging have no E04-03 acceptance evidence.
4. **Medium, 04:** alt maximum and gallery JSON bound remain proposed. Their presence in a final spec is not owner adoption.
5. **Medium, foundations:** F00-07 record has duplicate blocked/implemented frontmatter and contradictory statements that tests passed versus were not run. Treat implementation as code-present, acceptance evidence inconclusive. Existing security bypass and auto-publication mean old tests cannot prove the new ACs anyway.
6. **Release gate:** AD-14 requires durable production object storage; foundation uses local filesystem. SPEC explicitly permits local development. Provider/region/retention need an owner decision before production, not before drafting the first local story. No durable-storage compliance is claimed from an interface alone.
7. **Process concern:** consolidated story blocks are not actionable per-story Build specs with file-path tasks, verified dependencies and resolved open questions. Creating a matching file must not mechanically promote an unresolved story to ready-for-dev.

## Dependency evidence audit

| Dependency | Recorded claim | Evidence inspected | Planning conclusion |
|---|---|---|---|
| Original E04-02 | done; final verification dated 2026-10-14 | Product service/schema/routes/tests, migration 0014, verify-product-concurrency.ts; report records focused 18 tests and four independent PostgreSQL concurrency groups | Implemented and previously verified by recorded evidence; no rerun this session. Report excludes live browser/application DB migration and notes TOTP flake |
| F00-07 | in-progress spec; contradictory auto-result | Upload/storage routes, sharp processor, media migration, Upload component and tests exist; x-mock-user and auto-publish still present | Partial usable foundation, not verified safe for new image scope; 01 owns corrections and fresh evidence |
| Staff auth/permissions | existing catalog role/session helper; planning aspires to action/resource grants | requireCatalogStaffSession resolves live session and CSRF; shared policy requires supplied permissions; no complete live grant matrix established | Session/role baseline code exists; do not claim E02-02 full RBAC completion. Legacy-route role mapping needs explicit preparation |
| F00-02/03, audit | transaction/migration/error foundations | src/db/tx.ts, migration tests, shared API errors/bounded-json, shared audit helper/tests; E04-02 uses audited transactions | Existing implementation reused; future attachment/audit rollback and media schema evidence still required |
| F00-06 | several older blocked specs; later reusable foundation | execute.ts and unit/PostgreSQL concurrency tests exist; E04-02 records product replay verification | Primitive implemented with recorded consumer verification. Test files alone are not test runs; upload digest/replay and retention adoption still open |
| E04-03-01 through 07 | approved planning only | No product_media/variant_media/media_revision implementation or per-story Build specs found | None implemented; no accepted tests or ready-for-dev transition inferred |

This planning session ran no application tests, build, database connection or migration. Prior verification is attributed to its record, never restated as a new successful run.

## Story readiness and execution order

| ID | Prerequisites | Supported tracking status | Blockers / preparation conditions |
|---|---|---|---|
| E04-03-01 | Existing F00-07, staff sessions, F00-03 | backlog | First preparable story; resolve body/decode policy and generic route role mapping; inspect foundation contradictions; create file-path task plan and fresh test expectations |
| E04-03-02 | 01; original E04-02 | backlog | 01 must finish and provide safe-media evidence; create attachment/read/preview spec and migration plan; seeded fixtures do not depend on 03 |
| E04-03-03 | 02; F00-06 | backlog | 02 complete; owner capacity/rate and replay retention contract; file-digest/parallel-upload/staging evidence to be produced by this story |
| E04-03-04 | 03 | backlog | 03 complete; alt/JSON bounds adopted; strict revision/membership plan and dirty-form behavior |
| E04-03-05 | 04 | backlog | 04 complete; confirm ordering transaction and accessible control plan; PostgreSQL uniqueness/rollback proof required on completion |
| E04-03-06 | 05; existing E04-02 variant replacement | backlog | 05 complete; reconcile delete/reinsert mappings atomically; same-product FK migration and overlapping-edit tests required |
| E04-03-07 | 06 | backlog | 06 complete; historical retention fixture and no-delete guarantee; remove/map races and cumulative browser/a11y evidence required |

Order: **01 → 02 → 03 → 04 → 05 → 06 → 07**. This is the approved dependency chain, not a new split. Prepare 01 now; full implementation is not ready until its own gates close. Missing tests for not-yet-built features are completion obligations, not separate owner decisions or prerequisites that demand implementing future stories early.

## Tracking mechanics and preservation

Installed states: story backlog/ready-for-dev/in-progress/review/done; epic backlog/in-progress/done; retrospective optional/done. Do not add blocked/drafted/contexted as new development_status values. Blocking details belong here, not in unsupported status values.

No existing tracking was found, so no other story states were replaced or inferred. The new sprint-status.yaml explicitly tracks only E04-03. epic-4 backlog is this scoped image grouping, not a statement that the whole existing Epic 04 or original E04-02 is unstarted. Full-project tracking can later merge authoritative inputs, preserving existing advanced states and reconciling orphans before a write.

The installed parser accepts Story N.M and would misread Story 4.3.1 as story 4.3 with the extra .1 in its title. Both epics.md and stories.md use three-level approved numbering. sprint-input-e04-03.md adapts tracking numbers to 301–307 without modifying approved IDs or story content. story_id_map records the bijection. This also avoids Build's exact first-two-number resolution colliding across all seven stories; a later per-story spec must record both its approved ID and tracking alias (e.g. 4.301 / E04-03-01).

The generate --dry-run command failed because uv attempted to fetch ruamel.yaml from PyPI and network access was denied. Retrying with installation would conflict with the user's no-environment-changes constraint. Applied the skill's documented manual fallback against sprint-status-template.yaml; no dependency or skill files changed. Official generator/validator success is not claimed. Local structural checks verify statuses, keys, aliases, required fields and source consistency. Future official regeneration should use the adapter, dry-run first and include every other tracked epic input; never drop unrelated entries by refreshing from the scoped adapter alone.

Executed documentation checks passed: seven approved story blocks exactly match their copies in epics.md; nine scoped development_status entries use supported states (one epic, seven backlog stories, one optional retrospective); seven unique aliases resolve to approved IDs; git diff --check returned success. No matching per-story implementation file or ready-for-dev promotion was created.

## Owner decisions, options and recommendations

| Decision | Options | Recommendation | Timing |
|---|---|---|---|
| D1 Multipart bound | Accept proposed 5 MiB file + 64 KiB framing; choose another bounded overhead | Accept proposed overhead while preserving current exact file bound; benchmark/test boundary behavior | Before 01 ready-for-dev |
| D2 Decode budget | Approve a numeric max-pixel/process budget after measured representative-image investigation; supply an owner-required maximum | Investigate and propose a measured numeric limit during 01 preparation; do not treat sharp default as approval | Before 01 ready-for-dev |
| D3 Generic route roles | Keep legitimate generic upload/publish owner-only and use current catalog roles for product routes; explicitly extend generic routes to catalog roles | Keep generic access owner-only initially; avoid implicit permission expansion | Before 01 ready-for-dev |
| D4 Capacity/rate | Accept proposed 10 active images and 20 uploads/10min/actor; supply alternate values | Accept proposed baseline subject to shared-limiter abuse/concurrency checks; no unapproved IP threshold | Before 03 ready-for-dev |
| D5 Replay retention | Retain existing operation records throughout agreed retry window without purge; adopt a defined retention/cleanup policy | Document current no-purge behavior for local development and agree a minimum retry window; defer cleanup implementation outside scope | Before 03 ready-for-dev |
| D6 Alt/JSON bounds | Accept proposed alt 500 chars and JSON 64 KiB; choose alternatives | Accept proposed values, verify Unicode/body boundaries | Before 04 ready-for-dev |
| D7 Production storage/retention | Local development now and separate durable production decision; choose production provider/region/retention now | Continue local preparation; select production configuration before deployment, without claiming AD-14 production compliance | Release gate, does not block first-story drafting |

No owner decision was selected in this planning run. The only new approval is backlog-only tracking despite CONCERNS.

## Actual next workflow

The installed sprint-planning reference names **bmad-build** as the next implementation skill. No installed bmad-create-story or bmad-dev-story skill exists; legacy names in TEA catalog sequencing do not establish installed capabilities.

Use **bmad-build for E04-03-01, preparation only**, passing the focused story and SPEC companions and explicitly instructing: resolve dependencies/owner gates, write an actionable per-story draft, then stop before implementation. The installed Build Plan step requires file-path tasks, Given/When/Then ACs, no unresolved gaps/contradictions and empty Open Questions before its approval checkpoint. Choose **Approve and stop** only when these conditions are met; that is the supported transition to ready-for-dev. A later fresh bmad-build resumes implementation. Do not invoke that full workflow during this documentation-only task.

Suggested intended handoff name after preparation: `4-301-secure-and-validate-existing-media-upload.md` under implementation-artifacts, carrying approved ID E04-03-01 and tracking key. It does not exist yet. Because the sprint generator floors detected matching story files to ready-for-dev regardless of their contents, do not create that matching filename while its policy gaps remain unresolved; use a nonmatching preparation filename and promote only after the Build readiness checkpoint. The approved aggregate stories.md remains a planning artifact, not a readiness-triggering story file.

## E04-03-01 preparation update — 2026-10-14

The user now approved D1 (64 KiB framing over the unchanged file bound), D3 (legacy Owner-only, later product catalog roles) and D7 local-development scope. These supersede the earlier open descriptions for this story; D2 decode policy remains unapproved. D4–D6 are later-story decisions and were not addressed or adopted.

Prepared `../implementation-artifacts/spec-e04-03-01-secure-media-preparation.md` with status draft and the existing tracking alias. Supporting evidence: `stories/stories-e04-03-product-images/preparation-evidence-01.md`. New investigation identified the logo upload caller's missing CSRF and absence of shared-company tenancy; their explicit compatibility/isolation decisions are captured as Open Questions. F00-07 contradictions remain historically preserved and its acceptance cannot be reconstructed from code existence. Tests were not run, including unsafe legacy tests that delete shared upload directories.

All seven tracked statuses remain backlog; no 02–07 work or official validator run began. Approve and stop is the intended terminal action only after this draft's Open Questions close. Current recommendation: review the proposed decode policy, confirm company-isolation scope and approve the minimal existing-logo CSRF adaptation; otherwise retain draft/backlog without a readiness declaration.

### Owner follow-up decisions

The owner adopted <=4096 pixels per dimension, <=8,000,000 total pixels and static-only uploads; confirmed one store per deployment with separate databases/storage across companies; and selected a separate logo-CSRF prerequisite before execution. The earlier undecided descriptions are superseded on those points. See `stories/stories-e04-03-product-images/prerequisite-logo-csrf.md`. This dependency remains unimplemented/unverified; native processing timeout 10 seconds remains an unconfirmed proposal. Story 01 stays draft/backlog. No other story or owner policy was changed.

### Latest verified prerequisite and readiness outcome

The owner explicitly approved ten seconds per processing operation with actual termination/cleanup/no partial result and authorized the separate logo-CSRF prerequisite. That prerequisite now includes the server upload boundary and caller, with final parent evidence: 33 focused tests, typecheck, lint zero errors/one pre-existing warning, and completed three-layer independent review. Existing real processor/private-storage coverage was restored in isolated tests; no processing behavior was changed.

The main-story plan has no remaining owner questions or unmet prerequisites, has concrete future process-isolation tasks for the adopted deadline and is coherent/actionable/testable for local development. Applied the previously instructed Approve and stop: E04-03-01 and its tracking key ready-for-dev. All six later stories retain backlog; overall scope gate remains CONCERNS for their unresolved policies/production decisions. No E04-03-01 implementation or image deadline/pixel-limit acceptance is claimed. Official tracking validator remains unexecuted and its dependency limitation is preserved separately from the local story readiness decision.

### Latest implementation outcome — 2026-10-14

The owner subsequently authorized E04-03-01 only. Its approved local implementation now passed three independent review layers and post-patch verification: 468 full-suite tests passed, one PostgreSQL-only skip and one existing outbox todo; typecheck, lint (zero errors/one preview warning), Next build and isolated packaged-worker smoke passed. The default ten-second deadline actually killed an already-running noncooperative child before failure completion, with no persistence calls. Both 4096-per-side and 8M-total limits and static-only detection are enforced. Logo-CSRF regression and separate deployment B endpoint denial were verified.

Build spec status is done; sprint story status is review pending human acceptance. All 02–07 statuses stay backlog. Detailed run history, resource observations, file inventory and evidence limits are in `../implementation-artifacts/verification-e04-03-01.md`. Two pre-existing explicit-publication reliability issues (atomic exposure and concurrent serialization) are recorded in deferred-work.md; no new production provider/retention policy was adopted. Official sprint validation remains unexecuted and manual consistency checks are not equivalent evidence.
