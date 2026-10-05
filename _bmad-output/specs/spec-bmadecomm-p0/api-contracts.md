# عقود API والتحقق والأخطاء

هذه مسودة عقد تقني مشتركة لـ P0 ، وليست routes منفذة أو موافقة على مزود. الأسماء أدناه اقتراح specification ؛ تثبت مرة واحدة قبل توزيع قصص الواجهة والخادم. ما يعتمد OQ لا يصبح صالحًا للإطلاق بمجرد وجود endpoint. المرجع FR-58 و AD-2/5/9/10 ؛ CAP يتطابق مع Epic بالرقم.

## شكل البيانات المشترك

| النوع | العقد |
|---|---|
| ID | UUID داخلي ينقل opaque string ؛ order_number unique للعرض وليس دليل ملكية |
| Money | amount_minor نص integer غير سالب، currency نص العملة المعتمدة، scale integer من السياسة؛ لا JSON float أو currency من العميل كسلطة |
| Time | timestamp ISO8601 UTC ؛ date filters تتحول ب store timezone المعتمدة إلى حدود UTC ؛ تاريخ محلي لا يستبدل instant |
| Address | country ، governorate ، city_or_zone ، line ، building ، phone ، postal_code عند اشتراط الخدمة؛ exact catalog/phone/lengths تحت foundation/OQ01 |
| Totals | subtotal ، discount ، shipping ، tax ، total مع currency/scale و line allocations ؛ server-generated فقط |
| Order view | id/order_number ، created_at ، version ، OrderStatus ، FulfillmentStatus ، Payment attempt summaries ، item/address/totals snapshots و tracking ؛ DTO بحسب الدور،لا cost/internalnotes للعميل |
| Page | items ، page ، page_size ، total_count ؛ sort allowlist مع secondaryID ؛ page bounds/caps contract gate ،لا SQL column string مفتوح |
| Mutation | resource expected_version حيث مشترك mutable ؛ business operation لها Idempotency-Key ؛ actor/session منالخادم وليس body |
| Error | code ، message ، details ، request_id ؛ details مصفوفة field/path + safe reason أو changes DTO مخولة؛لا stacktrace أو providersecret |

أسماء code الآتية technical enums مقترحة ثابتة لكل المستهلكين: VALIDATION_ERROR ، AUTH_REQUIRED ، FORBIDDEN ، NOT_FOUND ، STALE_VERSION ، IDEMPOTENCY_CONFLICT ، PRICE_REVIEW_REQUIRED ، STOCK_UNAVAILABLE ، INVALID_TRANSITION ، COUPON_INELIGIBLE ، REFUND_LIMIT_EXCEEDED ، INVALID_PROOF ، RATE_LIMITED ، DEPENDENCY_UNAVAILABLE ، INTERNAL_ERROR. الرسالة مترجمة،ولا تستخدم provider string ك code محلي.

## HTTP والـ idempotency

- 200 قراءة/نتيجة إجراء موجودة، 201 إنشاء مورد محلي؛ 202 مورد durable ما زال Pending أوتسليم مهمة،لا إعلان Paid. 204 logout/حذف غير مستخدم ناجح بلا payload.
- 400 shape غير صحيح؛ 401 session غائبة/منتهية؛ 403 action ممنوع؛ 404 resource مفقود أو مخفي ملكيةً؛ 409 stale/keyhash/state/price review conflicts ؛ 422 field/business eligibility ؛ 429 limiter ؛ 503 dependency incident قابل للاسترداد؛ 500 internal منقح.
- مفاتيح submit/payment/refund/inventory/COD actions: unique(operation,actor-or-guest identity,key) و canonical request hash. duplicates مخولة تستعيد reference/result نفسها حتى أثناء التنفيذ؛أثر local/business واحد. altered hash409. auth/ownership قبل replay.
- command HTTPtimeout لايحذف order ولاينشئ attempt جديد. status polling يعيد live localstate ويتيح trusted query/job وفق الصلاحية،لا استعلام متعددالمزودين من browser.
- retention canonicalization/version rules ومهلة keys وال payload byte caps تحت foundation contract ؛ providerkey ثابت local attempt ID. webhook events لها provider+account+event unique مستقلةعن clientkeys.
- cookie mutations محمية CSRF/Origin. webhook خارج sessioncookie يتحقق provider signature/rawbody/replay policy. publicGET لا mutation أو proof consumption ،لتجنب استهلاك verification/reset من prefetch/mail scanners ؛ linklanding يتبع UX ثم command محميملائم.

## الهوية والحساب والتتبع — CAP1/2/15/16

كل route يبدأ /api/v1. tokens لا تخرج في DTO عامة أو logs ؛ session تضبط cookie فقط.

| Method/path | Input | Result/permissions | SRS |
|---|---|---|---|
| POST /auth/register | name,email,phone,password ؛ operationkey لدعم retry | account reference +verification state ،لا auto claimOrders ؛ required/unique validation | FR01/03/43 |
| POST /auth/login | email,password | genericfailure أو customer session ؛ admin scope ليس مشتقًا من customerlogin | FR02 |
| POST /admin/auth/login | email,password ؛ MFA challenge بحسبالسياسة | authorized staff session فقط؛ enrollment/recovery schema OQ06/08 | FR02/06 |
| POST /auth/logout | sessioncookie | revoke current ، 204 | FR02 |
| POST /auth/email-verification/requests | identity حسب session/resend contract | response عام، outbox عندالأهلية، rate limited | FR03/43 |
| POST /auth/email-verification/confirmations | scoped verification proof | consume مرة، verified أو invalid/expired generic | FR03 |
| POST /auth/password-reset/requests | email |200 نفسه known/unknown ، mail إذا validrecipient | FR04/43 |
| POST /auth/password-reset/confirmations | reset proof,new_password | consume+passwordhash update+sessionrevocation atomically ؛ invalid/used/expired رفض | FR04 |
| GET/PATCH /account/profile | patch name/email/phone +expected_version | ownDTO ؛ emailchange pendingverification لا historicalOrderrewrite | FR05 |
| GET/POST /account/addresses | address عند create | own pagedlist/create ؛ noOrdermutation | FR05/22 |
| PATCH/DELETE /account/addresses/{id} | address+expected_version | owned address ، deletecurrentaddress لا snapshotdelete | FR05/55 |
| GET /account/orders ،/account/orders/{id} | paging/id | ownreadonly OrderDTO ، no internal fields | FR05/29 |
| POST /account/orders/{id}/cancellation-requests | expected_version ، optional reason من policycontract | requestreference ،لا Cancelled حتى adminexecute ؛قبل Processing وفق A06 | FR35 |
| POST /guest/order-proof-requests | proposed order_number+email | generic200 ، send فقط إلى snapshot email إذا eligible ؛ targetrate limit | FR29 ؛ A10 |
| POST /guest/order-proof-exchanges | scoped one-order proof | readonlycookie scopeOrder ، remove secretURL حسب UX | FR29 ؛ A10 |
| GET /guest/order | readonly proofsession | oneOrderDTO فقط، invalidsame nonrevealing result | FR29 |
| POST /account/order-claims | verifiedaccount +orderproof | link owner مرة بعد bothproofs ؛لا auto emailmatching | FR03/55 ؛ A10 |
| GET/POST/PATCH /admin/staff[/{id}] | staffpayloadapproved/expected_version ، role/status actions | Owner فقط؛ payloadprovisioning gate ، lastOwner serialized | FR06/07 |
| GET /admin/customers[/{id}] | paging/approvedfilters | scopedcustomerDTO/spending/orderlinks | FR40 |
| POST /admin/customers/{id}/notes | note +operationkey | authorized note+audit | FR40/45 |
| POST /admin/customers/{id}/disable | expected_version | authorizeddisable/revoke دون financialdelete | FR40/06 |

staff creation/provisioning ، MFA/password recovery ، claim evidence flow ، resendprooflimit/expiry تظل gates ؛لا invitations/resetcredential email ميزةمضافة. Supportguestcancellation يحتاج evidence independentlyverified procedure من OQ08 ؛ readonlyproof لايكفي.

## الكتالوج والمحتوى والإعدادات — CAP3/4/6/7

| Method/path | Input | Result/guards | SRS |
|---|---|---|---|
| GET /products ،/products/{slug} | q ، category/subcategory ، price range ، availability ، attributes ، sort ، page/page_size | published productDTO و count ؛ search name/SKU/category/tags ؛ sortnewest/actualprice/30dnetdelivered/editorial+ID | FR09–12 |
| GET /categories | publishedtree | noarchived/draftprivate leak | FR09/15 |
| GET /home | لا input مالي | enabledpublished sections فقط | FR08 |
| GET /admin/products[/{id}] | approvedpaging/filters | rolefiltered cost/fields ؛ no arbitrarysearch invented | FR14 |
| POST/PATCH /admin/products[/{id}] | name/slug/descriptions/tags/categories/prices/cost/SEO حسب permissions ، expected_version | draft/update with validation ؛ cost privileged | FR13/14/16 |
| POST /admin/products/{id}/variants | uniqueattributecombo/SKU/prices/status/optionalimage | variantreference ؛ stock initial/change عبر inventoryport مع ledger لا freewriteReserved | FR13/30 |
| POST /admin/products/{id}/{publish,duplicate,archive} | expected_version ، key إن operationcreates | duplicate newdraft/newSKUcontract ، publishedguards ، archivehistoricalpreserved | FR14/55/56 |
| DELETE /admin/products/{id} | expected_version | onlyunusedrecord ؛ references reject | FR56 |
| POST/PATCH/DELETE /admin/categories[/{id}] | tree/image/status/order +expected_version | nocycle ؛ reassignmentbeforereferencedarchive | FR15/56 |
| POST /admin/media/uploads | authorized contentupload intent/actualfile | quarantinedkey ، validateddecode/type/size ؛ publishonlyapproved | FR15/56 |
| GET/PUT /admin/homepage/draft | approvedsectionpayload+expected_version | draftreferenceversion ؛ fieldcatalogpendingcontract | FR08 |
| GET /admin/homepage/preview | draftversion authorized | private no-store preview | FR08 |
| POST /admin/homepage/publications | expected_version | newpublication+invalidation aftercommit | FR08/11 |
| GET/PATCH /admin/settings | store/localization/method/policy schema+expected_version | Owner/explicitgrant ، no secretsDTO ؛ rejectretroactivecurrencychange | FR42 |

SEO metadata/robots/sitemap/redirect rendering routes ليست CRUD جديدة. querynormalization العربي، casefoldingSKU/categorycontracts ، imagecountlimits ومحتوى homepage/settings schemas تثبت مع FR58/OQ ؛لاملءحقولغير محددةبالمنتج.

## سلة وتسعير و Checkout — CAP8/9/10

| Method/path | Input | Result/guards | SRS |
|---|---|---|---|
| GET /cart | guest/customer cookie | owncart+servertotals+availability/blockeditems | FR17/18 |
| POST/PATCH/DELETE /cart/items[/{id}] | variant_id/quantity ، expected_version عند edit | updatedcart ؛ integerpositive/noinactivevariant/noreserve | FR17 |
| POST /cart/merges | trustedguestcart identity+customer session/key | mergedcart+changes ، retry once | FR18 |
| GET/POST/PATCH /admin/coupons[/{id}] | code/type/timing/status/caps/minimum/ceiling/eligibility+version | authorizedbasicrule ؛ uniquecode ، noBuyXGetY | FR20 |
| POST /checkout/quotes | cartref/version ، shipping/billingaddress ، methodrefs ، coupon إنوجوده | quote_id/revision ، policy_version ، totals/lineallocations ، changes ، expiry عنداعتمادها؛ noreserve | FR19/21/22 |
| POST /checkout/orders | quote_id/revision reviewed ، guestname/email/phone أو accountsession ، addresses/methods ، Idempotency-Key |201 committedOrder/attempt/resultview +safe next_action ؛ serverrevalidation ؛ no rawcards | FR21–24/26/29 |
| GET /orders/{id}/status | owner/proof/adminscope | live three-state summary+safeattemptinfo ؛ numberalone notauth | FR24/27/29 |

quote_id ليس ضمان stock ولاحققبول total قديم. تغير policy/price/method/address eligibility يعيد reviewconflict مع changes مخولة؛ client يراجع ثم keysubmission ب payload جديد لا يعيد key altered القديم. params/types bounded في schema المشتركة؛ exactfieldcaps/gatewaynext_actionpayload gate.

## مخزون ودفع وطلب وشحن واسترداد — CAP5/11/12/13/14

| Method/path | Input | Result/guards | SRS |
|---|---|---|---|
| GET /admin/inventory[/{variant_id}/ledger] | approvedpaging/scope | balances+movementDTO ، permissionsnofinancialextras | FR30 |
| POST /admin/inventory/adjustments | variant_id ، signedintegerdelta ، reason ، expected_version ، key | ledgerreference/newbalance ؛ nooversell/Reservedoverride | FR30/32 |
| POST /integrations/payments/{provider}/events | rawbody/signatureheaders | ackafterdurableinbox ؛ dedupe/replay/orderamountcurrencyaccountvalidated | FR27/59 |
| GET /admin/orders[/{id}] | date/order/pay/customer/methodshippingfilters+paging | authorizedsnapshots/history/internalnotes | FR33 |
| POST /admin/orders/{id}/transitions | expected_version ، namedtransition ، evidence/actiondata حسب guard | version+three-stateview ؛ Order/fillstatusnotfreePATCH | FR34 |
| POST /admin/orders/{id}/cancellations | expected_version ، approvedreason ، key | cancelled/releasedhistory+refundtaskifPaid ؛ beforeShippedonly | FR35 |
| GET /admin/orders/{id}/document | authorizedresource | printableorderdocument ، notlegaltaxinvoiceclaim | FR39 |
| POST /admin/orders/{id}/shipments | carrier/trackingref/sent_at ، version/key | fullshipment+atomicstockconsume ؛ Paidonline/CODeligibleConfirmed | FR31/36 |
| POST /admin/orders/{id}/delivery-updates | transition/evidence-or-failurereason ، version/key | milestone/history ، DeliverednotCODPaid | FR34/36 |
| POST /admin/orders/{id}/cod-collections | amount_minor ، collected_at ، reference ، version/key | trustedlocalreceipt/discrepancy ، no duplicatecollection | FR26 |
| POST /admin/orders/{id}/return-inspections | itemqty/received_at/disposition/reason ، version/key | movementifinspectedresellable ، damagedexcluded ، no refundautomatic | FR38 |
| POST /admin/orders/{id}/refunds | amount_minor ، item/shipping/taxallocations ، reason ، version/key | refundreference/Pendingbudget قبل network ؛ orders.refundgrant | FR37 |
| GET /admin/refunds/{id} | scopedrefundid | realstate/attempts/safequeryresult | FR37/60 |
| POST /admin/refunds/{id}/cod-payout-confirmations | externalconfirmedpayoutref/date/amount ، version/key | successfulrefundonlyafterevidence ، norawbankcardfields | FR37 |

create/querypayment/providerrefund/expiry عمليات server application/worker ،لا browserforcepaidroute. providerspecificheaders/create/query/refund/status enums و timeout/definitivefailure mapping قبل integrationstories تحت OQ02. retryonlineattempt لا يسمح إن olderunknown ؛عقد newattempt بعد definitivefailure تحتاج policy/TTL تحقق wholeallocation قبل story.

## بريد وتشغيل وتدقيق وتقارير وتحليلات — CAP17/18/19/20

| Method/path | Input | Result/guards | SRS |
|---|---|---|---|
| GET /admin/notifications ،/admin/message-deliveries | approvedpaging/statusscope | rolefilteredalerts/failures ؛ noP1global auditsearch | FR43/44 |
| GET /admin/recovery-tasks[/{id}] | authorizedtaskscope | unknownpay/refund/expiry/mail states/references | FR60 |
| POST /admin/recovery-tasks/{id}/actions | allowlistedaction ، expected_version ، key | durablejob/query/actionaudit ؛ no arbitrarypayloadorDBquery | FR60 |
| GET /admin/resources/{kind}/{id}/audit | existingauthorizedresource | redactedperresourceimmutablehistory ؛ globalexportnotP0 | FR45 |
| GET /admin/dashboard | date range/timezoneapproved | definitions §10 KPIs/chart/recent/top/lowstock ، as_of/permissionfields | FR41 |
| Analytics event adapter | source event_id/name/allowedproduct/variant/order refs and timestamp | consent-gated browser events ؛ purchaseuniqueorderbusinesssource ، noPII | FR46 |

events required: page_view/product_view/search/add_to_cart/remove_from_cart/begin_checkout/add_payment_info/purchase. wishlist_add خارج P0. analyticsprovider/bootstrapconsentunderOQ02/05 ؛هذه ليست generalpublic arbitraryevent POSTcollector specification.

## تثبيت العقود قبل القصص

العمليات المكملة للعائلات أعلاه:

| Method/path | Input | Result/guards | SRS |
|---|---|---|---|
| PATCH /admin/products/{product_id}/variants/{id} | editable variant fields + expected_version | تحقق العلاقة والـSKU/combo والأسعار والحالة؛ المخزون حركة من inventory ولا Reserved writable | FR-13/30 |
| POST /admin/categories/{id}/archives | expected_version ومرجع إعادة التعيين عند الحاجة | منع أرشفة تصنيف مشار إليه قبل إعادة تعيين المنتجات، وحفظ التاريخ | FR-15/56 |
| POST /admin/orders/{id}/notes | note + expected_version أوoperation key المعتمد | ملاحظة داخلية مخولة مع أثر؛ لا تظهر في customer/guest DTO | FR-33/45 |
| POST /admin/staff/{id}/role-assignments | approved roles/actions + expected_version | Owner فقط، current grants وactive Owner guard تحت المعاملة | FR-06/07 |

هذه الأفعال ليست CRUD حرة تتجاوز حدود المجال. يثبت عقد الإجراءات المالية الحساسة إعادة الإثبات وفق A-09/OQ-06؛ لا يفترض أن امتلاك staff session يكفي وحده بعد انقضاء مهلة reauthentication المعتمدة.

قصة foundation تثبت serialization/canonicalhash/errorcodes/pagecaps/schema libs/transactioncontext. كل domain يثبت fieldsrequired/limits/roleaction map/stateguard/providerdetails اللازمةلقصته. automatedcontractfixtures تربط UI/server و DBconstraints ؛لايختار endpointDTO مختلفةفيقصةالواجهة. الشروطالمفتوحةمذكورةفي dependencies ؛لا codegen أو OpenAPIcompiled artifacts بهذه الجولة.
