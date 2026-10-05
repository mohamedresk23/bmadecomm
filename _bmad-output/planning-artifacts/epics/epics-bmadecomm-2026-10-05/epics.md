---
title: "bmadecomm — Implementation Epic Map"
status: proposed
created: 2026-10-05
scope: "Epic decomposition only; no stories, sprint commitment or implementation"
source: ../../prds/prd-bmadecomm-v2-2026-10-05/prd.md
architecture: ../../architecture/architecture-bmadecomm-2026-10-05/ARCHITECTURE-SPINE.md
---

# خريطة ملاحم تنفيذ المتجر

المرجع للـSRS في هذه الجولة هو [prd.md v2](../../prds/prd-bmadecomm-v2-2026-10-05/prd.md) بمعرفاته FR/NFR/AC؛ لا يوجد SRS مستقل أحدث. سلوك الشاشات من [UX](../../ux-designs/ux-bmadecomm-2026-10-05/EXPERIENCE.md)، والعقود من [المعمارية](../../architecture/architecture-bmadecomm-2026-10-05/ARCHITECTURE-SPINE.md). المتطلبات الأصلية في Word لا تضيف نطاقًا فوق النسخة الثانية. لم تتغير مصادر المنتج أو UX أو المعمارية.

التقسيم: **20 ملحمة P0 و8 ملاحم P1 مؤجلة**. هذه قدرات أعمال وليست تقسيمًا إلى frontend/backend/database. لكل ملحمة حد تسليم متكامل؛ تقسيمها إلى قصص أصغر يأتي لاحقًا. لا تقديرات مدة أو sprint assignments أو قصص مكتملة القبول هنا. الاعتماديات الصلبة تشير إلى ملاحم سابقة فقط؛ ترتيبها ترتيب ممكن للتسليم، لا إلزام بالتنفيذ التسلسلي لكل شيء.

DB أدناه أسماء بذرة من المعمارية، لا DDL معتمد. FR مشترك قد يظهر في أكثر من ملحمة: المالك الرئيسي في coverage.md، وكل مساهم يحقق الجزء المكتوب هنا دون إعادة تنفيذ القاعدة. AC المرتبط قد يكون سيناريو إصدار متعدد الملاحم؛ ذكره لا يعني أن الملحمة وحدها تكمل السيناريو كله.

## أعمال تأسيسية وشروط مشتركة

**F-00 — أساس مشترك، وليس ملحمة أعمال:** تثبيت الحزمة المتوافقة والـlockfile ومكتبات DB/auth/validation/tests، migration/transaction context، DTO/error/money/time formats، ownership/permission hooks، session/proof primitives، outbox/worker والـemail adapter، audit append وrequest correlation، CI والبيئات وsecrets. ينفذ لاحقًا كقصص تمكين تخدم أول شرائح الأعمال لا كمشروع بنية شامل. عقود FR-58/59 وAD-1–18 تثبت قبل القصص التابعة؛ تنشأ migrations الضرورية لكل شريحة، لا جداول P1 مبكرًا. لا اختيار مكتبة أو مزود جديد في هذه الجولة.

كل P0 يستوفي FR-07/45/55–59 بقدر تعامله مع تفويض/تغيير/سجل/ملف/تكامل، وNFR-08/09/12/13/14 بحسب السطح. الأمان والتدقيق والتحقق والوصول واختبارات الحدود داخل تسليم كل قدرة، لا تنتظر ملحمة نهائية. F-00 يوفر الآليات؛ كل ملحمة تملك تغطيتها وأحداثها وDTOs. ملاحم الرسائل/التقارير لاحقًا توسع الآليات ولا تكون اعتمادًا أماميًا لصحة القدرات المبكرة.

**Release gate وليست ملحمة:** أدلة NFR-01–14 وAC-01–24، اختبارات load/restore/rollback/provider sandbox والتجاوب/الوصول، إعداد المحتوى والسياسات والدعم، واعتماد OQ/A المؤثرة قبل الإطلاق. لا تتأخر اختبارات التزامن أو auth إلى هذه البوابة.

**قرارات تمنع جاهزية القصص:** OQ-01 السوق، OQ-02 المزودون، OQ-03 المال/الضريبة، OQ-04 التشغيل، OQ-05 الخصوصية، OQ-06 الأمان/SLO، OQ-07 أهداف القياس، OQ-08 مصفوفة الأدوار والمسؤولون. افتراضات A-01–11 لا تعتمد بالجدول. الهوية المرئية مؤجلة. استثناء نجاح الدفع بعد تحرير آخر استخدام كوبون قرار OQ-03/04 قبل قصص الدفع والكوبون ذات الصلة، وفق AD-4.

## ملاحم P0

### Epic 01 — الوصول الآمن لحساب العميل
- **هدف العمل:** تسجيل العميل ودخوله وإثبات بريده واستعادة وصوله دون كشف حسابات أو منح إدارة.
- **SRS:** FR-01–04؛ جزء FR-43 لرسائل الحساب؛ FR-07/58/59؛ §8.2.
- **الحدود:** التسجيل/login/logout/verify/reset وإبطال الجلسات. لا ملف/عناوين/طلبات كاملة أو أدوار موظفين.
- **الاعتماديات:** F-00 فقط؛ اختيار بريد/هوية وسياسات OQ-02/05/06، A-09.
- **حد التكامل اللاحق:** إرسال verification/reset يعمل هنا ولا ينتظر Epic 17.
- **Frontend:** S-08–12 وحالات expired/invalid/session/error. **Backend:** identity + transactional identity messages. **DB:** users/sessions/proof_tokens/notification_deliveries/outbox.
- **قبول رئيسي:** تسجيل بلا تكرار، فشل عام، إثبات أحادي الاستخدام؛ reset ناجح يبطل الجلسات، ولا توجد صلاحية إدارة للعميل. AC-17؛ AD-9/10/13/16/17.
- **شرائح داخلية مقترحة:** تسجيل وإثبات؛ دخول وخروج؛ reset/revocation. ليست قصصًا مفصلة.

### Epic 02 — وصول الإدارة وإدارة صلاحيات الموظفين
- **هدف العمل:** تمكين المالك من تشغيل فريق بأقل امتياز وحماية صلاحياته.
- **SRS:** FR-06/07؛ FR-02 للإدارة؛ FR-45 لأثر الأدوار؛ §8.1/8.2.
- **الحدود:** دخول الإدارة وcreate/disable/role grant وfield/action policies وآلية عرض audit على المورد. لا شاشات تشغيل المجالات الأخرى.
- **الاعتماديات:** Epic 01؛ OQ-06/08 وA-09 لطريقة MFA/recovery/provisioning. لا يختار دعوات موظفين كميزة جديدة.
- **Frontend:** A-01/A-14 وقشرة تنقل الإدارة والأثر المخول. **Backend:** identity/RBAC/audit core. **DB:** roles/permissions/user_roles/sessions/audit_events.
- **قبول رئيسي:** سحب الدور يمنع الطلب التالي؛ طلب غير مخول بلا أثر؛ تعطيل آخر Owner مرفوض حتى تحت التنافس. AC-13؛ AD-2/9/15/16/17.
- **شرائح:** دخول الإدارة؛ الأفعال/الحقول؛ إدارة الموظفين وحماية آخر مالك.

### Epic 03 — ضبط تشغيل المتجر
- **هدف العمل:** إدارة الإعدادات الضرورية للبيع دون إعادة كتابة تاريخ الطلبات.
- **SRS:** FR-42؛ FR-22 لأهلية طرق الشحن؛ FR-55/57؛ §4.4/6.
- **الحدود:** بيانات متجر/دعم/شعار/لغة/عملة/timezone، طرق دفع/شحن ومناطق وتأكيد ومخزون. لا homepage editor ولا محاولة دفع.
- **الاعتماديات:** Epic 02؛ OQ-01/02/03/04/05/06. رفع الشعار يستخدم storage foundation نفسه، لا يحتاج محرر المنتج اللاحق.
- **Frontend:** A-13. **Backend:** content/settings submodule وعقد قراءة policies. **DB:** settings/policy versions وmedia metadata اللازمة؛ بذرة تحتاج عقد foundation.
- **قبول رئيسي:** طريقة معطلة/منطقة غير مؤهلة ترفض بالخادم؛ إعداد مالي جديد لا يغير snapshot قديمة أو محاولة Pending؛ تغيير العملة بعد أول Order لا يتم كtoggle. AC-11/19؛ AD-2/4/14/18.
- **شرائح:** تعريف المتجر؛ طرق ومناطق؛ نسخة السياسات المالية/التشغيلية.

### Epic 04 — إدارة الكتالوج القابل للبيع
- **هدف العمل:** إنشاء منتجات وأنواع وتصنيفات وصور صحيحة ونشرها بأمان.
- **SRS:** FR-13–15؛ حقول FR-16؛ FR-56/57، FR-14 Duplicate/Archive/Delete.
- **الحدود:** بيانات البيع/publication/variants/categories/images/meta. قيمة المخزون تملكها inventory ولا يحول محرر المنتج إلى stock override؛ لا بحث متجر أو Brands/Reviews.
- **الاعتماديات:** Epic 02 وEpic 03؛ F-00 storage؛ OQ-02/05/06 وA-11 حدود الصور.
- **Frontend:** A-03–05. **Backend:** catalog وإدارة media/SEO metadata. **DB:** products/variants/categories/product_categories/variant_attributes/media/slug_redirects.
- **قبول رئيسي:** Draft غير منشور؛ SKU/combo/slug فريدة؛ لا category cycle؛ Duplicate لا ينشر/ينسخ SKU؛ صورة مزيفة مرفوضة وأرشفة لا تمحو علاقات تاريخية. AC-19/20؛ AD-2/10/14/15.
- **شرائح:** تصنيف؛ منتج ونوع؛ صور؛ نشر/نسخ/أرشفة وmetadata.

### Epic 05 — رقابة المخزون وحركاته
- **هدف العمل:** معرفة الكمية المتاحة وتعديلها بسبب موثق دون overselling أو خصم مزدوج.
- **SRS:** FR-30–32؛ FR-57؛ hooks الحجز/التخصيص/الصرف/التحرير من FR-23/28/35/38.
- **الحدود:** balances/ledger/atomic inventory commands/expiry guards. لا ينشئ Order أو يقرر Paid أو واجهة refund؛ الملاحم اللاحقة تستدعي هذه الأوامر.
- **الاعتماديات:** Epic 02/03/04؛ OQ-01/04/06، A-05.
- **Frontend:** A-06 والتوفر/low stock داخل إدارة النوع. **Backend:** inventory/worker expiry وcontracts للتنسيق. **DB:** stock_balances/inventory_allocations/inventory_ledger.
- **قبول رئيسي:** OnHand/Reserved/Available متطابقة مع ledger؛ تحديث له reason/actor؛ 100 محاولة reserve على Available=1 تنجح واحدة فقط دون رصيد سالب. AC-04، أجزاء AC-08/14 لاحقًا بالintegration؛ AD-3/7/13/17.
- **شرائح:** ledger/adjustments؛ reserve/release/allocate/ship commands؛ expire races.

### Epic 06 — اكتشاف المنتجات واختيار النوع
- **هدف العمل:** إيجاد منتج منشور وفهم سعره وتوفره واختيار نوع قابل للشراء.
- **SRS:** FR-09–12/16؛ عرض FR-13؛ NFR-01/08/09.
- **الحدود:** catalog/category/search/filter/sort/PDP/gallery/SEO. Buy Now handoff محدد إلى عقد السلة/checkout؛ الإتمام يأتي لاحقًا. لا P1 controls.
- **الاعتماديات:** Epic 03/04/05؛ عقد بحث عربي وفلاتر/paging FR-58 قبل القصص.
- **حد التكامل اللاحق:** Best Selling يستخدم تعريف Delivered−Returned فقط؛ إن لم توجد وقائع بعد فبيانات الترتيب فارغة/tie ثابت، لا أرقام مشتريات مختلقة. writer لاحق في Epic 13 يغذي العقد نفسه ولا يحتاج Epic 19.
- **Frontend:** S-02/03 وروابط URL ومكونات المنتج. **Backend:** catalog read/search/SEO projections. **DB:** قراءات الكتالوج والمخزون/slug redirects؛ عقد وحدات delivered مؤرخ موحد.
- **قبول رئيسي:** query/filter/page يستعاد بالURL؛ النوع يغير SKU/price/image/stock؛ عدم الاختيار يمنع الإضافة؛ لا Draft/private indexing، والslug القديم redirect. AC-19/21 وجزء AC-01؛ AD-10–12/14.
- **شرائح:** قائمة/تصنيف؛ بحث/ترتيب؛ PDP؛ SEO والحالات والتجاوب.

### Epic 07 — نشر محتوى الصفحة الرئيسية
- **هدف العمل:** نشر محتوى المتجر من الإدارة دون تعريض المسودة للجمهور.
- **SRS:** FR-08؛ ترتيب Recommended من FR-11؛ NFR-01/08/09.
- **الحدود:** أقسام المصدر المفعلة، اختيار مراجع كتالوج وترتيب تحريري، draft/preview/publish. لا CMS عام أو scheduler جديد.
- **الاعتماديات:** Epic 02/04/06؛ حقول content schema مشتركة قبل القصص.
- **Frontend:** S-01/A-12. **Backend:** content publication/query/cache invalidation. **DB:** homepage_drafts/homepage_publications ومراجع catalog.
- **قبول رئيسي:** المسودة لا تظهر للعامة؛ preview مخول؛ النشر يعرض نسخة متسقة ومنتجات منشورة فقط ويحدّث cache. جزء AC-01/19؛ AD-2/11/12/15.
- **شرائح:** إدارة أقسام؛ معاينة؛ نشر وinvalidation.

### Epic 08 — حساب السعر والكوبونات الأساسية
- **هدف العمل:** تقديم إجمالي موثوق وخصم مؤهل لا يتجاوز حد الاستخدام.
- **SRS:** FR-19/20؛ أجزاء FR-42/57؛ §6.1؛ allocations لـFR-37.
- **الحدود:** pricing engine/basic coupon editor/eligibility/rounding/tax/shipping components؛ لا charge أو Buy X Get Y.
- **الاعتماديات:** Epic 01/02/03/04؛ OQ-01/03/04، A-03/04؛ استثناء late Paid/coupon cap من AD-4 يحسم قبل القصص المتأثرة.
- **Frontend:** A-11 وعقد TotalsSummary/coupon feedback للمتجر. **Backend:** pricing/coupons/quote policies. **DB:** coupons/coupon_eligibility/coupon_usages/pricing_policy_versions.
- **قبول رئيسي:** الخادم يحسب ولا يثق بإجمالي العميل؛ مجموع التخصيصات يطابق total؛ آخر استخدام متزامن لا يتكرر؛ Reserved/Consumed/Released وفق السياسة المعتمدة. AC-09/10؛ AD-3/4/5/17.
- **شرائح:** totals/tax allocation؛ basic coupons؛ atomic usage lifecycle.

### Epic 09 — سلة ضيف وعميل مستمرة
- **هدف العمل:** حفظ اختيارات الشراء ودمجها عند الدخول مع إظهار الفروق.
- **SRS:** FR-17/18؛ إعادة تحقق FR-19؛ handoff Buy Now من FR-12.
- **الحدود:** add/update/remove/persist/merge؛ السلة لا تحجز مخزونًا ولا تثبت quote نهائيًا.
- **الاعتماديات:** Epic 01/05/06/08؛ contracts guest identity/storage/paging quantities قبل القصص.
- **Frontend:** S-04 ومكونات كمية/cart summary وبداية Checkout. **Backend:** cart/merge + pricing reads. **DB:** carts/cart_items مع ownership وdedupe.
- **قبول رئيسي:** الضيف يستعيد سلته؛ دخول العميل يجمع النوع نفسه ويقيد المتاح ويوضح تغييره؛ غير المتاح يبقى مع منع التقديم؛ retry لا يكرر الدمج. جزء AC-05/21؛ AD-5/9/11.
- **شرائح:** سلة الضيف؛ سلة الحساب؛ الدمج وإعادة تسعير/مخزون.

### Epic 10 — Checkout وإنشاء طلب COD آمن
- **هدف العمل:** قبول طلب ضيف أو حساب مع مراجعة مؤكدة وحجز ذري، دون اشتراط الحساب.
- **SRS:** FR-21–24/29؛ إنشاء COD من FR-26؛ تنسيق FR-19/20/31/32/55/57.
- **الحدود:** بيانات وعناوين shipping/billing وشحن ومراجعة وsubmit، snapshots/idempotency/reservation، نتيجة Pending/read-only proof للضيف. online charge في Epic 11، تحصيل COD في Epic 13، تتبع شامل في Epic 15.
- **الاعتماديات:** Epic 01/03/05/08/09؛ COD مقترح A-02 لا يعتمد حتى OQ-04؛ OQ-01/03/04/06 وA-10. API contracts الحاسمة foundation ثم قبل قصص checkout.
- **Frontend:** S-05/06 وقراءة إيصال الطلب الآمنة. **Backend:** checkout/orders coordinator + proof/payment pending. **DB:** orders/order_items/order_address_snapshots/operation_keys/allocations/coupon_usages/outbox.
- **قبول رئيسي:** تقديم نفس المفتاح عشر مرات يعطي Order واحدًا وحجزًا واحدًا؛ تغير السعر يحتاج مراجعة؛ منطقة/طريقة غير مؤهلة مرفوضة؛ snapshot ثابت وguest proof لا يكشف طلبًا آخر. AC-02–05/09–12/21 بحسب السيناريو؛ AD-3–5/9/10.
- **شرائح:** addresses/method eligibility؛ quote review؛ COD submit/result/atomicity. لا تكتمل دورة الطلب P0 عند هذه الملحمة وحدها.

### Epic 11 — الدفع الإلكتروني والتسوية
- **هدف العمل:** قبض موثوق واستعادة نتيجة مجهولة دون charge إضافي أو overselling.
- **SRS:** FR-25/27/28؛ امتداد FR-23/24/29/31/59/60.
- **الحدود:** provider create/query/signed callbacks/dedupe/reducer/reconciliation، timely/late paid واستثناءات recovery؛ لا واجهة تنفيذ refund هنا، بل durable refund task.
- **الاعتماديات:** Epic 03/05/08/10؛ OQ-02/03/04/06، A-05؛ اختيار provider sandbox وعقد late coupon settlement.
- **حد التكامل اللاحق:** مهمات refund تُحفظ بلا تنفيذ مالي حتى Epic 14، وتوقف أي fulfillment غير مأمون. الإطلاق يحتاج دورة الاسترداد كاملة.
- **Frontend:** S-05/06 pending/failed/unknown/result؛ عرض محاولة في الإدارة عند إضافة Epic 12. **Backend:** payments/provider adapter/inbox/reconciliation worker. **DB:** payment_attempts/payment_receipts/provider_events/reconciliation_tasks/outbox.
- **قبول رئيسي:** redirect لا يثبت Paid؛ callbacks مكررة/قديمة لا تعكس النجاح؛ crash بعد charge يستعيد نفس المحاولة؛ late Paid يسجل receipt ويطبق guards ولا يشحن صامتًا. AC-06–08؛ AD-5–7/13/17.
- **شرائح:** intent/return؛ webhook/query؛ out-of-order/late/unknown recovery.

### Epic 12 — إدارة الطلب وتأكيده وإلغاؤه
- **هدف العمل:** مراجعة الطلبات الصحيحة وتأكيدها وإلغاؤها ضمن الصلاحية والسياسة مع سجل قابل للفحص.
- **SRS:** FR-33/34/35/39؛ request cancel للحساب من FR-05؛ FR-45/55.
- **الحدود:** list/filters/snapshots/history/internal notes، OrderStatus/بدء Processing وReadyForShipping، cancel/release/refund-task، print order document. الشحن والتسليم في Epic 13؛ refund execution في Epic 14.
- **الاعتماديات:** Epic 02/05/10/11؛ OQ-03/04/08، A-06.
- **حد التكامل اللاحق:** طلب cancel backend يحضر هنا؛ الحساب يستهلكه في Epic 15. لا tax invoice اعتمادًا ضمنيًا.
- **Frontend:** A-07/08 وتأكـيد الإجراءات. **Backend:** orders transitions/fulfillment pre-shipping/audit. **DB:** order_history/cancellation_requests/fulfillment_records/audit_events ومراجع snapshots.
- **قبول رئيسي:** stale transition مرفوض؛ إلغاء قبل الشحن يحرر مرة واحدة ويخلق refund task إن Paid؛ لا إلغاء بعد Shipped؛ مستند الطباعة يطابق snapshots ويحجب الحقول. AC-14/23 وجزء AC-01؛ AD-4/7/15/17.
- **شرائح:** قراءة/بحث/طباعة؛ confirm/preparation؛ cancellation/guards.

### Epic 13 — الشحن والتسليم وتحصيل COD واستلام العائد
- **هدف العمل:** إتمام تسليم الطلب وتسجيل التحصيل والمخزون العائد كوقائع مستقلة.
- **SRS:** FR-26/34/36/38؛ صرف FR-31؛ §7.2/7.3.
- **الحدود:** ship/tracking/delivery failed/retry/returned inspection وCOD collection/discrepancy. لا partial shipment ولا بوابة returns للعميل ولا refund بمجرد restock.
- **الاعتماديات:** Epic 02/05/10/11/12؛ OQ-02/04/08، A-02/05/07، تشغيل carrier يدوي مشروط لا API مخترع.
- **Frontend:** A-08 وأجزاء inventory inspection/COD receipt المخولة. **Backend:** fulfillment/inventory/payment receipt commands. **DB:** shipment_records/fulfillment_records/return_inspections/inventory_ledger/payment_receipts.
- **قبول رئيسي:** شحن يصرف OnHand وReserved مرة واحدة؛ إلكتروني بلا Paid مرفوض؛ Delivered COD يبقى Pending حتى قبض موثق؛ failed delivery لا يعيد stock، inspected return لا يتكرر والتالف لا يزيد Available. AC-01/14/16؛ AD-3/7/8/17.
- **شرائح:** إرسال وتتبع؛ تسليم/فشل؛ قبض COD؛ استلام وفحص. القواعد متكاملة لكن الشرائح قابلة للتسليم منفصلة.

### Epic 14 — الاسترداد المالي الكامل والجزئي
- **هدف العمل:** رد مبلغ صحيح ومخول، مع حماية الحد تحت التنافس والنتائج المجهولة.
- **SRS:** FR-37؛ ربط FR-35/38؛ FR-59/60؛ §6/7.
- **الحدود:** refund command/budget/allocations/provider query/COD payout confirmation؛ لا automatic restock أو P1 return portal.
- **الاعتماديات:** Epic 02/08/11/12/13؛ OQ-02/03/04/06/08 وعقد definitive failure/reconciliation للمزود.
- **Frontend:** A-09 وrefund task في A-08. **Backend:** refunds/payments adapter/budget reducer. **DB:** refunds/refund_allocations/receipts/operation_keys/outbox/audit.
- **قبول رئيسي:** قبض100 واسترداد30 لا يسمح80؛ طلبا60 متزامنان لا يحجزان120؛ unknown يبقي السقف محجوزًا؛ retry لا يكرر refund، ولا يتغير stock تلقائيًا. AC-15؛ AD-5/8/13/17.
- **شرائح:** budget/authorization؛ provider full/partial؛ COD payout؛ unknown settlement.

### Epic 15 — خدمة العميل الذاتية وتتبع الضيف
- **هدف العمل:** إدارة ملف وعناوين العميل ورؤية تاريخ طلباته وتتبع الطلب بملكية مثبتة.
- **SRS:** FR-05/29؛ واجهة طلب إلغاء FR-35؛ FR-03/55؛ §8.2 proof/claim.
- **الحدود:** profile/address/my orders/details/cancel request، read-only guest tracking/reissue/claim وفق إثبات المصدر. لا ضيف cancel mutation أو refund portal.
- **الاعتماديات:** Epic 01/10/11/12/13/14؛ OQ-05/06، A-09/10؛ proof schema وسياسة reissue/claim UX تثبت قبل القصة، لا دمج بالبريد فقط.
- **Frontend:** S-07/S-13–16. **Backend:** customers/own-order query/identity proof/order cancellation requests. **DB:** customer_addresses/users/proof_tokens وروابط ownership بالorders؛ snapshots قراءة فقط.
- **قبول رئيسي:** تعديل عنوان/بريد لا يعيد كتابة Order؛ customer آخر مرفوض؛ رابط خاطئ/منتهي لا يكشف الوجود؛ طلب الإلغاء لا ينفذ إلغاء إداريًا. AC-02/12/17؛ AD-4/7/9/11.
- **شرائح:** profile/addresses؛ history/details؛ proof/reissue؛ cancel request/claim contract.

### Epic 16 — ملف العميل ودعم الطلبات
- **هدف العمل:** تمكين الدعم من خدمة العميل بسياق مخول دون امتيازات مال أو مخزون غير ممنوحة.
- **SRS:** FR-40؛ FR-07/33/35/55؛ spending definition §10.
- **الحدود:** admin customer list/profile/contact/addresses/order history/spending/notes/disable، support handoff وإثبات مستقل للضيف. لا CRM/segmentation أو forced guest merge.
- **الاعتماديات:** Epic 02/12/13/14/15؛ OQ-05/08 وcontract فلاتر العميل النهائي. الإنفاق query receipts/refunds بعقد مستقل، لا انتظار dashboard.
- **Frontend:** A-10 وقراءات Order للدعم. **Backend:** customers/authorized reporting read/identity disable. **DB:** customer_notes/users/addresses وروابط orders/receipts/refunds للقراءة.
- **قبول رئيسي:** support يرى الحقول اللازمة فقط ولا يغير inventory أو grants؛ تعطيل لا يمحو المال؛ لا claim بالبريد وحده؛ الأثر محفوظ. AC-13 وجزء AC-02/24؛ AD-2/9/15.
- **شرائح:** قائمة/ملف؛ notes/spending؛ disable وحالات الدعم.

### Epic 17 — رسائل دورة الطلب وتنبيهات الأعمال
- **هدف العمل:** إعلام العميل والفريق بالوقائع الصحيحة مع تسليم متين رغم فشل البريد.
- **SRS:** FR-43/44؛ جزء FR-60 لفشل البريد؛ NFR-06.
- **الحدود:** transactional order/payment/ship/deliver/cancel/refund templates، new order/low stock/pay/refund alerts وتسليم/retry. رسائل الحساب موجودة في Epic 01؛ لا SMS/WhatsApp.
- **الاعتماديات:** Epic 01/05/10/11/12/13/14؛ OQ-02/05/06/08 وA-11. جميع producers تكتب outbox منذ ملحمتها، لا إعادة اختراع الأحداث هنا.
- **Frontend:** A-15 notification/delivery list المخولة؛ البريد نفسه. **Backend:** notifications/worker/templates/subscribers. **DB:** notification_deliveries/outbox/job_attempts مع dedupe.
- **قبول رئيسي:** فشل البريد لا يتراجع عن Order؛ retry مضبوط مرئي؛ رسالة Pending لا تعلن Paid؛ لا إرسال purchase/charge من email callback. AC-18؛ AD-13/15/16/17.
- **شرائح:** templates order/payment؛ delivery/retry؛ alerts للأدوار.

### Epic 18 — استعادة التشغيل ومعالجة الاستثناءات
- **هدف العمل:** معالجة الانقطاع والنتائج المعلقة دون تعديل DB يدوي أو force-paid.
- **SRS:** FR-60؛ FR-27/28/44؛ NFR-05–07/14.
- **الحدود:** واجهة موحدة لمهمات unknown pay/refund، expiry وmail failure وsafe replay/correction/runbooks. جوهر query/expiry/refund guards موجود في ملاحمه؛ هذه capability تنظيم التدخل المخول.
- **الاعتماديات:** Epic 02/05/11/14/17؛ OQ-06/08، تعريف parameters/actions لكل retry قبل القصة.
- **Frontend:** A-15 recovery queues/detail/actions. **Backend:** operation task queries/authorized replay coordinators/observability. **DB:** reconciliation_tasks/outbox/job_attempts/audit وروابط attempts/refunds.
- **قبول رئيسي:** unknown يقود query آمن لنفس المحاولة؛ retry لا يكرر المال/stock؛ recovery action له actor وأثر؛ لا direct DB/force success ولا تسريب secrets. AC-07/08/18/23؛ AD-5/6/13/15/16.
- **شرائح:** قائمة استثناءات؛ أفعال آمنة؛ تنبيه وتصعيد/runbook.

### Epic 19 — لوحة مؤشرات التشغيل والمال الأساسية
- **هدف العمل:** عرض أداء المتجر بناءً على وقائع مالية وتشغيلية ثابتة التعريف.
- **SRS:** FR-41؛ §10 SM-1–5/guardrails؛ FR-07/55.
- **الحدود:** KPIs/sales chart/recent orders/top selling/low stock/date/timezone؛ لا advanced reports أو export جديد.
- **الاعتماديات:** Epic 02/05/10/11/13/14؛ OQ-07 لأهداف العمل/window وOQ-08 للحقول، دون تعطيل تصميم المقاييس المثبتة في المصدر.
- **Frontend:** A-02 وchart data alternatives. **Backend:** reporting read models/projections؛ لا كتابة states. **DB:** قراءات order/receipt/refund/fulfillment/ledger، projections مؤرخة عند الحاجة المبررة.
- **قبول رئيسي:** Pending COD لا يعد تحصيلًا؛ partial refunds وtimestamps/cohort لا تمحو واقعة الطلب؛ المجاميع تطابق seed المالي وتصنيف صلاحيات الحقول. AC-24؛ AD-2/4/12/15/17.
- **شرائح:** metric queries؛ KPIs/date؛ chart/top/lowstock وحالات بلا بيانات.

### Epic 20 — قياس رحلة الشراء دون تكرار أو بيانات شخصية
- **هدف العمل:** فهم التحويل ومواضع الانقطاع بفصل حدث الشراء عن التحصيل.
- **SRS:** FR-46؛ §10 analytics/consent؛ NFR-13.
- **الحدود:** الأحداث المسماة في المصدر مع order-level purchase dedupe؛ لا أداة marketing automation أو wishlist event قبل P1.
- **الاعتماديات:** Epic 06/09/10/11/12؛ OQ-02 إذا اختير analytics provider، OQ-05 consent، OQ-07 baseline. financial truth مصدر الملاحم لا browser success page.
- **Frontend:** instrument catalog/search/cart/checkout بconsent دون PII. **Backend:** unique business purchase event/adapter. **DB:** dedupe/outbox metadata المصرح بها؛ لا إضافة behavioral data warehouse.
- **قبول رئيسي:** online purchase عند Paid وCOD عند Confirmed، لا refresh/callback ثاني، وتوضح التغطية partial consent دون اعتباره كل الزيارات. جزء AC-24؛ AD-5/11/15/16.
- **شرائح:** consent/event schema؛ funnel events؛ purchase business-source dedupe.

## ملاحم P1 — مؤجلة حتى طلب إطلاقها

### Epic 21 — قائمة الرغبات
- **هدف العمل:** حفظ اختيارات العميل للعودة إليها.
- **SRS:** FR-47؛ extensions FR-09/12/46.
- **الحدود:** registered add/remove/list/move Variant للسلة؛ لا guest wishlist جديدة.
- **الاعتماديات:** Epic 01/06/09/15؛ Epic 20 فقط لأثر wishlist_add إذا integration analytics مفعّل. عقد extension قبل P1.
- **Frontend:** D-01 وcontrols P1 للمنتج. **Backend:** customers/wishlist extension/cart handoff. **DB:** wishlist_items بowner+variant uniqueness.
- **قبول رئيسي:** لا قراءة قائمة غير مملوكة؛ غير المتاح محفوظ ولا ينقل للسلة؛ P0 لا controls قبل الإطلاق. FR-47/AC-19؛ AD-9/11/18.

### Epic 22 — تقييمات الشراء المثبت ومراجعتها
- **هدف العمل:** نشر تقييم موثوق قابل للإشراف.
- **SRS:** FR-48؛ extensions FR-09/11/12.
- **الحدود:** 1–5/comment/one per customer-product/edit/re-moderate/approve-hide-delete/visible aggregate؛ لا تقييم ضيف غير مطلوب.
- **الاعتماديات:** Epic 02/06/13/15؛ A-08 سياسة approval قبل P1.
- **Frontend:** D-02 وPDP/list/rating filter عند إطلاق الميزة. **Backend:** review eligibility/moderation/aggregation. **DB:** reviews/moderation history بunique verified purchaser-product.
- **قبول رئيسي:** غير المثبت مرفوض؛ تعديل يعيد المراجعة بحسب السياسة؛ hidden لا يدخل المتوسط؛ actions مخولة. FR-48/AC-19؛ AD-9/15/18.

### Epic 23 — العلامات التجارية للكتالوج
- **هدف العمل:** تنظيم المنتجات حسب العلامة مع حفظ التاريخ.
- **SRS:** FR-49؛ extensions FR-09–11/56.
- **الحدود:** CRUD/logo/status/archive وعرض/فلتر العلامة؛ لا pages تسويقية جديدة غير محددة.
- **الاعتماديات:** Epic 02/04/06؛ storage limits/privacy gate.
- **Frontend:** D-03 وإضافات تصفح الكتالوج. **Backend:** catalog brands extension. **DB:** brands/product-brand references/media.
- **قبول رئيسي:** المؤرشف يمنع استخدامًا جديدًا ويحفظ التاريخ؛ logo آمن؛ controls/filters لا تظهر قبل feature launch. FR-49/AC-19/20؛ AD-14/18.

### Epic 24 — بوابة طلبات الإرجاع
- **هدف العمل:** تمكين صاحب الطلب المثبت من طلب إرجاع وتتبع معالجته.
- **SRS:** FR-50؛ extensions FR-37/38/44؛ §7.4.
- **الحدود:** item qty/reason/notes/optional images، Requested/UnderReview/Approved-or-Rejected/Received/Refunded؛ لا إعادة بناء refund engine.
- **الاعتماديات:** Epic 13/14/15/17؛ A-07/OQ-04 eligibility/windows وguest mutation proof مستقل عن read token.
- **Frontend:** D-04 account/verified guest/admin. **Backend:** return-request extension + inspection/refund orchestration. **DB:** return_requests/return_items/history/media وروابط inspections/refunds.
- **قبول رئيسي:** quantity لا تتجاوز delivered remaining؛ رابط قراءة لا يخول mutation؛ لا Refunded قبل نتيجة مؤكدة؛ stock يرجع فقط للفحص. FR-50/AC-12/14/15؛ AD-8/9/14/18.

### Epic 25 — التقارير التجارية المتقدمة
- **هدف العمل:** تحليل المنتجات والعملاء والخصومات وفق نفس الحقيقة المالية.
- **SRS:** FR-51؛ §10.
- **الحدود:** sales/product/customer reports/date، لا export/segmentation مخترع.
- **الاعتماديات:** Epic 13/14/16/19؛ OQ-07 windows/targets وOQ-08 field permissions.
- **Frontend:** D-05. **Backend:** reporting extension. **DB:** financial/fulfillment read projections لا تعديل snapshots.
- **قبول رئيسي:** Gross/Net/AOV/new/returning متسقة مع dashboard ولا تجمع guests بالاسم؛ الأسعار الحية لا تعيد كتابة التاريخ. FR-51/AC-24؛ AD-4/12/15/18.

### Epic 26 — العروض والكوبونات المتقدمة
- **هدف العمل:** دعم Buy X Get Y بقواعد أهلية وتعارض واضحة.
- **SRS:** FR-52؛ extensions FR-20/37.
- **الحدود:** شرط X/Y وتوزيع المجاني/discount/eligibility conflicts، لا loyalty/giftcards.
- **الاعتماديات:** Epic 05/08/09/10/14؛ تعريف الحقول والسياسات وإقرار stacking قبل P1.
- **Frontend:** D-06 coupon editor + quote summary. **Backend:** pricing advanced rules/refund allocation contract. **DB:** coupon rule payload/version وusage/allocations الحالية.
- **قبول رئيسي:** المجاني له stock allocation؛ discount لا يتجاوز المؤهل؛ partial refund يراعي التخصيص نفسه. FR-52/AC-09/10/15؛ AD-3/4/8/18.

### Epic 27 — SMS وWhatsApp
- **هدف العمل:** إضافة قنوات اتصال معتمدة دون الإضرار بدوام البريد الأساسي.
- **SRS:** FR-53؛ extensions FR-43/44.
- **الحدود:** provider/templates/consent/delivery/retry/dedupe؛ Push مؤجل خارج هذه الملحمة.
- **الاعتماديات:** Epic 17؛ OQ-02/05/06/08 وأهلية مزود وسياسات اتصال وقوالب القنوات قبل P1.
- **Frontend:** D-07 قناة/حالة تسليم مخولة. **Backend:** notifications channel adapters/worker. **DB:** channel-specific delivery/config metadata مع secrets بالخادم.
- **قبول رئيسي:** replay لا يضاعف الرسالة مقصودًا، failure مرئي ولا يغير Order؛ consent/credentials وفق السياسة. FR-53/AC-18؛ AD-13–16/18.

### Epic 28 — بحث وتصدير التدقيق
- **هدف العمل:** تمكين المخول من فحص أثر التغييرات عبر الموارد.
- **SRS:** FR-54؛ extension FR-45/NFR-13.
- **الحدود:** global audit search actor/resource/time/action وexport مخول منقح مسجل؛ capture/detail الأساسيان موجودان P0.
- **الاعتماديات:** Epic 02/12/14/18؛ OQ-05/08 retention/export access.
- **Frontend:** D-08. **Backend:** audit read/export adapter فقط. **DB:** audit_events/indexes/export operation metadata وفق سياسة، لا update/delete للسجلات.
- **قبول رئيسي:** export لا يكشف حقولًا غير مخولة وله audit event؛ التاريخ غير قابل للتحرير؛ البحث يطابق المجال والزمن. FR-54؛ AD-9/15/16/18.

## ترتيب التسليم المقترح

| المجموعة | الملاحم | الناتج القابل للتحقق |
|---|---|---|
| تأسيس وتشغيل كتالوج | F-00، 01–05 | هوية/أدوار/سياسات ومنتج ومخزون صحيح |
| اختيار وتحضير شراء | 06–09 | متجر قابل للتصفح ومحتوى وسعر وسلة |
| قبول وتسوية الطلب | 10–11 | طلب COD ذري ودفع إلكتروني قابل للتسوية |
| تشغيل دورة الطلب | 12–14 | تأكيد وإلغاء وشحن وتحصيل واسترداد |
| خدمة وملاحظة | 15–20 | خدمة ذاتية/دعم/رسائل/استعادة/قياس؛ يمكن تداخل ما اكتملت اعتمادياته |
| Release gate | أدلة جميع AC/NFR واعتمادات OQ | قرار إطلاق منفصل، لا تطبيق منشور بهذه المهمة |
| توسعات P1 | 21–28 | كل capability تطلق مستقلة بعد إعادة تفصيل نطاقها |

الاعتماديات تعني عقودًا وقدرات موجودة، لا انتظار انتهاء كل صف لتنفيذ الآخر. لا تعتبر P0 مكتملة قبل قدرات الحساب/التتبع/البريد/التدقيق/refund/recovery الأساسية. ليست خطة COD-only launch؛ Epic 10 شريحة أولى تليها بوابة الدفع والقبول الكاملان.
