# تحقق تقسيم الملاحم

التاريخ: 2026-10-05. المراجعة تخطيطية وميكانيكية، لا اختبارات تطبيق أو مراجعة مستقلة متعددة وكلاء.

| الفحص | النتيجة |
|---|---|
| عدد الملاحم | 28 بمعرفات01–28؛20 P0 و8 P1 |
| اكتمال بنية كل ملحمة | الاسم، الهدف، FR، الحدود، الاعتماديات، frontend/backend/DB، نتيجة قبول رئيسية موجودة في كل28 |
| FR coverage |60 صفًا فريدًا؛FR-01–60 كلها مخصصة؛cross-cutting موضح بـF-00/مساهمي المجالات لا مهمل |
| NFR/AC |14 NFR و24 AC لها مالك/تجميع ملاحم أو دليل release gate |
| الاعتماديات |كل Epic dependency الصلبة على ID سابق؛لا دورة أو اعتماد أمامي. التكاملات المستقبلية مفصولة ولا تعتبر إعلان اكتمال FR متعدد الأجزاء |
| حدود الأعمال |هويات/كتالوج/اختيار/شراء/دفع/تشغيل/استرداد/خدمة/قياس؛لا frontend أوDB ملحمة مستقلة. F-00 تمكين،release gate أدلة وليسا epic business capability |
| القواعد الخطرة |capture/audit/outbox/auth مبكرة؛COD Delivered لا يساوي Paid؛refund لا restock؛unknown لا retry charge؛الحجز/coupon cap/receipt محفوظة طبق ADs |
| النطاق |P1 wishlist/reviews/brands/returns/advanced reports/coupons/channels/audit مؤجلة؛P2 خارج التقسيم؛لا partial shipment أو tax invoice/CRM/export غير مطلوب |
| المصدر |PRD SHA256=F4B7305F359DFB89C660A596E63DF798729B506DD1884F67EF5198FFB9D76395؛مطابق قبل/بعد المهمة |
| الروابط |مصادر المنتج/UX/المعمارية وملفات الحزمة موجودة |

فحص PowerShell المحلي قرأ headings/حقول كل ملحمة وصفوف التغطية ومراجع dependency؛لا sprint_plan.py أواختبار runnable-code نُفذ. أظهرت القراءة الأولية مراجع future integrations في سطر الاعتماديات؛فُصلت عن الاعتماديات الصلبة ثم أعيد الفحص دون forward dependencies.

## حدود الحكم

المتطلب المقسم لا يكتمل بمجرد إنهاء مالكه الرئيسي إن بقي مساهم: FR-12 إضافة/BuyNow،FR-23 provider initiation،FR-26 collection،FR-28 exception refund،FR-29 tracking،FR-31 ship/release،FR-34 fulfillment،FR-35 customer request/refund،FR-43 order messages أمثلة صريحة. لا تمثل الشريحة الأولى إطلاق COD-only أو دورة شراء كاملة.

خريطة الملاحم مقترحة وقابلة لتفصيل تدريجي؛لا دليل sizing/velocity/capacity،ولا عقد ثابت لكلstory،ولا status/backlog file يوهم أن القصص جاهزة. readiness التنفيذية FAIL للأسباب المسجلة في [readiness.md](readiness.md)،مع بقاء إنجاز طلب التقسيم كاملًا.
