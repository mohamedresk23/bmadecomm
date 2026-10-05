---
id: SPEC-bmadecomm-p0
status: draft
scope: Epics 01–20 only
created: 2026-10-05
updated: 2026-10-05
derivation_mode: source-derived-fallback-official-memlog-unavailable
sources: []
companions:
  - implementation-requirements.md
  - api-contracts.md
  - acceptance-and-tests.md
  - dependencies-and-migrations.md
  - ../../planning-artifacts/prds/prd-bmadecomm-v2-2026-10-05/prd.md
  - ../../planning-artifacts/epics/epics-bmadecomm-2026-10-05/epics.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/architecture/architecture-bmadecomm-2026-10-05/SOLUTION-DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/EXPERIENCE.md
  - ../../planning-artifacts/ux-designs/ux-bmadecomm-2026-10-05/DESIGN.md
---

# مواصفة تنفيذ النظام — P0

هذه المواصفة و companions عقد تخطيط للقدرات P0. PRD يحكم المنتج، و ADs تحكم المعمارية، و UX يحكم السلوك. اعتماد المستخدم للنطاق جميع ملاحم P0 لا يغلق OQ أو يعتمد A. العقود التقنية المفصلة مقترحة للتثبيت المشترك قبل القصص؛ لا implementation بهذه الجولة. المراجع المتبناة تحتوي P1 أيضًا، ويقتصر إلزامها هنا على P0 والقواعد المشتركة، لا توسع النطاق إلى ملاحم 21–28.

## Why

توفير دورة B2C يستطيع الضيف والعميل فيها اختيار منتج وشراءه وتتبع الطلب، وتستطيع الإدارة إدارة المخزون والتسليم والقبض والاسترداد بأثر موثوق، دون تدخل المطور في المعالجة المعتادة. الأولوية منع بيع زائد أو أثر مالي مكرر أو قراءة غير مخولة، مع قابلية التعافي عند انقطاع المزود.

## Capabilities

- **CAP-1 — Epic01 ، FR-01–04/43:** **intent:** يصل العميل إلى حسابه ويثبت بريده ويستعيده. **success:** reset أحادي الاستخدام يبطل الجلسات؛ فشل الدخول/الاستعادة لا يكشف الحساب؛ AC-17.
- **CAP-2 — Epic02 ، FR-06/07/45:** **intent:** يدير المالك وصول الموظفين. **success:** سحب الدور يمنع الطلب التالي وآخر Owner لا يعطل تحت التنافس؛ AC-13.
- **CAP-3 — Epic03 ، FR-42/22/55:** **intent:** يضبط المالك سياسات البيع. **success:** طرق معطلة مرفوضة و setting جديدة لا تعدل Order قديمة؛ AC-11/19.
- **CAP-4 — Epic04 ، FR-13–15/16/56/57:** **intent:** ينشئ الفريق كتالوجًا صالحًا للبيع. **success:** variant/SKU/combo فريدة، draft مخفي، upload مخالف مرفوض؛ AC-19/20.
- **CAP-5 — Epic05 ، FR-30–32/57:** **intent:** يراقب الفريق ويعدل المخزون بأثر صحيح. **success:** Available=1 مع 100 reserve ينتج نجاحًا واحدًا و ledger مطابقًا؛ AC-04.
- **CAP-6 — Epic06 ، FR-09–12/16:** **intent:** يجد المشتري منتجًا ويختار نوعه. **success:** URL يستعيد البحث/الفلاتر، اختيار النوع يغير بياناته، لا private indexing ؛ AC-19/21.
- **CAP-7 — Epic07 ، FR-08/11:** **intent:** ينشر المدير محتوى الرئيسية. **success:** preview مخول، draft غير عام، publication متسقة بمراجع منشورة فقط؛ AC-19.
- **CAP-8 — Epic08 ، FR-19/20/57:** **intent:** يحصل المشتري على سعر وخصم صحيحين. **success:** allocations تطابق total ، coupon cap لا يتجاوز بالتنافس؛ AC-09/10.
- **CAP-9 — Epic09 ، FR-17/18:** **intent:** يحفظ المشتري سلته ويستأنفها. **success:** الدمج يجمع ثم يقيد المتاح ويوضح الفروق، ولا reserve بمجرد الإضافة؛ AC-05.
- **CAP-10 — Epic10 ، FR-21–24/26/29/55:** **intent:** يقدم الضيف أو الحساب طلب COD بعد مراجعة. **success:** عشر retries تعيد Order واحدة وحجزًا واحدًا و snapshot ثابتًا؛ AC-02–05/11/12.
- **CAP-11 — Epic11 ، FR-25/27/28/24/31:** **intent:** يدفع المشتري إلكترونيًا ويعرف الحقيقة رغم الانقطاع. **success:** trusted success مرة واحدة، unknown لا charge جديد، late Paid محفوظ تحت guards ؛ AC-06–08.
- **CAP-12 — Epic12 ، FR-33–35/39:** **intent:** يؤكد الفريق الطلب أو يلغيه ضمن السياسة. **success:** stale مرفوض، cancellation يحرر مرة واحدة ويخلق مهمة رد المال، print يطابق snapshot ؛ AC-14/23.
- **CAP-13 — Epic13 ، FR-26/34/36/38/31:** **intent:** يسجل الفريق الشحن والتسليم والقبض والعائد كوقائع مستقلة. **success:** ship يصرف مرة، Delivered COD لا Paid ، inspect فقط يعيد الصالح؛ AC-01/14/16.
- **CAP-14 — Epic14 ، FR-37:** **intent:** يرد المخول مبلغًا كاملًا أو جزئيًا. **success:** confirmed+Pending refunds≤received ، unknown يبقي budget ، retry لا يضاعف؛ AC-15.
- **CAP-15 — Epic15 ، FR-05/29/35/03/55:** **intent:** يدير العميل بياناته ويتتبع صاحب الطلب طلبه. **success:** owner ship مفروض، guest read-only ، claim يحتاج الإثباتين، لا تغيير تاريخ الطلب؛ AC-02/12/17.
- **CAP-16 — Epic16 ، FR-40/07/35:** **intent:** يخدم الدعم العميل بسياق مخول. **success:** note/disable لها أثر، لا inventory/refund/grant غير مصرح، ولا merge بريد تلقائي؛ AC-13.
- **CAP-17 — Epic17 ، FR-43/44:** **intent:** تصل رسائل الطلب والتنبيهات إلى المعنيين. **success:** email failure لا يلغي Order و retry durable ، Pending لا يعلن Paid ؛ AC-18.
- **CAP-18 — Epic18 ، FR-60/27/28/44:** **intent:** يعالج الفريق استثناءات التشغيل بأمان. **success:** replay يستعلم عن نفس المحاولة، لا force-paid أو تعديل DB يدوي، trace/audit كامل؛ AC-07/08/18/23.
- **CAP-19 — Epic19 ، FR-41:** **intent:** يرى المخول مؤشرات تشغيل ومال موثوقة. **success:** dashboard يطابق receipts/refunds/delivered seed وتعريفات §10 ؛ AC-24.
- **CAP-20 — Epic20 ، FR-46:** **intent:** يقيس الفريق رحلة شراء مأذون بقياسها. **success:** purchase واحد عند Paid online/Confirmed COD ، لا refresh duplicate أو PII ؛ AC-24.

## Constraints

- Next.js/TypeScript/PostgreSQL modular monolith والبنية الموافق عليها؛ AD-1–18 ملزمة للاتساق، دون اختيار provider/ORM/auth/UI library ضمني.
- الخادم حقيقة السعر والمخزون والملكية؛ transactions و idempotency تحمي المحلي، وتسوية تحمي آثار المزود؛ لا exactly-once شبكي مفترض.
- OrderStatus/PaymentStatus/FulfillmentStatus مستقلة؛ snapshots ثابتة، Completed لا يختفي بسبب refund/return.
- FR-55–60 و NFR-01–14 مشتركة بقدر المجال؛ الأرقام المشروطة A-11 لا تدعى معتمدة أو مقاسة. كل capability تملك أثرها وتحقيق auth/accessibility/error ، لا تؤجلها إلى نهاية المشروع.
- OQ/A وقرارات contract المعلقة تمنع القصة المتأثرة من readiness. لا tax=0 أو مزود وهمي ك default إطلاق.
- الهوية المرئية غير محددة بطلب المستخدم؛ لا palette/font/UI kit مفترضة، جميع إجراءات P0 متاحة mobile/keyboard وفق UX.

## Non-goals

- Epics21–28 و FR-47–54: wishlist/reviews/brands/return portal/advanced reports/coupons/channels/audit search-export.
- P2 و marketplace/multistore/native apps/ERP/WMS ومزايا البحث المتقدم، partial shipment ، backorders دون سياسة، tax invoice قانونية دون اعتماد.
- كتابة كود أو تثبيت حزم أو DDL migrations فعلية أو نشر أو دفع حقيقي أو stories.yaml بهذه الجولة.

## Success signal

ضيف وعميل ينفذان شراءً كاملًا، يدير الفريق طلبه حتى التسليم والتحصيل أو الاسترداد الصحيح، وتظل المبالغ والمخزون والملكية متسقة عند retries والتنافس والانقطاع. قبول P0 يجمع AC-01–24 والأدلة المعتمدة لـ NFRs ؛ لا تقبل قدرة ناقصة لمجرد أن API تعيد 200.

## Assumptions

A-01–11 تُورث كمقترحات فقط: السوق/العملة/RTL والمخزن، COD/gateway/carrier manual ، coupon/rounding ، TTL/cancel/return ، reviewsP1 ، password/MFA/sessions/guest proof ، numeric SLO/browser/uploads. تفاصيلها في PRD §14 ، ولا تعتمد هنا.

## Open Questions

- OQ-01–08 من PRD §13 ، مع المالك وموعد الحسم في dependencies-and-migrations.md.
- سياسة late Paid بعد Released coupon واستهلاك آخر claim لطلب آخر: receipt محفوظ و cap/snapshot لا تنتهك؛ settlement business policy تنتظر OQ-03/04.
- foundation compatibility/ORM-or-driver/auth/schema validation/test tooling pins ، وعقود staff provisioning/MFA recovery/guest claim/content/settings/search normalization وحدود الحقول نهائية قبل قصصها.
- NFR budgets/hosting/region/retention/provider sandbox والهوية المرئية قبل اختبارات/إطلاق تتأثر بها؛ لا تمنع تعريف المواصفة النصية.
