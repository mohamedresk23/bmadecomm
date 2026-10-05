# متطلبات التنفيذ وملكية البيانات

النطاق CAP-1–20 فقط. المعمارية و UX مراجع متبناة يجب قراءتها؛ هنا متطلبات عملية تربط أعمال الشاشة والخادم و schema دون إعادة كتابة تفاصيل source. CAP-N يقابل EpicN ، وهو ربط ثابت لا إعادة ترقيم لاحقة. API names/field conventions في api-contracts.md مسودة تقنية مشتركة؛ OQ ليست values قابلة للنشر.

## قواعد الأعمال

| Rule | القاعدة الملزمة | المصدر/القدرات |
|---|---|---|
| BR-01 | email normalized unique ؛ auth failures عامة؛ proofs hashed/scoped/single-use ؛ reset/revoke يبطـلان الجلسات، لا customer admin privileges | FR-01–07 ؛ CAP1/2 ؛ AD-9 |
| BR-02 | active Owner guard serialized تحت grant/revoke/disable ثم count داخل transaction ؛ authorization action/resource/field قبل كشف DTO أو replay | FR-06/07 ؛ CAP2 ؛ AD-9 |
| BR-03 | publish مستقل عن stock ؛ variants inactive/archived لا شراء جديد؛ duplicate draft لا copiesSKU ؛ referenced hard delete ممنوع | FR-13–16/56 ؛ CAP4/6 ؛ AD-2/14 |
| BR-04 | cart لا reserve ؛ merge sum ثم clamp ويعرض تغييرات/blocked items ؛ submit يعيد السعر/الأهلية/المخزون | FR-17–19 ؛ CAP9/10 ؛ AD-3/11 |
| BR-05 | money minor-unit exact مع currency/scale ، proportions exact decimal ثم approved rounding ؛ Sale≤Regular ، ComparePrice/Cost لا يضافان للمبلغ؛ inclusive لا tax إضافية | FR-19/20/57 ؛§6.1 ؛ CAP8/10 ؛ AD-4 |
| BR-06 | coupon cap ذري مع reserved/consumed claims وهوية أهلية مثبتة؛ failed attempt لا يحرر claim إذا retry قائم؛ release عند إنهاء غير المقبول. سياسة منع إعادة cap بعد accepted مقترح source | FR-20 ؛§6.1 ؛ CAP8/10/11 ؛ AD-4 |
| BR-07 | Order Pending/snapshots/reservation/key/attempt/outbox commit قبل provider network ؛ لا network داخل lock transaction ؛ same key+same hash نفس المورد، altered payload conflict | FR-23/24 ؛ CAP10/11 ؛ AD-3/5/6 |
| BR-08 | balance+ledger+allocation mutations ذرية؛ locks Order ثم variants تصاعديًا ثم coupon ، refund Order ثم receipts/budgets ترتيب ID ؛ no oversell عند تعطيل backorders | FR-30–32/37 ؛ CAP5/10/11/13/14 ؛ AD-3/8 |
| BR-09 | timelyPaid يحول expiring hold لتخصيص دائم لا خصم OnHand ؛ ship ينقص OnHand و Reserved مرة؛ expired غير صالح ولو worker متأخر | FR-31 ؛ CAP5/11/13 ؛ AD-7/13 |
| BR-10 | signed callback أو trusted query يثبت Paid ؛ redirect عرض فقط؛ duplicate/out-of-order reducer لا يعكس Paid. unknown لا ينشئ محاولة مالية جديدة | FR-25/27 ؛ CAP11 ؛ AD-5/6 |
| BR-11 | late Paid receipt دائم، full stock reacquire ذرّي إن noncancelled ومتاح وإلا refund-task/blockship ؛ coupon cap exception لا rollback للقبض ولا تغير snapshot ويحتاج settlement decision | FR-28 ؛ CAP11/14/18 ؛ AD-4/6 |
| BR-12 | ثلاث حالات مستقلة من PRD§7 ؛ stale expected_version conflict ؛ customer cancel request لا administrative cancel ؛ Cancelled نهائي لا تجهيز جديد | FR-33–36 ؛ CAP12/13/15 ؛ AD-7 |
| BR-13 | Delivered COD لا Paid ؛ collection amount/time/ref مخولة idempotent ؛ discrepancy visible ؛ refund COD payout confirmed خارجي | FR-26/37 ؛ CAP13/14 ؛ AD-7/8 |
| BR-14 | confirmed+unresolved refund sums≤confirmedreceipts ؛ budget قبل network ؛ unknown يبقيه، definitive failure يحرره؛ no restock by refund | FR-37/38 ؛ CAP14/13 ؛ AD-8 |
| BR-15 | returned unit count لا يتجاوز shippedremaining ؛ inspect الصالح فقط available ، damaged حركةمنفصلة؛ partial return يبقي Delivered حتى all returned | FR-38 ؛§7.2 ؛ CAP13 ؛ AD-8 |
| BR-16 | snapshots money/items/addresses ثابتة؛ archive/profile/settings لا rewritehistorical ، currency change بعد first order خارج MVP ؛ print ليس taxinvoice معتمدة | FR-39/42/55 ؛ CAP3/10/12/15 ؛ AD-4 |
| BR-17 | guest read proof طلب واحد فقط؛ secret invalid لا existence leak ؛ claim email proof+order proof ؛لا guest read mutation/refund/editmail | FR-03/29/35 ؛ CAP10/15/16 ؛ AD-9 |
| BR-18 | outbox/audit مع source transaction ؛ worker at-least-once مع dedupe/lease ؛ email failure لا rollback ؛ recovery مخولة لا forcepaid | FR-43–45/60 ؛ CAP1/2/17/18 ؛ AD-13/15 |
| BR-19 | مالية dashboard من receipts/refunds/fulfillment وفق§10 لا analytics ولا أسعار حية؛ purchase onlinePaid/CODConfirmed مرة، consent قبل telemetry ولا PII | FR-41/46 ؛ CAP19/20 ؛ AD-15 |

## واجهة وخادم وبيانات كل قدرة

الأسماء في DB استراتيجية changes لا SQL جاهز. FKs/uniques/checks المنفذة لاحقًا جزء acceptance ،وليست مهمة هذه الجولة.

| CAP | Frontend/UX المطلوبة | Backend owner ship والعمليات | تغييرات DB والعقد الحاسم |
|---|---|---|---|
| 1 | S08–12 تسجيل/login/verify/reset ، field feedback و expired/invalid | identity session/proof/accountmessages | users(unique normalized email,status,password hash,version)، sessions(token hash,scope,expiry,revocation)، proof_tokens(purpose,hash,subject,expiry,consumed)، outbox/deliveries |
| 2 | A01/A14 loginstaff/roles وأثرعلىالمورد، role navigation | identity grant/disable/Ownerguard ، audit append/detail | roles/permissions/user_roles و active Owner guard row ، redacted audit_events ؛ staff bootstrap workflowpending |
| 3 | A13 store/support/localization/method/policy settings | content/settings owns config versions ، read policy DTO لكل module | settings/policyversions ، media metadata لل logo ؛ schemazones/financialfields تحت OQ |
| 4 | A03–05 product/variant/category/image/SEO draft workflows | catalog CRUD/duplicate/archive/publish ، media validate ، slugredirect | products/variants(uniqueSKU/combo)/categories(no cycles)/product_categories/attributes/media/slug_redirects(unique sourcepath) |
| 5 | A06 balances/adjustments/lowstock وال ledger readonly | inventory reserve/allocate/release/ship/inspect ports ، workerexpiry | stock_balances(variant/warehousekey,onhand,reserved)، allocations(order,item,qty,expiry,state)، ledger(unique effect,delta,before,after,actor,reason) |
| 6 | S02/03 publicsearch/filters/URL/paging/gallery/variant/SEO | catalog publicread/searchmetadata ؛ stockreads لا reservation | publishedqueries/variantavailability/indexes ؛ delivered-ranking source contract ، noP1schema |
| 7 | S01/A12 sections enabled/draft/preview/publish/ordering nondragalternative | content publication atomic ، publiccacheinvalidation | homepage_drafts/publications(version/contentreferences)، previewauthorized |
| 8 | A11 basiccoupons ، sharedTotalsSummary/feedback | pricing/coupons owns rules/quote/allocation ، no charge | couponeligibility/usages(Reserved/Consumed/Released,uniqueclaim)/policyversions ، exactmoneyfields |
| 9 | S04/quantity/badge/merge notices/blockeditems | cart guest+account persistence/merge/revalidate | carts(ownerkind,owner ref)، cart_items(unique cart+variant,positive qty)، mergeoperation key |
| 10 | S05/06 بياناتضيف وعنوانان ومراجعة و COD result | checkout coordinate owners:pricing/inventory/orders/coupon/proof | orders(unique number,customer nullable,version,currency,scale/status)، immutable orderitems/totals/address snapshots ، operation_keys(scope,hash,result),attempt/outbox |
| 11 | onlinehandoff/result/unknown لا successoptimistic | payments create/query/inbox/reducer/late/expiry reconciliation | payment_attempts(ref,provider key,amount,currency,state)، receipts(unique trusted ref)، providerevents(dedupe/processed)، reconciliationtasks |
| 12 | A07/08 filters/history/notes/confirm/cancel/print | orders transitions/version ، fulfillmentpreparation ، refund-task creation | order_history/cancelrequests/fulfillmentrecords/internalnotes/audit ، readonly snapshots |
| 13 | A08 shipment/tracking/CODcollection/inspection | fulfillment transitions ، inventoryconsume/inspect ، paymentsCODreceipt | shipment_records(full-orderP0)/return_inspections(itemqty/disposition/businesskey)، COD receipts/history |
| 14 | A09 refundableamount/allocations/reason/confirm/Pending | refunds atomicbudget/initiate/query/finalize/CODpayout | refunds(uniqueop/attempt,state,reserved budget)/allocations(item-or-shipping-or-taxcomponents)؛ cap enforced under lock |
| 15 | S07/S13–16 profile/addresses/ownorders/tracking/cancelrequest | customers owner ship ، identityproof/reissue/claim ، ordersread | customer_addresses(userFK/version)، orders verified owner linkage ، proof scope ، لا يغير snapshots |
| 16 | A10 customerlist/detail/spending/notes/disable ، support scoped orderview | customers authorizedqueries/notes ، identitydisable ، verified support procedure | customer_notes(ownerresource/actor)، readonlyfinancialjoins ؛ no autogenerated guest user |
| 17 | A15 notifications/delivery failures ؛ emails requiredevents | notifications subscriptions/templates/retry/lease/dedupe | notification_deliveries(event,channel,recipient reference,status,attempts)، outbox/jobattempts；retention/PIIgate |
| 18 | A15 unknown/recovery tasks/detail/actions/status | safequery/replay coordinators/audit/alerting ، serviceactor scope | reconciliationtasks/jobs/outbox/actionhistory ، no directmutationforcepaid |
| 19 | A02 KPIs/chart accessibledata/date/recent/top/lowstock | reporting readonlycomputed/projection definitions §10 | receipts/refunds/fulfillment/order cohortqueries；optional projection as_of onlyif justified |
| 20 | consent-gated namedfunnel instrumentation noPII | business purchase dedupe producer onPaid/CODConfirm ، analyticsadapter | unique orderpurchaseevent/outbox metadata ، no behavioralwarehouse |

## validation rules

- طلبات HTTP تتحقق runtime من shape/type/required/allowlist ؛ unknown writablefields ترفض؛ TypeScript وحده ليس validator. لا massassignment amount/status/actor/roles.
- الاسم/email/phone/password registration required ؛ normalized email unique تحت concurrency. exactnormalization/phone/textlimits/passwordvalues gateFR58/OQ06 ؛لا regex سوق مفترض.
- addresses country/governorate/city-or-zone/line/building/phone ؛ postal conditionalmethod ؛ billing default shipping مع splitexplicit ؛ shippingeligibility على الخادم من approved policy ، no taxzero fallback.
- quantity integer positive وحدود available عند no-backorders ؛ variantchoicesrequired و active published ؛القيم submittedmoney ليستحقيقة.
- productname/categoryvalid/nonnegprice/SKUunique/uniquecombo ؛ Sale>Regular reject ؛ categoryparentcycle reject ؛ archive referenced category يتطلب reassignment.
- coupon time/eligibility/usage caps/minimum/max مأخوذةمن approvedrule ؛ wrong customer proofreject ؛ limits underrowlocks.
- expected_version mandatorymutations لموارد mutable ؛ keys charge/refund/stock/submit scoped+hash ؛ same payload return same ، changedpayload409.
- uploads actualdecode/type/size/count/quarantine/publish ؛حدود JPEG/PNG/WebP/5MB/10images proposedA11 ،رفض wrongactualtype قبل publicreference.
- transitions من PRD§7 ، no free PATCHfinancialstate ؛ refundableamount يشمل Pending budget ؛ returned quantity≤shippedminuspreviousreturns.

## permissions/security

denydefault لكل action/resource/field ؛ policy names implementationcontract مشتركة قبل قصصها، orders.refund ثابت من PRD. Owner لا يتجاوز financialinvariants ؛ Manager لا rolegrant/secretadmin/refund بلا grant ؛ Warehouse لا cost/refund/pricing/financialreports ؛ Support لا inventory/pricing/refund/roles ؛ Marketing فقط coupons/content/explicitreports ؛ Customer ownonly ؛ Guest catalog/cart و readproofsingleorder.

Opaque session server-side separatecustomer/admin ، hashsecrets/cookiesSecureHttpOnly ، currentstatus/grantsnextrequest ، CSRF+Origin ، parameterizedSQL/outputencoding/CSP/bodylimits ، shared atomic ratelimiter ، TLS/leastprivilege/secretsperenv. password/MFA/recovery/timevalues تظل A09/OQ06 ؛ library مدققة لا cryptohandrolled. لا rawcards/proofs/passwords/PII غير لازم في logs/clientcache/analytics.

## loading/empty/failure/success

| الحالة | السلوك الملزم | المصدر |
|---|---|---|
| Loading | مؤشر مناسب ومنع التقديم المكرر؛ لا نجاح مالي أو مخزني قبل تأكيد الخادم | UX shared F؛ NFR-08/09؛ FR-24 |
| Empty | رسالة خلو حقيقية مع سياق البحث والفلاتر أو السلة أو القائمة؛ لا منتجات أو إيرادات وهمية | FR-09/10/17/41؛ UX screens |
| Field failure | رسالة عند الحقل وملخص قابل للوصول عند الحاجة، وتركيز مناسب، وحفظ البيانات غير الحساسة | FR-01/21/58؛ UX forms |
| Price/stock drift | عرض الفروق وطلب مراجعة جديدة قبل التقديم؛ لا قبول صامت للإجمالي القديم | FR-19؛ AC-05 |
| Unknown payment/refund | Pending مع قراءة آمنة للحالة؛ timeout ليس فشلًا نهائيًا ولا يسمح charge جديدًا | FR-24/27/37؛ AC-07/15 |
| Stale 409 | رفض الكتابة فوق تحديث أحدث؛ عرض مسار إعادة القراءة دون حقول غير مخولة | FR-34/58؛ AC-23 |
| Session expiry/denied | إزالة العرض المحمي عند التحقق، ثم إعادة الدخول والتحقق من البيانات؛ لا كشف وجود مورد خاص | FR-02/07/29؛ UX-07 |
| File/mail/provider failure | الملف المرفوض لا ينشر؛ فشل البريد مرئي ولا يلغي Order؛ تعطل المزود لا يخفي الطلب | FR-43/56/59 |
| Confirmed success | نتيجة ملتزمة من الخادم مع الحالات الثلاث؛ Delivered COD لا يعني Paid، ولا يتكرر purchase | FR-26/29/46؛ AC-16/24 |

الحوار له اسم قابل للوصول وتركيز أولي آمن؛ يمنع انتقال التركيز للخلفية ويعيده عند الإغلاق. Escape قبل الالتزام لا تعني إلغاء طلب مالي بدأ بالفعل. كل إجراءات P0 متاحة على الهاتف ولوحة المفاتيح دون hover؛ RTL مشروط باللغة المعتمدة. قيود التكبير وإعادة التدفق والجداول وبدائل بيانات الرسم من UX؛ التباين ينتظر الهوية المرئية ولا يُدعى اجتيازه الآن.
