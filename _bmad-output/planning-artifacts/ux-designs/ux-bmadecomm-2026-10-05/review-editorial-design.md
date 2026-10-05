# DESIGN.md — مراجعة البنية والصياغة

التاريخ: 2026-10-05. النطاق: [DESIGN.md](DESIGN.md)، مع [DECISIONS.md](DECISIONS.md) و[PRD v2](../../prds/prd-bmadecomm-v2-2026-10-05/prd.md) لتفسير حدود المصدر. المستند يساعد مصمم UX والمراجع على فهم قيود العرض المشتقة من PRD دون اختيار هوية مرئية بدل المستخدم.

شُغّل منظور **structure** ثم **prose** فوق نتيجته، وفق توجيه `bmad-ux` إلى `bmad-review lenses=structure,prose`. نموذج البنية: **Reference/Database**؛ الأقسام تتبع ترتيب DESIGN.md الإلزامي وتستخدم جداول ذات حقول ثابتة. القارئ بشر، ودليل الصياغة المرجعي Microsoft Writing Style Guide. أُبقيت أسماء المكونات ومعرفات المتطلبات الإنجليزية لأنها مفاتيح تعاقدية بين الوثائق.

تعذر تشغيل word_metrics عبر Python غير المتاح في البيئة؛ الأرقام التالية **تقدير بحسب الكلمات المفصولة بمسافات**، يشمل frontmatter وعلامات الجداول: إجمالي 1583، المقدمة 139، Brand & Style 94، Colors 85، Typography 120، Layout & Spacing 312، Elevation & Depth 45، Shapes 34، Components 570، Do's and Don'ts 184. لا يوجد هدف طول مطلوب.

| Pass | Original Text | Revised Text | Changes |
|---|---|---|---|
| structure | المقدمة، الأقسام الثمانية، وجدول Components | PRESERVE | الترتيب يطابق مواصفة المهارة؛ قيود الألوان والخطوط والمسافات المؤجلة صريحة قبل التفاصيل. الإحالات السلوكية القصيرة تربط العرض بـEXPERIENCE ولا تستبدل عقده. أثر الكلمات: 0. |
| structure | Colors/Typography/Layout ثم صف التأجيل في Do's and Don'ts | PRESERVE | تكرار حالة الهوية المقصودة يقي قارئ كل قسم من تفسير غياب القيم على أنه إذن باختيارها. لا أوصي بحذفه بغرض الاختصار. أثر الكلمات: 0. |
| prose | Components → Navigation: «غياب الوجهات غير المخولة أو غير المطلقة.» | «غياب الوجهات غير المخولة أو غير المتاحة في الإصدار الحالي.» | تصحيح صياغة «المطلقة» الملتبسة لربطها بتوفر الوحدة في الإصدار؛ لا يغير FR-09 أو AC-19. زيادة تقديرية: 4 كلمات. |

لا توجد اقتراحات حذف أو إعادة ترتيب. اقتراح الصياغة الواحد يزيد الطول تقديريًا من 1583 إلى 1587 كلمة (0.25%)؛ لا يضحي بفهم القارئ. لم أعدل DESIGN.md أو PRD.

## تحقق المصدر والحدود

- كائنات `colors` و`typography` و`rounded` و`spacing` و`components` الفارغة مقصودة وفق اختيار المستخدم؛ ليست فجوة تحريرية تستدعي اختراع قيم.
- الأقسام الثمانية موجودة بالترتيب الإلزامي. لم يُختر framework أو UI system أو palette أو mock بصري.
- التباين مشتق من هدف NFR-08، ويُعرض بوصفه قيد تحقق مع استثناءات المعيار وليس شهادة امتثال. عرض 320/768/1024/1440px مشتق من NFR-09؛ A-11 وA-01 يظلان غير معتمدين.
- قرارات ترتيب الكتالوج والمنتج والسلة وCheckout والإدارة والمؤشرات ترتبط بـFRs أو أقسام PRD؛ لا تنشئ وظيفة مستقلة. P1 يظل مؤجلًا، ونسخة الهوية المؤجلة لا تقدم نفسها كمواصفة بصرية مكتملة.
- يحتوي جدول Components على 25 اسمًا: Navigation، Breadcrumbs، SearchFilters، ProductCard، ProductGallery، VariantSelector، QuantityControl، FormField، FormFeedback، PrimaryAction، SecondaryAction، StatusBadge، DataTable، Pagination، DetailSection، TotalsSummary، StatusTimeline، ConfirmationDialog، FileUpload، StatePanel، InlineNotice، SessionNotice، KPIBlock، SalesChart، NotificationList. جميعها أسماء تجميع/عرض لسلوك مؤصل في PRD وليست متطلبات منتج جديدة.
- **تحقق المطابقة بين الوثيقتين معلق وقت هذه المراجعة:** EXPERIENCE.md لم يكن موجودًا على القرص عند الفحص؛ ينبغي التحقق من مساواة مجموعة أسماء المكونات بعد وصوله، بدل الادعاء بإجراء فحص لم ينفذ.

هذه مراجعة تحريرية؛ لا تحل محل مراجعة UX أو الوصول التي طلبها المستخدم، ولا تجري اختبار تباين على ألوان لم تُختَر.
