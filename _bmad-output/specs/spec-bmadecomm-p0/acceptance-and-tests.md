# معايير القبول واختبارات التنفيذ

كل معيار مرتبط بمتطلب PRD و CAP/Epic ؛ لا نتيجة اختبار حالية لأن التطبيق غير موجود. حدود A/OQ الرقمية تختبر بعد اعتمادها؛ لا تحذف flags من fixtures ثم تدعي اعتمادًا. هذه معايير مشتركة وليست stories.yaml أو تكليف تنفيذ.

## نتائج قبول القدرات

| Spec AC | الشرط والفعل والنتيجة القابلة للفحص | CAP / SRS / PRD AC |
|---|---|---|
| SA-01 | تسجيل بمدخلات صحيحة ثم retry: حساب واحد ورسالة إثبات منقحة؛ login خاطئ عام؛ proof استعمل/انتهى مرفوض؛ reset ناجح يبطل كل جلسات الحساب السابقة | 1 ؛ FR-01–04/43 ؛ AC-17 |
| SA-02 | موظف مع grant ثم revoke: الطلب التالي مرفوض دون أثر. مالكان يحاولان تعطيل نفسيهما بالتزامن: يبقى Owner نشط؛ Customer session لا تدخل Admin | 2 ؛ FR-06/07 ؛ AC-13 |
| SA-03 | تعطيل طريقة/منطقة ثم إرسالها إلى API: رفض. إعداد مالي جديد ثم قراءة Order قديمة ومحاولة Pending: snapshots والسياسة السابقة محفوظة؛ عملةبعد first order لا toggle | 3 ؛ FR-22/42/55 ؛ AC-11/19 |
| SA-04 | إنشاء product/variant ثم duplicate: SKU لا ينسخ و draft لا يظهر. cycleCategory/duplicatecombo/malformedimage رفض بلامرجعمنشور؛ archive referenced لا يحذف snapshot | 4 ؛ FR-13–16/56/57 ؛ AC-19/20 |
| SA-05 | OnHand1/Reserved0 مع 100reserve متزامن: successfulallocation واحدة، Available0 ، ledger مطابق؛ adjustment له actor/reason/prev/delta/new | 5 ؛ FR-30–32 ؛ AC-04 |
| SA-06 | q/filters/sort/page ثم navigationback: نفس URLcontext/count. variant required ناقص: noadd ؛ اختيار variant يغير SKU/price/stock/image ؛ slugoldredirect ولا privateindexing | 6 ؛ FR-09–12/16 ؛ AC-19/21 |
| SA-07 | مدير يحفظ draft ويعاين ثم publish: public لا يرى draft أو unpublishedproducts ؛ publication نسخةمتسقة و cache يحدثبعد commit | 7 ؛ FR-08/11 ؛ AC-19 |
| SA-08 | مثال exclusive التعليمي 150−15+20+13.50=168.50 وتوزيعات total exact ؛ inclusive لا doubletax. آخر claimcoupon متزامن لا يتجاوز cap ، customer-only غيرمثبت مرفوض | 8 ؛ FR-19/20/57 ؛ AC-09/10 |
| SA-09 | guest cart مستمرة؛ loginmerge لنوعينمتطابقين يجمع ويقيد Available ويوضحفرقًا؛ unavailable يبقى blocked ؛ retry لا يتكرر وال cart لا يحجز | 9 ؛ FR-17/18 ؛ AC-05 |
| SA-10 |10submit بمفتاحواحد ومنهامتزامنة:order واحدة/hold واحد. alteredpayload409 ؛ changedprice review قبل commit ؛ guest لا يجبر account ؛ shipping/billing snapshots صحيحة | 10 ؛ FR-21–24/29/55 ؛ AC-02/03/05/11/12 |
| SA-11 | redirect نجاح كاذب لا Paid ؛ signed success duplicate ثم old failed:receipt واحدة/Paid باقية. crash بعد charge وقبل save ثم query:نفس attempt بلا charge جديد. late Paid guard يثبتالمالدائمًا | 11 ؛ FR-25/27/28/31 ؛ AC-06–08 |
| SA-12 | expectedversion قديمة ثم confirm/cancel:409 دون write. cancel قبل ship يحرر hold مرة و Paid ينشئ refundtask ؛ customer request لا canceladmin ؛ printsnapshot لا taxinvoiceclaim | 12 ؛ FR-33–35/39 ؛ AC-14/23 |
| SA-13 |timelyPaid تخصيصهلاينتهي ب cleanup ؛ ship يخفض OnHand/Reserved مرة. COD Delivered يبقى Pending حتى amount/date/refcollection ؛ return failed لا restock حتى inspect ؛ repeatedinspect لا يزيد | 13 ؛ FR-26/31/34/36/38 ؛ AC-01/08/14/16 |
| SA-14 |receipt100/refund30 ثم 80 رفض؛ request60+60 متزامنانلايحجزان 120. unknown يبقي budget ؛ definitive failed يحرره؛ retry لا doublepayout/refund ولا restock | 14 ؛ FR-37/38 ؛ AC-15 |
| SA-15 |customerA لا ordersB ؛ addressprofileedit لا historicalchange. guestproofwrong/expired generic بلا existence ؛ readonly لا cancel/refund ؛ claim يحتاج verified email+order proof | 15 ؛ FR-03/05/29/35/55 ؛ AC-02/12/17 |
| SA-16 |support يرى necessaryPII لا cost/financialprivilege ، note actor audit ؛ disable لا يمحوه istory ؛ emailmatch لا claim. support inventory أو role grant يرفض | 16 ؛ FR-07/40/55 ؛ AC-13 |
| SA-17 |emailproviderdown بعد Ordercommit:Order باقية، delivery failure مرئي، retrydurable. createdPendingtemplate لا يقول Paid ؛ duplicatedjob لا يرسل مقصودًا مرتين | 17 ؛ FR-43/44 ؛ AC-18 |
| SA-18 |unknownpay/refundtask ثم authorized replay:query/command لنفس operation مع audit ، لا forcepaid أو SQLmanual. expired hold غير صالح ولو cleanup متأخر؛ alerts توجه للمسؤول المعتمد | 18 ؛ FR-27/28/60 ؛ AC-07/08/18/23 |
| SA-19 |dataset يحتوي CODuncollected/paid/partialrefund/twoUTCtimes:dashboard يطابق financial ledger و§10cohort/as_of/timezone ، حقولالدورلا تتسرب | 19 ؛ FR-41/55 ؛ AC-24 |
| SA-20 |onlinePaid/CODConfirmed ثم refresh/replayedcallback:purchase event واحدة/Order ؛ event يفرق accepted order عن collection ؛ consentdenied لا analyticsPII/event غير مأذون | 20 ؛ FR-46 ؛ AC-24 |

## اختبارات الحدود المشتركة

| Test | السيناريو والـ assertion | AD / المصدر |
|---|---|---|
| BT-01 |Price/stock/zone/method تتغيربين quote و submit ؛ لا commit بالعرضالقديم، reviewchanges مخولة | AD3/4/10 ؛ AC-05/11 |
| BT-02 |callback/expiry/ship/cancel تتنافسعلى Order/allocation ؛ لا double release/consume ، Confirmed allocation ليست expiring | AD3/6/7 ؛ AC-08/14 |
| BT-03 |قبضمتأخربعد cancel:Cancelled لا reopen ولا ship ؛ receipt دائم و refundtask ؛ stockunavailable لا oversell | AD6/7 ؛ AC-08 |
| BT-04 |cap1 ، claimReleased ، Order ثانية consumed ، late Paid للأولى؛ receipt لا rollback و cap لا overshoot و snapshot لا تعدل. settlementpolicy قرار مسجل قبل acceptance/fulfillment | AD4/18 ؛ FR-20/28 |
| BT-05 |refund unknown ثم callbacksuccess/querysuccessdouble ؛ budget/refundhistory مرة واحدة، noamountreleasedearly | AD5/8 ؛ AC-15 |
| BT-06 |worker crash قبل/بعد provider send وقبل ack/بعد leaseexpiry ؛ نفس key ، samebusinessoutcome ، nojobmemorylost | AD5/13 ؛ AC-07/18 |
| BT-07 |proof brute-force/reissue/URLlogs/referrer/anotherorder ؛ generic response و rate-limit و scopes صحيحة، secret لا logs | AD9/16 ؛ AC-12/20 |
| BT-08 |CSRF/injection/XSS/massassignment/costfield/permissionrevocation ؛ رفض/encoding/noauthorizeddata leak دون mutation | AD9/10/16 ؛ NFR-12/AC-13/20 |
| BT-09 |signedwrongamount/currency/order/provideraccount وتوقيع wrong/rawbody altered ؛ no financial mutation ، event فشلأثرهقابلللملاحظةمنقحًا | AD6/15 ؛ AC-06 |
| BT-10 |archive/categoryreassign/slugchange/addresschange بعد Order ؛ snapshot روابطتاريخيةثابتة ولا FKcascade يمحوالمال | AD2/4 ؛ AC-02/19 |
| BT-11 |deliveredpartialreturn/allreturned/damaged+partial refund ؛ qty limits ومخزونومال وحالاتمستقلة، Completed لا تمحى | AD7/8 ؛ FR-38/§7 |
| BT-12 |invalidactualimage/oversize/orphanupload ثم cancel/failure ؛ لا publicURL غير validated ولا brokenreference ؛ cleanup لا تحذفالمستخدم | AD14 ؛ AC-20 |

## أنواع الاختبار والأدلة

- **Unit:** money/discount/tax rounding وتوزيع residual ؛ state reducers ؛ coupon eligibility ؛ refund budget ؛ ownershipdecision. مدخلات متعددة وحواف مستقلة، لا tests تكرر implementation حرفيًا.
- **PostgreSQL integration:** realtransactions/locks/uniqueFK/check/rollback ، 100lastunit ، last coupon ، refund cap ، last Owner ، staleversions ، canonicalkey/replay. mockdatabase لا يثبتها.
- **API contract:** كل request/response/schema/error/rolefield وأنماط money/time/paging ؛ fixtures مشتركةبين browser/server ؛ unknownwritablefields رفض. tests تشمل providerbody/signatureinbox وثبوت dedupe.
- **Provider contract/sandbox:** create/query/refund و timeout و unknown و definitive failure و out-of-order ؛ يربط mappedstates بالتوثيقالرسمي للمزود المختار. لا productiontransactions بهذاالتكليف.
- **E2E:** guest/account/fullCOD+online و adminstaff/roles/catalog/order/shipping/refund/tracking ؛ حالات loading/empty/error/expired/stale من UX مع nooptimisticmoney و sessions.
- **Accessibility manual+automated:** keyboard/dialog/focus/labels/errors/alt/tables/chartdata ، nonhover/RTL conditional/320px/zoom/reflow ، passwordpaste/managers ؛ contrast بعد هويةمرئية. automatedscan وحدهغيركافٍ.
- **Load/operations:** targetsNFR01–07 بعد اعتماد A11/OQ-06 ؛ 10kproducts/100sessions/10submit-sec كأهدافمصدرلاقياسحالي. restoreRPO/RTO ، alerts/joblag ، migration/rollback ، providerdegradation وحماية invariants.
- **Observability/privacy:** لا rawcards/passwords/proofs/secretlinks/PII غيرضروري في logs أو analytics ؛ transaction audit و correlation عبر HTTP/outbox/provider ؛ consent/retentiongate.

## تعريف قبول المواصفة والتنفيذ

**المواصفة:**20CAP مع intent+success ، جميع P0FR وال NFR/AC مخصصة أو adoptedcompanion ، عقود/API/DB/UX/permissions/edgecases/dependencies/migration موجودة، لا P1 تنفيذية ولا newproductrequirements.

**Ready لقصة:**قراراتها OQ محلولة وعقود schemas/provideraction/permission/version/idempotency نهائية واختبارهاواضح؛ foundationpins متوافقة. draftspec لا يكفي.

**Done لقصة:**appropriateunit/integration/E2E/security/accessibility وأثر migration/telemetry مطابقةلنطاقها، لا Critical/Blocker ، وتحديث contract دون drift. إصدار P0 يقبل AC-01–24 والأدلة NFR المعتمدة وخططة restore/launch مستقلًا. لا statuspassruntime فيهذه الجولة.
