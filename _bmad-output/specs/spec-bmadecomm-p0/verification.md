# تحقق المواصفة وحدودها

نتيجة الفحص الميكانيكي النهائي: 20 CAP متزايدة فريدة، لكل منها intent وsuccess؛ 11 companion موجودة، و20 SA و12 BT. لا روابط مكسورة أو IDs مكررة. PRD بقي مطابقًا لـSHA256: F4B7305F359DFB89C660A596E63DF798729B506DD1884F67EF5198FFB9D76395.

التاريخ: 2026-10-05. نطاق التحقق وثائق P0؛ لا تنفيذ أو اختبارات تطبيق أو مراجعة مستقلة متعددة وكلاء.

## Pass 1 — Coherence

| Spec Law | نتيجة المراجعة |
|---|---|
| Intent وsuccess لكلcapability | 20 CAP، كل منها intent للنتيجة وsuccess قابلة للفحص، مقابلةEpic01–20 |
| WHAT مقابلHOW | kernel يحدد قدرات؛ APIs/DB/transactions/migrations فيcompanions |
| Constraints تصنعفرقًا | عدمpriceauthority للعميل، nooversell/doublemoney، statusseparation/immutable snapshots/denydefault/readproof، ADs والبوابات |
| Non-goals | P1/P2 وبعضمزاياالمنتجالمؤجلة والتنفيذ والنشر غيرمطلوبة، مذكورةصراحة |
| Success signal | دورةشراءوتشغيلمتكاملةمعتطابقمالومخزونوملكيةوأدلةAC/NFR، لاclaim تجاريغير محدد |
| IDs | CAP-1–20 فريدةمرتبةولاspecسابقةتحتاجmerge؛ mappingثابتإلىEpics |
| Lean | تفاصيلwire/DDLبواباتمعلومةلاتملأبطريقةمصطنعة؛ المصادرloadbearingمتبناةلاcopied كاملة |

الحكم: متسقة كمسودة مواصفة. readiness للقصص المتأثرة تظل مشروطة بـOQ/A وTC/VC، فلا تدعي المواصفة تغطية runtime أو اعتماد policy/provider.

## Pass 2 — Preservation

- الملاحم01–20 لها CAP-1–20، Frontend/Backend/DB وdependencies وacceptance فيcompanions. الملاحم21–28 خارجالنطاقحتىطلبجديد.
- FR-01–46 وFR55–60 هيP0؛ FR-47–54 صريحةoutofscope. كلFRP0 محفوظ فيقدرةأوcrosscuttingF00/adoptedcontract؛ coverageالأصليمتبنىفيcompanions، لا إسقاطFR57–60 لمجردأنهاshared.
- NFR-01–14 وAC01–24 محفوظةفيPRDمتبنىوفيخطةالأدلة، مع20SA و12BT تضيفتفصيلverification دون تغييرالمتطلب. A11أهدافغير مقاسةومشروطة، لاdefaultsمعلنةناجحة.
- AD1–18 متبناةreadonly؛ money/inventory/refundlocks/idempotency/outbox/proofs/audit/deployment/QA وlatecoupondecision gates محفوظة.
- UXالشاشاتS01–16/A01–16 والنماذج/filters/states/accessibility/responsive وقيودالهويةالمؤجلة محفوظةعبرالمصدرالمتبنىومصفوفةالقدرات. لا إضافةP1controls/bulk/offline/autosave أوألوانوخطوط.
- sourceconflicts:لا قرارمفتوححُسمضمنيًا؛ tax/providers/retention/roles/policyfields/staffMFA/searchnormalization/claim/recoverycontracts مازالتexplicitgates.
- **Wrapper-only content:** تقاريرالأدواتوعناوينالحواراتوالتاريخالإجرائي ليستproductrequirements؛ لاcompanionsقراءةruntimeلـREADME أو.memlog. سجل قيودالأداة هناprocessmetadataخارجkernel.

الحكم: مطالب المصدر المحملة محفوظة في kernel أوcompanions المتبناة/المؤلفة ضمن P0؛ لا ادعاء أن sources fully absorbed، ولذلك sources=[] والمراجع ذاتالقيمةفيcompanions.

## أداة BMAD

uv غير متاح، وpython.exe Windows Store alias فشل عند python --version. قُرئت customize/config مباشرة؛ hooks/persistentfacts/on_complete فارغة ولاoverride خاصbmad-spec مرصود. تنص [المهارة](../../../.agents/skills/bmad-spec/SKILL.md) على «Writes go through the shared script»؛ تعذر تشغيلmemlog.py، فلم تكتب.memlog.md يدويًا. SPEC تحمل derivation_mode صريحًا وتبقى draft مشتقةمنالمصادر، لا ادعاءنجاحذاكرةالمهارةالرسميةأوcanonical derivation المدعومبالlog. القراربديلتوثيقيلايغيرالمنتج.

نتيجتاPass1/2 مسجلتان هنا بدلevent رسميغير قابل للتشغيل. عند إتاحةinterpreter تُعادالتهيئةوالاشتقاقبحفظIDs والقراراتوالمراجع، دون إعادةتنفيذمنتجأوتغييرمصادره.

## حدود الأدلة

الفحصالميكانيكييفحصعددIDs/intent/success/companionexistence/links/sourcehashوصلاحيةالمراجع. لا تحميلحزمأواختبارserver/DB/UX/API/provider/load/restore، ولا ادعاءاجتيازsecurity/WCAG/SLO. كلroutes/payloads والتغييراتالبيانيةتصميم، وليستimplementedcode. لاstories ولاsprintstatus ولاdeployment.
