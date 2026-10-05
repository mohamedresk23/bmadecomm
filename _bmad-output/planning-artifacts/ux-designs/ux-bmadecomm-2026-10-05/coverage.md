---
title: "استخراج المصدر وتغطية UX"
status: draft
updated: 2026-10-05
sources:
  - ../../prds/prd-bmadecomm-v2-2026-10-05/prd.md
source_sha256: F4B7305F359DFB89C660A596E63DF798729B506DD1884F67EF5198FFB9D76395
---

# المصدر وتغطية التجربة

قرأ استخراج UX ملف prd.md كاملًا، لا addendum أو Word أو تحليلًا سابقًا. §0 يجعل المصدر مسودة مع قرارات غير معتمدة؛ §4 يفرق P0/P1/P2؛ §5 يحتوي FR-01…60؛ §6 قواعد الأموال/المخزون؛ §7 الحالات؛ §8 RBAC والقيم المقترحة؛ §9 NFR-01…14 والحالات المشتركة؛ §10 القياس؛ §11 AC-01…24؛ §13/14 OQ/افتراضات. لا محتوى مستورد بصري أو mocks. المسارات التالية تخص [EXPERIENCE.md](EXPERIENCE.md) ما لم يذكر DESIGN.md.

## تغطية FRs

| FR | السطح/القسم | تدفق/قرار | الحدود |
|---|---|---|---|
| FR-01 | S-08؛ Forms تسجيل | TF-1؛ UX-07 | required fields وفق المصدر؛ regex/limits إلى FR-58 |
| FR-02 | S-09/A-01؛ SessionNotice | UJ-2/3/5، TF-1؛ UX-01/07 | فشل عام؛ logout يلغي الجلسة |
| FR-03 | S-10؛ إثبات/permissions | TF-1؛ UX-07 | claim Order لا يعتمد تشابه بريد |
| FR-04 | S-11/12؛ حالات links | TF-1؛ UX-07 | reset يبطل الجلسات؛ القيم PRD A-09 |
| FR-05 | S-13/14/15/16؛ عنوان/ملف | UJ-2، TF-1؛ UX-06/07 | ملكية؛ عنوان Order ثابت |
| FR-06 | A-01/14؛ permissions | TF-3؛ UX-07 | آخر Owner؛ سحب الدور فوري للطلب التالي |
| FR-07 | Navigation/permissions/F | كل تدفق محمي؛ UX-07 | default deny، لا API bypass |
| FR-08 | S-01/A-12 | TF-2؛ UX-10 | enabled فقط؛ draft/preview/publish |
| FR-09 | S-02؛ ProductCard/Pagination | UJ-1؛ UX-02/10 | count/URL؛ P1 controls غائبة |
| FR-10 | S-02؛ SearchFilters/Tables | UJ-1، TF-2؛ UX-02 | query في URL؛ normalization مفتوح |
| FR-11 | S-02/A-12؛ Tables | UJ-1، TF-2؛ UX-02 | Recommended تحريري؛ 30 يوم Best Selling |
| FR-12 | S-03/05؛ variant/forms | UJ-1؛ UX-03 | Buy Now لا يتخطى تحقق السلة |
| FR-13 | S-03/A-04 | UJ-1، TF-2؛ UX-06 | النوع غير النشط لا شراء جديد؛ Compare عرض |
| FR-14 | A-03/04؛ Forms | TF-2؛ UX-11 | draft/archive/duplicate/SKU/role |
| FR-15 | A-04/05؛ FileUpload | TF-2؛ UX-11 | شجرة بلا دورة؛ مستخدم يحتاج إعادة تعيين |
| FR-16 | S-02/03/A-04؛ Breadcrumbs/SEO | TF-2؛ UX-02 | redirect/no indexing للحساب/الإدارة |
| FR-17 | S-03/04/05؛ QuantityControl | UJ-1/2؛ UX-03 | السلة لا تحجز؛ Available يعاد فحصه |
| FR-18 | S-04؛ state merge | UJ-2؛ UX-03/08 | الجمع/التقليص/غير المتاح/إعادة coupon |
| FR-19 | S-04/05؛ TotalsSummary | UJ-1/2؛ UX-03 | فرق السعر موافقة؛ مصدر الخادم |
| FR-20 | S-04/05/A-11؛ Forms/Tables | TF-2/UJ-1؛ UX-03/05 | أهلية/حدود ذرية؛ PRD A-03 |
| FR-21 | S-05؛ Checkout/Forms | UJ-1/2؛ UX-03/08 | ضيف؛ غير حساس محفوظ؛ لا بطاقة |
| FR-22 | S-05/14؛ address/state | UJ-1/2؛ UX-03 | postal conditional؛ منطقة غير مخدومة |
| FR-23 | S-05/06؛ PrimaryAction | UJ-1؛ UX-05 | Pending/snapshot/reservation قبل provider |
| FR-24 | S-05/06؛ interaction/state | UJ-4؛ UX-05/08 | نفس المحاولة؛ لا دفع جديد غامض |
| FR-25 | S-05/06/A-08/09 | UJ-1/4؛ UX-04 | redirect ليس Paid؛ vendor لم يختَر |
| FR-26 | A-08/15؛ S-06/16 | UJ-3، TF-4؛ UX-04/12 | collection amount/date/ref؛ Delivered != Paid |
| FR-27 | S-06/A-08/15 | UJ-4؛ UX-08 | Pending؛ callback قديم لا يعكس النجاح |
| FR-28 | S-06/16/A-08/09/15 | UJ-4، TF-4؛ UX-08 | late Paid؛ منع شحن تلقائي؛ استثناء/Refund |
| FR-29 | S-06/07/16؛ proof/forms | UJ-1/4، TF-1؛ UX-07 | طلب واحد/رد عام/لا رقم وحده |
| FR-30 | A-06؛ stock forms | UJ-3، TF-4؛ UX-05 | before/delta/after/reason/actor/time |
| FR-31 | A-06/08/15؛ stock states | UJ-3/4؛ UX-05/08 | Paid allocation دائم؛ shipping صرف |
| FR-32 | S-03/05/A-06/13 | UJ-1، TF-3؛ UX-03/05 | no overselling؛ PRD A-05 مشروط |
| FR-33 | A-07/08؛ S-16 | UJ-3/5؛ UX-04/06/07 | billing خيار؛ filters exact؛ notes internal |
| FR-34 | A-08؛ timeline/state | UJ-3؛ UX-04/05 | guards؛ stale رفض لا overwrite |
| FR-35 | S-16/A-08؛ confirmation | UJ-2/5؛ UX-05/07 | guest read-only؛ طلب ليس Cancelled |
| FR-36 | A-08/S-16/07؛ shipping form | UJ-3، TF-4؛ UX-04 | full shipment؛ failure لا stock تلقائي |
| FR-37 | A-09/A-15؛ Refund Forms | UJ-5، TF-4؛ UX-05/08 | Pending يحجز الحد؛ COD external ref |
| FR-38 | A-06/08؛ returns operations | TF-4؛ UX-05 | فحص فعلي؛ Refund لا stock؛ التالف منفصل |
| FR-39 | A-08؛ invoice print | UJ-3؛ UX-06 | مستند Order؛ لا claim tax invoice |
| FR-40 | A-10؛ Forms/Tables | UJ-5، TF-3؛ UX-07 | customer filters exact غير محددة |
| FR-41 | A-02؛ KPIs/chart/table | TF-5؛ UX-12 | date/timezone؛ التعاريف §10 |
| FR-42 | A-13؛ settings form | TF-3؛ UX-06 | currencies/history/Pending حماية؛ schema مفتوح |
| FR-43 | A-15 + confirmation feedback | TF-1/4؛ UX-08 | البريد فشله لا يمحو Order؛ retry آمن |
| FR-44 | A-15؛ NotificationList | TF-4؛ UX-07/08 | scope role؛ New Return Request P1 |
| FR-45 | A-16 ضمن موارد؛ history | UJ-3/5، TF-2/3/4؛ UX-07 | readonly/redacted؛ no P1 search/export |
| FR-46 | interaction/TF-5 | UJ-1/4؛ UX-12 | event unique؛ no PII؛ refresh لا purchase |
| FR-47 | D-01؛ IA أسطح P1 المؤجلة | PF-1؛ UX-10 | P1 Wishlist؛ لا شاشة/controls P0 |
| FR-48 | D-02؛ IA أسطح P1 المؤجلة | PF-1؛ UX-10 | P1 Reviews؛ PRD A-08 يبقى مفتوحًا |
| FR-49 | D-03؛ IA أسطح P1 المؤجلة | PF-3؛ UX-10 | P1 Brands؛ لا facets P0 |
| FR-50 | D-04؛ P0 returns boundary | PF-2؛ UX-10؛ TF-4 | portal P1؛ دعم/عمليات P0؛ proof mutation مستقل |
| FR-51 | D-05؛ IA أسطح P1 المؤجلة | PF-3؛ UX-10/12 | P1 reports؛ لا توسيع dashboard P0 |
| FR-52 | D-06؛ IA أسطح P1 المؤجلة | PF-3؛ UX-10 | P1 advanced coupons؛ لا Buy X Get Y P0 |
| FR-53 | D-07؛ IA أسطح P1 المؤجلة | PF-4؛ UX-10 | SMS/WhatsApp P1؛ Push مستقبلي لا Native |
| FR-54 | D-08 وA-16 P0 محدود | PF-4؛ UX-10 | بحث وتصدير audit P1 |
| FR-55 | S-14/16/A-08؛ snapshots | UJ-2، TF-2؛ UX-06 | حذف PII ينتظر retention/legal |
| FR-56 | A-03/04/05؛ FileUpload/Dialog | TF-2؛ UX-11 | archive default؛ check actual content |
| FR-57 | Forms/Tables/timezone | TF-2/5؛ UX-06/12 | unique; invariants لا UI override |
| FR-58 | errors/stale/Forms Open Items | جميع المحمية؛ UX-05/08 | عقد قبل القصص؛ لا regex/filters مخترعة |
| FR-59 | S-05/06/A-13/15 | UJ-4، TF-3/4؛ UX-08 | contracts/provider unresolved؛ no key UI |
| FR-60 | A-15/A-08/09؛ state/recovery | UJ-4/5، TF-4؛ UX-08 | safe correction/retry؛ parameters مفتوحة |

## تغطية NFRs وACs

| المصدر | مكان UX / الحد |
|---|---|
| NFR-01/02 | loading/layout stability + Foundation/Open Items؛ قياسات performance المستقبلية ليست نتائج النظام |
| NFR-03/05/06/07 | Pending/recovery/email/error؛ A-15؛ أهداف المواعيد PRD A-11 مشروطة |
| NFR-04/14 | Open Items؛ backend recovery/deployment بلا شاشة إدارة backup مخترعة؛ AC-22 دليل لاحق |
| NFR-08/09 | Accessibility Floor/Responsive/كل components؛ الأرقام PRD A-11 والتباين DESIGN unresolved |
| NFR-10/11 | interactions/stock/refund states؛ no repeat/overselling UI وخادم |
| NFR-12/13 | permissions/forms/SessionNotice/open consent/retention؛ لا بطاقة/أسرار/PII analytics |
| AC-01/02 | UJ-1/2/3؛ TF-2؛ تاريخ وعنوان ثابتان |
| AC-03/04/05 | UJ-1/2/4؛ التقديم/تنافس مخزون/موافقة فرق؛ verification الخادمي لاحق |
| AC-06/07/08 | UJ-4؛ pending/late/duplicate callback؛ لا أثر مالي جديد |
| AC-09/10/11 | forms coupon/totals/address؛ UJ-1؛ لا taux tax معتمد من المثال |
| AC-12/13 | guest/read-only/role matrix/TF-3؛ direct request لا يكشف |
| AC-14/15/16 | UJ-3/5 وTF-4؛ cancel/Refund/COD collection |
| AC-17/18 | TF-1/4؛ links/reset/mail failure |
| AC-19/20 | TF-2 وFileUpload/UX-10/11؛ source content integrity |
| AC-21 | Accessibility Floor/Responsive/Checkout states؛ اختبار تنفيذي لاحق |
| AC-22 | Open Items لا backup UI؛ أدلة runtime/restore لاحقة |
| AC-23/24 | UJ-3 وTF-5؛ stale/audit/sales definitions/purchase unique |

## Pass 1 — تغطية المصدر/الحالات/المكونات

هذا فحص ميكانيكي لا مراجعة جودة مستقلة ولا شهادة accessibility.

- **Flows:** خمس رحلات UJ-1…UJ-5 بعناوين المصدر حرفيًا، لكل منها خطوات مرقمة وذروة وفشل. TF-1…5 تجمع هوية/كتالوج/إدارة/استعادة/تقارير ضمن FRs، ولا شخصيات بحث مختلقة.
- **Surface closure:** S-01…S-16 وA-01…A-16 لكل سطح مصدر ودور وتدفق. Forms/Tables تفصل حقوله؛ State Patterns F تطبق loading/empty/error/success/focus/network/permission/session، والحالات المركبة تضيف failure الموضعية. D-01…D-08 تحدد 8 أسطح P1 مؤجلة ونماذجها وحالاتها، مع PF-1…PF-4 المسماة؛ P2 بلا surfaces.
- **Components:** 25 اسمًا في Component Patterns، متفق عليها مع DESIGN.md: Navigation, Breadcrumbs, SearchFilters, ProductCard, ProductGallery, VariantSelector, QuantityControl, FormField, FormFeedback, PrimaryAction, SecondaryAction, StatusBadge, DataTable, Pagination, DetailSection, TotalsSummary, StatusTimeline, ConfirmationDialog, FileUpload, StatePanel, InlineNotice, SessionNotice, KPIBlock, SalesChart, NotificationList. المطابقة النهائية موثقة في تقرير التحقق بعد تحرير الملفين.
- **Tokens:** EXPERIENCE.md لا يستعمل token مفقودًا؛ هوية المستخدم غير محددة، DESIGN.md token maps فارغة ومعلنة. downstream لا يستنتج palette أو library. الهوية/التباين gap مقصود وليست اكتفاء بصرية.
- **References:** مصدر Markdown واحد + paired DESIGN؛ لم تنشأ mocks/wireframes أو imports، فلا orphan visuals أو claims mock coverage.
- **Open decisions:** PRD A-01…11 وOQ-01…08 لم تعتمد. فرز numeric/role/provider/search/setting fields والمواعيد في Open Items؛ source hash يحدد النسخة.

المراجعة الاختيارية طلبها المستخدم صراحة بعد إنشاء المستندات، ونتائج مراجعة UX/accessibility تحفظ منفصلة عن هذا الاستخراج. لا اختبارات تطبيق أو كود تنفيذ أنشئت بهذه المهمة.
