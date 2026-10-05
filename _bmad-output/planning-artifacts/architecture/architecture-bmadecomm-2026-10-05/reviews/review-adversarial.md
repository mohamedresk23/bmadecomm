---
review: architecture-adversarial
date: 2026-10-05
scope: ARCHITECTURE-SPINE.md and SOLUTION-DESIGN.md
result: no-unresolved-high-or-medium-integration-holes
---

# Adversarial Integration Review

Constructed independently implemented units against the current ADs, including ownership, state reducers, locks, audit, jobs, and shared API/schema gates. No minimum finding count was imposed.

## ADV-01 — Medium: released coupon claim versus trusted late payment

**Location:** AD-4 coupon usage lifecycle; AD-6 trusted late Paid; AD-3 shared transaction/cap; companion §3.

**Unit A:** payments records a trusted late success and invokes inventory reallocation for an uncancelled order with all stock available, as AD-6 requires. It correctly treats receipt recording as mandatory and uses the order transaction guard.

**Unit B:** pricing uses the shared coupon reducer described in AD-4. It previously moved the claim to Released following definitive payment failure. Another order has since reserved/consumed the last coupon use. It now refuses a transition to Consumed because reserved+consumed cannot exceed cap. The original order remains Pending and its snapshot still includes the discount.

Both units' local rules are stated, but the combined transition has no specified resolution. A shared transaction that rolls back on the coupon rejection loses the trusted receipt, contradicting AD-6. Skipping the coupon reducer leaves a financially accepted discounted order with a Released claim, undermining lifecycle/accounting; consuming blindly breaks the cap. Payment retry on the same order can produce the same conflict if the coupon was released on the prior attempt.

**Required closure:** bind the coordinator's handling of failed-attempt/retry and late success against a released coupon claim. A failed payment attempt must not implicitly define the order's coupon-release lifecycle. If a claim may be released while trusted late success remains possible, preserve the money event regardless and explicitly define how the coupon exception gates fulfillment/reacquisition/recovery without violating the cap or silently changing the snapshot. Record any business policy needed as proposed/deferred rather than inventing it. Add this race to the shared reducer contract and integration QA cases.

### ADV-01 resolution — closed as an unsafe integration hole

Rechecked the amended AD-4 and companion §3. Failed attempt no longer independently releases a retryable order's coupon claim. A trusted late receipt is durably recorded independently of re-claim success; cap and snapshot remain protected. Exhausted-cap conflict creates a discrepancy and blocks silent acceptance/fulfillment until an authorized settlement. AD-4 explicitly requires the cap=1/late Paid race in AD-17 evidence. These rules prevent the incompatible pair above from selecting rollback, cap overshoot, or silent discount removal.

The settlement policy itself remains an explicit **OQ-03/04 readiness decision gate before affected late-payment/coupon stories**, rather than an adopted mandatory refund or other invented product policy. This is a disclosed dependency, not an unresolved unsafe silent integration path. No high or medium integration holes remain from this review.

## Other attempted divergent pairs

| Attempted pair | Why it is already prohibited or gated |
|---|---|
| Checkout and inventory each directly mutate the other's tables or use separate transaction contexts | AD-1/2/3 require owner APIs and one shared transaction; companion repeats the transaction context contract. |
| Worker updates one state while HTTP/webhook applies different financial reducers | AD-6/7/13 require shared reducers/guards and same revision; AD-17 supplies replay/crash/concurrency evidence. |
| Lease-expired worker repeats a durable financial effect | AD-5/13 require DB business dedupe and idempotent handlers; lease alone is not treated as exactly-once protection. Foundation job schemas must implement the invariant. |
| Audit writes after commit or reporting silently edits payment facts | AD-2/7/15 forbid these boundaries and require audit with mutation transaction. |
| Refund and payment SDKs calculate different budget/schema conventions | AD-4/8 fix monetary representation and pending budget; AD-10/18 and Deferred explicitly require one foundation contract before independent stories. |
| UI and API use different canonical payloads, pagination, permissions, or DTOs | Shared versioned runtime schemas and foundation contracts gate unresolved concrete choices; implementing independent incompatible contracts would violate AD-2/10/18. |

These rejected constructions are not findings. This review evaluates planning constraints; it does not certify runtime concurrency, provider behavior, or implementation tests.
