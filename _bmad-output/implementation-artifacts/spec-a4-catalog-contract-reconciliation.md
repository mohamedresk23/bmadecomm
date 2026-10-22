---
title: 'A4: Reconcile catalog contracts and completion evidence'
type: 'chore'
created: '2026-10-22'
status: 'done'
route: 'oneshot'
baseline_commit: '4996187c5af630776141193e1f89a5bec9ea38d2'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Resolve retrospective A4 documentation drift using the already approved story scopes and recorded completion evidence. Add a discoverable, source-linked amendment that supersedes earlier public-image promotion/serving expectations with metadata-only public images, replaces the proposed dedicated SEO endpoint with the accepted product writer, and identifies publication migration 0018. Link it from both canonical image/publication kernels and contracts.

Reconcile original story 302/303 completion records without inventing acceptance or rewriting frozen intent: explain obsolete unchecked tasks in 302, align 303's stale lifecycle frontmatter with the recorded approved/done walkthrough and remediation, and preserve historical text and checklist evidence. Distinguish historical checks from newly executed verification. No application code, migrations, new product policy, deployment or aggregate acceptance changes. Preserve and exclude concurrent E07 work.

</frozen-after-approval>

## Implementation Notes

- Single documentation correction; no unresolved intent gaps or irreversible actions. Use the one-shot route.
- Evidence: retrospective F4; approved stories 401/405/406; original 302/303; walkthroughs 302/303 and completed upload remediation. Effective scope changes must be explicit and bounded; do not treat a dated evidence report as a new test run.
- User's existing authorization covers leaving E07 changes in place; stage only this task's files and its A4 sprint hunk.

- Added the bounded [A4 amendment/evidence index](e04-contract-reconciliation-2026-10-22.md), notices in both canonical kernels/contracts, and source-linked lifecycle notes for stories 302/303. Changed only 303's stale frontmatter to done; its unterminated frozen suffix is preserved exactly, with the amendment placed before the opening marker. Story 302's original body and nine unchecked tasks are intact.
- Validation: 15 amendment links resolve; all four canonical entry points reference the amendment; 302's historical body/frozen block and 303's full frozen suffix match the baseline; acceptance sources confirmed. No application tests were rerun for this documentation-only correction.

## Review Triage Log

The one-shot Blind Hunter review completed. No required layer was skipped.

| Finding | Verdict | Evidence and disposition |
|---------|---------|--------------------------|
| Existing catalog/public endpoint namespaces are obsolete | false | Existing readiness/publish/unpublish route files under src/app/api/catalog/products/[id] and by-slug route under src/app/api/public/products/by-slug/[slug] match the canonical paths and approved stories. Only the separate proposed SEO writer was superseded; no endpoint relocation is justified. |
| Story 302 still presents ECONNREFUSED as current | low | Preserved historical readiness section uses present-tense blocked language. Added explicit supersession in the dated completion note, distinguishing earlier environment snapshot from later recorded PostgreSQL verification and current unknown service state. |
| Historical-public-URL sentence could imply existing byte delivery | low | It is conditional on later lifecycle workflows, but could be misread alongside old E04-04 assignment. Clarified conditional future scope in amendment and contract notice; no exception to A1 withdrawal or new URL guarantee is introduced. |
| New 303 heading separator is a literal question mark | low | Confirmed shell-pipeline encoding introduced a question mark. Replaced with an ASCII hyphen. |

No findings deferred. All source corrections remain outside the preserved historical frozen sections.

Final post-review validation passed: historical body/frozen suffix checks, nine preserved unchecked tasks, 15 link targets, four canonical entry points, and diff whitespace validation. No application tests or database operations were performed.
