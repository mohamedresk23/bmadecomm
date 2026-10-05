# أدلة الحزمة والتقنيات

تاريخ القراءة: 2026-10-05. هذه مراجعة توثيق رسمي عبر الويب، لا تنفيذ starter أو اختبار توافق runtime. تعاد قراءة الإصدارات والتنبيهات الأمنية قبل bootstrap وتثبت dependencies في lockfile. لا حزم مثبتة الآن.

| التقنية/العقد | نتيجة القراءة وحدودها | المصدر الأولي |
|---|---|---|
| Next.js / starter | الصفحة الحالية تعرض 16.3.8. create-next-app بداية رسمية؛ default يستخدم TypeScript وApp Router وESLint وTailwind وTurbopack. نستخدم تخصيص src/؛ اختيار starter لا يعتمد ألوان Tailwind أو UI library ولا ينشئ AGENTS overrides دون فحص ملفات المشروع. Node minimum 20.9، وليست توصية باستخدام إصدار EOL. | [Installation](https://nextjs.org/docs/app/getting-started/installation) |
| Node | 24 LTS، الموقع يعرض latest LTS 24.21.0؛ 26 Current وقت القراءة. نوصي LTS للـweb والworker نفسه. | [Release policy](https://nodejs.org/en/about/previous-releases) |
| TypeScript | صفحة التنزيل تعرض 7.0؛ توفر lockfile/version مشروع. لم يُختبر مع Next starter؛ compiler الفعلي يحتاج compatibility gate قبل تثبيته، ولا نفرض أحدث major من رقم الصفحة فقط. | [Download](https://www.typescriptlang.org/download/) |
| PostgreSQL | versioning يعرض 18.6 مدعومًا، ويدعو إلى تحديث minor. يحتفظ major seed لا upgrade بلا فحص migration. | [Versioning](https://www.postgresql.org/support/versioning/) |
| Transactions | row locks وآثار deadlock تبرر ترتيب قفل عالمي ومعاملات قصيرة. يعتمد التصميم على locks/constraints والتكرار المحلي المحدود، لا قراءة المتاح ثم كتابة غير محمية. | [Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html) |
| Authentication | Next.js يوفر إرشاد فصل auth/session/authorization ولا يصبح framework نفسه خدمة هوية. اختيار مكتبة آمنة متوافقة مؤجل foundation gate. | [Authentication](https://nextjs.org/docs/app/guides/authentication) |
| Hosting/cache | self-hosting موثق، يحتاج إدارة proxy/cache والتنسيق عند تعدد instances. تصميم web+worker لا يفترض serverless background دوامًا أو cache محلية مشتركة. | [Self hosting](https://nextjs.org/docs/app/guides/self-hosting) |
| Sessions/passwords | secure cookies وrevocation/token hygiene، hash password بخوارزمية تكيفية موثوقة. لا تُكتب crypto أو session library يدويًا؛ اختيار مكتبة/parameters بعد threat/compatibility gate. | [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)، [OWASP passwords](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) |

لا Prisma/Drizzle/Auth.js/Redis/S3-provider/Playwright pinned؛ المقارنة والنسخ مسؤولية foundation contract قبل القصص، ولا يحق لكل قصة اختيار بديل مستقل. Object storage وREST/outbox أنماط عقود لا أسماء خدمات مشتراة. بوابة الدفع الحقيقية غير مختارة؛ أمثلة المزودين في PRD لا تمنح اعتمادًا لهم.

## Bootstrap gate قبل أي تنفيذ مستقل

1. يثبت عقد حزمة واحدة: starter/framework/React المتوافق/TypeScript compiler/Node، driver أو ORM مع migration runner، مكتبة identity/validation وأدوات QA. يفحص peer ranges/security، ويثبت lockfile مع build/typecheck في foundation story.
2. تُحسم auth library بقدرتها على sessions قابلة للإبطال والأدوار والpassword-reset والguest proof؛ لا يستبدل OAuth-only متطلبات حساب/password موجودة.
3. يثبت schema migration transaction API يستطيع تمرير نفس connection/context عبر الوحدات، وأقفال row SQL صريحة. ORM يخفي FOR UPDATE أو monetary precision غير ملائم لا يعتمد بلا حل.
4. تُثبت PostgreSQL وNode supported patches عند التنفيذ، ولا تكتب pins docs بديلًا عن lockfile/release evidence.
5. يستكمل provider sandbox/privacy/region وOQ دون معاملات production؛ المرحلة الحالية لا تنفذ هذه الخطوات.
