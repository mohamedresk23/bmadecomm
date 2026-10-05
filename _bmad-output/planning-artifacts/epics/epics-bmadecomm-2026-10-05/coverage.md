# تغطية SRS والملاحم

المصدر PRD v2؛ هذا جدول تخصيص تخطيطي، لا دليل implementation أو اجتياز AC. **المالك الرئيسي** مسؤول اكتمال المتطلب وتجميع مساهمات الملاحم؛ ليس الوحيد الذي يطبق قواعده. FR مقسم صراحة لا يُعلن مكتملًا عند تسليم جزء مبكر.

| FR | المالك الرئيسي | مساهمات/حد التقسيم |
|---|---|---|
| FR-01 | 01 | تسجيل |
| FR-02 | 01 | 02 جلسة الإدارة وصلاحياتها |
| FR-03 | 01 | 15 guest claim بإثباتين |
| FR-04 | 01 | reset/session revoke |
| FR-05 | 15 | 01 إعادة إثبات البريد؛ 10 address snapshots |
| FR-06 | 02 | staff/last Owner |
| FR-07 | 02 | جميع ملاحم الفعل/المورد/الحقول تطبق policy hooks |
| FR-08 | 07 | draft/preview/publish/home |
| FR-09 | 06 | P1 controls حسب 21–23 فقط |
| FR-10 | 06 | search؛ Brand بعد23 |
| FR-11 | 06 | 07 editorial order؛ 13 delivered/returned facts؛ 22/23 P1 filters |
| FR-12 | 06 | 09 add/quantity validation؛ 10 Buy Now checkout completion |
| FR-13 | 04 | 05 inventory ownership؛ 06 variant display |
| FR-14 | 04 | product lifecycle |
| FR-15 | 04 | image/category safety |
| FR-16 | 06 | 04 edit metadata/slug redirects |
| FR-17 | 09 | 05 available؛ 08 pricing |
| FR-18 | 09 | 01 identity/merge |
| FR-19 | 08 | 09/10 review and authoritative submit |
| FR-20 | 08 | 10/11 atomic usage transitions؛ 26 advanced only |
| FR-21 | 10 | 11 online payment portion |
| FR-22 | 10 | 03 method/zone config؛ 15 account addresses |
| FR-23 | 10 | 05 reserve؛ 08 coupon؛ 11 provider intent after commit |
| FR-24 | 10 | 11 financial attempts/query؛ F-00 shared idempotency |
| FR-25 | 11 | trusted electronic payments |
| FR-26 | 13 | 10 COD Pending creation؛ 12 Confirmed |
| FR-27 | 11 | 18 operator UI؛ query already durable in11 |
| FR-28 | 11 | 05 full reacquire؛ 14 safe refund execution؛ 18 exception management |
| FR-29 | 15 | 10 protected result/read proof؛ 11 payment outcome |
| FR-30 | 05 | ledger/balances |
| FR-31 | 05 | 10 reserve،11 lasting Paid allocation،12 cancel release،13 ship consume |
| FR-32 | 05 | 10 submit stress/guard؛ لا backorders من checkbox |
| FR-33 | 12 | 15 customer visible subset؛ 14 refund presentation |
| FR-34 | 12 | 13 shipment/delivery transitions؛ 11 payment guard |
| FR-35 | 12 | 15 customer request؛ 14 refund task execution؛ 16 guest support proof |
| FR-36 | 13 | shipping/failure/retry/manual tracking |
| FR-37 | 14 | full/partial/COD payout/query |
| FR-38 | 13 | 05 ledger؛ 14 refund≠restock؛ 24 later portal |
| FR-39 | 12 | printable order document؛ legal tax invoice gate |
| FR-40 | 16 | 15 profile/addresses؛ 02 disable enforcement |
| FR-41 | 19 | 05/13/14 source facts |
| FR-42 | 03 | policy readers pricing/inventory/checkout؛ no retroactive writes |
| FR-43 | 17 | 01 account/verify/reset messages delivered early via F-00 |
| FR-44 | 17 | 18 recovery queues؛ NewReturn only24 |
| FR-45 | 02 | append/detail foundation؛ all mutations implement redacted event+resource detail؛ advanced28 |
| FR-46 | 20 | 21 wishlist_add عند P1 فقط |
| FR-47 | 21 | P1 |
| FR-48 | 22 | P1 |
| FR-49 | 23 | P1 |
| FR-50 | 24 | P1 |
| FR-51 | 25 | P1 |
| FR-52 | 26 | P1 |
| FR-53 | 27 | P1؛ Push ليس ضمنه |
| FR-54 | 28 | P1 |
| FR-55 | 10 | 04 archive؛12/15 history؛16 privacy deletion rules؛ all record readers |
| FR-56 | 04 | 03logo/23brand/24return uploads shared policy؛ no referenced hard delete |
| FR-57 | F-00 | 04 uniques؛05 stock؛08 money/coupon؛10order؛11provider؛14refund؛ universal constraints |
| FR-58 | F-00 | كل ملحمة تثبت contract قبل قصتها؛ لا API اختلاف screen/server |
| FR-59 | F-00 | 01/03/04/11/14/17/20/27 provider-specific sandbox/credentials/contracts |
| FR-60 | 18 | 05 expiry؛11 pay query؛14 refund query؛17 email retries durable early |

## NFR وأدلة القبول

| NFR | المسؤولية التخطيطية |
|---|---|
| 01 | 06/07/09/10 الأداء المرئي، release gate evidence |
| 02 | F-00 و05/06/08/10/11/14 load/concurrency، release gate |
| 03 | F-00/11/18 availability وprovider degradation |
| 04 | F-00 deploy/backup وrelease restore drill؛ لا يستبدل سجل التنفيذ |
| 05 | 11/14/18 reconciliation/alerts |
| 06 | 01/05/17/18 messages/expiry/recovery |
| 07 | F-00 correlation/audit؛11/14/18 alerts؛ كل producer |
| 08 | كل UI ملحمة؛ UX manual+automated evidence، contrast بعد الهوية |
| 09 | كل UI/upload ملحمة؛04image limits؛10checkout responsive |
| 10 | 05/08/10/11/13/14/17 آثار idempotent |
| 11 | 05/08/10/11 المخزون والكوبون |
| 12 | F-00/01/02 وكل API/file/financial mutation |
| 13 | 01/03/15/16/20؛27/28 P1؛ privacy gate before production |
| 14 | F-00 environments/migrations/rollback؛18 runbooks؛ release evidence |

| AC | تجميع الملاحم المطلوبة للسيناريو |
|---|---|
| 01 | 02–14 و17؛ دورة شراء وتشغيل كاملة |
| 02 | 01/10/15 |
| 03 | 05/08/10/11 |
| 04 | 05/10 |
| 05 | 05/08/09/10 |
| 06 | 11 |
| 07 | 10/11/18 |
| 08 | 05/10/11/14/18 |
| 09 | 08/10 |
| 10 | 08/10 |
| 11 | 03/10 |
| 12 | 01/10/15 |
| 13 | 02/12/14/16 |
| 14 | 05/12/13/14/15 |
| 15 | 11/13/14 |
| 16 | 10/12/13/19 |
| 17 | 01 |
| 18 | 01/10/17/18 |
| 19 | 04/06/10/15؛ P1 gating كل توسعة |
| 20 | 02/04/F-00؛uploads المشتركة |
| 21 | 06/09/10/11/15 وكل P0 UI |
| 22 | F-00/release gate و05/10/11/14/18 evidence |
| 23 | 02/12/13/14 |
| 24 | 08/10/11/12/13/14/19/20 |

لا متطلب FR غير مخصص، ولا P1 ضمن التزام الإطلاق. NFR/AC الأرقام أهداف مصدر غير معتمدة/غير مقاسة؛ validation للوثيقة لا يثبت تحقيقها.
