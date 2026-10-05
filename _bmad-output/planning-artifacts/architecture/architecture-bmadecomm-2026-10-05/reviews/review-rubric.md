# Reviewer Gate — Rubric Walker

تاريخ: 2026-10-05. الهدف ARCHITECTURE-SPINE.md، وليس companion الذي كتبته هذه الجهة سابقًا. مصدر checklist هو reviewer-gate.md؛ لا ملف good-spine-checklist.md منفصل في installation. لم أعدل المعمارية.

**Verdict: pass بعد إغلاق RG-01؛ لا Critical أو High مفتوح.** المعمارية تغطي جميع المجالات المطلوبة، وتصلح كعقد تصميم مشروط ببواباتها، وليست جاهزية تنفيذ أو إطلاق تلقائية.

## Findings

### RG-01 — High — AD-4 يثبت دورة استهلاك الكوبون دون اعتماد سياسة المنتج

الفقرة بعد Rule تقرر Consumed عند Paid/Confirmed COD، وتقرر أن الإلغاء/الاسترداد بعد القبول لا يعيد حد الاستخدام. FR-20 يطلب limits واستهلاكًا ذريًا، لكنه لا يحدد معيار الاستهلاك أو إعادة الاستخدام بعد الإلغاء. تثبيت هذه القاعدة دون PROPOSED/OQ يجعلها سياسة تجارية جديدة، رغم AD-18 وسجل DECISIONS اللذين ينفيان تغيير المنتج أو اعتماد الافتراضات.

الإصلاح: فصل invariant المقتبس (reserved+consumed≤cap، atomic reducer، identity proof) عن lifecycle business policy؛ وسم لحظات Consumed/Released وإعادة الحد PROPOSED وربطها بقرار coupon-usage semantics قبل قصص pricing/cancel/refund. لا يحتاج السؤال الآن إذا لم تصبح القصة ready؛ لا تستعمل القاعدة غير المعتمدة لتغيير FR أو AC.

### RG-02 — Low — آلية lint الرسمية لم تعمل

DECISIONS يصرح بفشل uv وعدم وجود Python صالح؛ الفحص المكافئ لا يدعي تنفيذ lint_spine.py. هذا حد أدلة مشروع، لا مانع تصميم. يجب أن يستمر التقرير النهائي في التفريق بين مراجعة المستند وبين تنفيذ أداة المهارة أو اختبار build.

الإجراء: defer؛ root يسجل نتائج الفحص البديل وحدوده، ويعيد lint الرسمي عند توفر runtime.

## Good-spine checklist

| معيار | الحكم والأثر |
|---|---|
| paradigm واضح ومناسب | pass؛ modular monolith layered، web+worker وقاعدة واحدة، مطابق اختيار المستخدم |
| divergence points للقصص | pass؛ مالك تعديل لكل وحدة، transaction context، منع SDK/HTTP في domain/application، auth/API وDTO وقواعد المال |
| Rule لكل AD قابلة للتطبيق | pass؛ AD-1–18 لها Binds/Prevents/Rule؛ locks/idempotency/stale writes/auth/caches/jobs/audit محددة؛ RG-01 نطاق تجاري لا غياب enforcement |
| Deferred لا تتيح اختلافًا مستقلًا | pass conditional؛ compiler/ORM/auth/validation/tests/contracts تثبت في foundation مشتركة قبل قصصها؛ لا يسمح اختيارها لكل وحدة؛ OQ بوابات لا defaults |
| tech verified-current | evidence present؛ TECHNOLOGY-EVIDENCE روابط رسمية وتاريخ، stack seed versions، compatibility غير مدعى؛ verification lens يتحقق منها independently |
| brownfield ratification | pass؛ ليس هناك codebase لتنسب له patterns؛ repo وثائق وإعداد BMAD فقط |
| source capabilities | pass؛ خريطة FR-01–60، NFR-01–14، AC-01–24، والـP1 deferred بوضوح؛ RG-01 الوحيد من توسيع scope |
| inherited spine | not applicable؛ لا spine أعلى مورّثة |
| frontend/backend/API/state | pass؛ AD-1/2/10/11، SSR/interactive/client boundaries وعقود server truth |
| schema/money/stock/refund | pass؛ AD-2–8، locks order/inventory/coupon وreceipt، snapshots، minor units، cap وlatePaid guards |
| auth/security/privacy | pass conditional؛ AD-9/16، revoke next request، lastOwner، proof/CSRF، OQ-05/06 تمنع اعتماد retention/MFA/limits |
| jobs/storage/integrations/cache | pass؛ AD-12–14، durable outbox، idempotency، quarantined upload، provider gates |
| environments/infra/operations | pass؛ AD-13/15/16 + topology، البيئات منفصلة، migration/restore/rollback، recovery no force-paid |
| observability/testing | pass؛ AD-15/17 مع actual DB concurrency/provider crash/accessibility/restore؛ لا يدعي اختبارات ناجحة الآن |
| حجم spine وتفريق seed | pass؛ التفاصيل الكبرى في companion، tree/version table seed وليست محاكاة تطبيق قائم |

## Ready-state limit

إغلاق RG-01 يكفي لهذه المراجعة. final documentation يمكن تسليمها مع OQ وأدوات deferred صريحة؛ stories المتأثرة ليست ready حتى عقود foundation واعتمادات PRD المطلوبة. هذه المراجعة لا تثبت deployment أو SLO أو security compliance ولا تفوض implementation.

## Recheck — RG-01 closed

تصحيح provenance: PRD §6.1 بالفعل يتضمن سياسة مقترحة لعدم إعادة استخدام الكوبون بعد نجاح الطلب، وتحرير الحجز للمحاولة الفاشلة قبل نجاح الدفع/تأكيد COD؛ وصف المراجعة الأولى بأنها غير مستمدة كان أوسع من اللازم لأنه اقتصر على FR-20. في AD-4 أصبحت policy موسومة PROPOSED مع §6.1 وOQ-03/04، ودورة state لا تفسر فشل attempt منفرد على أنه إغلاق checkout retry صالح. معالجة late Paid بعد نفاد cap تحفظ receipt وتمنع تجاوز الحد/تعديل snapshot وتضع سياسة التسوية تحت قرار مشترك قبل القصص. يغلق هذا finding؛ لا طلب اعتماد تجاري جديد ضمن المعمارية.
