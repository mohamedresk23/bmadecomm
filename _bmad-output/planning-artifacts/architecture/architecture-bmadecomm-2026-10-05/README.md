# معمارية bmadecomm

المهمة توثيق تقني دون implementation. اعتمد المستخدم الحزمة والهيكل؛ لم يعتمد ذلك افتراضات المنتج أو مزودين أو استضافة.

| الملف | الاستخدام |
|---|---|
| [ARCHITECTURE-SPINE.md](ARCHITECTURE-SPINE.md) | AD-1–AD-18: عقد الاتساق الذي تتبعه القصص المستقبلية. |
| [SOLUTION-DESIGN.md](SOLUTION-DESIGN.md) | شرح للمطورين وQA: الهيكل، مخطط العلاقات وبذرة schema/API، الأمان والتشغيل والاختبارات. |
| [DECISIONS.md](DECISIONS.md) | ما اعتمده المستخدم، البدائل وحدود أدوات BMAD. |
| [TECHNOLOGY-EVIDENCE.md](TECHNOLOGY-EVIDENCE.md) | التحقق من المصادر الرسمية وبوابة توافق الحزم قبل bootstrap. |
| [verification.md](verification.md) | نتائج مراجعة التغطية والاتساق وحدود الأدلة. |

المصدر المنتج [PRD v2](../../prds/prd-bmadecomm-v2-2026-10-05/prd.md)، ومعه [UX](../../ux-designs/ux-bmadecomm-2026-10-05/README.md). SHA256 للـPRD عند القراءة: F4B7305F359DFB89C660A596E63DF798729B506DD1884F67EF5198FFB9D76395. أي تعارض مع المنتج يعاد للقرار، ولا تُعدل متطلباته بصمت.

قبل implementation: حسم OQ المتأثرة، ثم foundation contracts مشتركة لاختيار مكتبات الهوية/التحقق/DB/QA وتثبيت pins، ثم قصص تستشهد بـFR/AC/AD. يمكن استخدام bmad-spec لتجميع حزمة spec مع هذا العقد، ثم bmad-create-epics-and-stories وreadiness/sprint planning. لا تبدأ bmad-build دون طلب تنفيذ مستقل.
