# جاهزية التنفيذ بعد تقسيم الملاحم

التاريخ: 2026-10-05. **الحكم: FAIL للجاهزية التنفيذية الآن، وليس لفائدة تقسيم الملاحم.** خريطة capabilities مكتملة التخطيط في النطاق المطلوب، لكنها ليست stories جاهزة أو sprint commitment.

طبقت قراءة readiness-gate من bmad-sprint-planning على PRD v2 وUX والمعمارية وخريطة الملاحم. طلب المستخدم يقتصر على تقسيم الملاحم، فتم إنجازه قبل تقييم الجاهزية، ولا يُوسع تلقائيًا إلى إنشاء قصص أو توليد sprint-status.yaml.

| الأثر | الفجوة المسجلة | ما يغلقها |
|---|---|---|
| يمنع التنفيذ المتأثر | OQ-01–08 وA-01–11 في PRD غير معتمدة؛ السوق/الضرائب/المزود/السياسات/الأمان/الخصوصية/الأدوار تؤثر السلوك | حسمها مع أصحاب القرار وتحديث PRD عبر bmad-prd عند الحاجة، لا افتراض اعتمادها هنا |
| يمنع قصص الدفع/الكوبون | late Paid بعد تحرير آخر coupon claim واستهلاكه في طلب آخر؛ receipt/cap/snapshot guards ثابتة لكن سياسة التسوية مفتوحة | قرار OQ-03/04 المسجل في AD-4؛ تحديث العقود ثم قبول اختبارات الحالة |
| يمنع توزيع تنفيذ الوحدات | foundation library/compatibility pins وDDL/DTO/API/provider payloads التفصيلية لم تثبت؛ architecture الحالية بذرة وعقد consistency | تثبيت القرارات التقنية المتبقية عبر bmad-architecture/foundation specification قبل القصص التابعة |
| يمنع التزام sprint | لا stories بقبول تفصيلي قابلة للتنفيذ ولا sizing/capacity أو تعيين sprint | bmad-create-epics-and-stories من هذه الخريطة ثم فحص readiness؛ الجدولة والسعة وقت sprint planning |
| يمنع إثبات إطلاق | لا تطبيق أو أدلة runtime/SLO/load/accessibility/backup/provider sandbox؛ الهوية المرئية مؤجلة | قصص QA/التشغيل وتحقق release gate لاحقًا؛ لا حاجة لهذه الأدلة لإكمال خريطة الملاحم الآن |

الأولوية: القرارات التجارية المالية/التشغيلية المؤثرة، ثم عقود الأساس، ثم قصص لكل capability بعلاقات FR/AC/AD وcut-lines أعلاه. ليس كل OQ يمنع كل عمل: يمكن تفصيل شرائح لا تعتمد القرار المفتوح، لكن لا تُعلن القصة المتأثرة ready حتى حسمه. أسماء skills مسار تالٍ مقترح وليست invoked لهذه الجولة.

## حدود أدوات المهارة

uv غير متاح وفق فحص الجولة السابقة؛ قُرئت config/customize مباشرة، overrides لهذه المهارة غير موجودة، hooks/persistent facts فارغة. لم يجر sprint_plan.py لأن توليد tracking خارج طلب المستخدم ولأن gate لم يمر. لا يدعي هذا التقرير تشغيل parser أو status generator، ولم تكتب sprint-status.yaml يدويًا أو تنشئ حالة تقدم وهمية.

معرفات Epic01–28 هنا تخص التقسيم الجديد من PRD v2، وليست استمرارًا تلقائيًا لعناوين EPIC-01–22 الأصلية في addendum. أي story decomposition تالٍ يحافظ على هذه المعرفات أو يسجل mapping migration صريحًا؛ لا توجد tracking statuses سابقة تحتاج دمجًا.
