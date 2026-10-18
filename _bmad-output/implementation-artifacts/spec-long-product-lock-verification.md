---
title: 'Verify upload behavior under a long product row lock'
type: 'chore'
created: '2026-10-18'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
baseline_commit: 25bb3e1c23c1f1a1df706a44e28da755bb333583
context: []
---

<frozen-after-approval reason="human-owned intent">

## Intent

Exercise the observed product-lock wait using real PostgreSQL and independent connections. Hold a Draft product row for over fifteen real seconds after upload A is visibly blocked; start duplicate B with the same actor/product/key/file and confirm lease replacement while both wait. Release the lock and verify A is fenced with 409, B commits one attachment/revision/audit, exactly two attempts are consumed, and retry returns B's result without another attempt. Verify private bytes survive, no losing file is left, and all fixtures are isolated and cleaned. Do not change production lease policy in this verification task.

</frozen-after-approval>

## Implementation Notes

- Small additive change to the existing isolated PostgreSQL harness; no production source or migration changes. Existing harness lock/statement timeouts are too short for this case, so use dedicated test-only connections with longer limits and actual pg_stat_activity lock-wait observation.
- Preserve the preexisting deferred-work edit and the current story review status. Run the extended harness, typecheck and file-scoped ESLint; independently review the test.
- First real run passed with an observed 15,631 ms lock wait: original 409, replacement success, one attachment/audit/revision and two attempts; replay returned the same image without another attempt. Existing duplicate/reclaim/commit-resolution/capacity checks also passed and the isolated schema was removed.
- Final strengthened run passed (exit 0), observed 15,538 ms, with explicit locker PID/blocking-chain proof for both requests before release. Full replay response, final business counters, quota and private bytes remained unchanged. Isolated schema gallery_concurrency_04e6c632a2952f9171cea895146b2355 and per-run storage were cleaned; typecheck and file-scoped ESLint passed.
- Confirmed consequence: data integrity holds, but the request waiting on the product lock can lose its lease and return 409, while the replacement consumes a second attempt. A future policy change could maintain renewal through product-lock acquisition; this task intentionally records existing behavior only. No production source changed.

## Review Triage Log

- medium / patched: A generic products lock wait could refer to the wrong blocker. Record the locker backend PID and follow pg_blocking_pids chains to that exact transaction.
- medium / patched: One observation plus elapsed time does not prove both requests remain waiting at replacement. Reobserve both lock chains before releasing the gate.
- low / patched: Comparing replay image.id alone misses changed metadata. Compare the complete winning response.
- medium / patched: Pre-replay counts cannot detect replay side effects. Recheck attachment/revision/audit counts, quota, file membership and exact bytes after replay.
