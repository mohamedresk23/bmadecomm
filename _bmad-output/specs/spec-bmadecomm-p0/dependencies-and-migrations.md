# الاعتماديات والقرارات والترحيل

## سياق المشروع

المستودع يحتوي إعدادات BMAD ووثائق تخطيط فقط؛لا app code/package manifest/migrations/production deployment/AGENTS conventions مرصودة. لا base schema أو public API سابق ننقله. المعتمد Next.js/TypeScript/PostgreSQL modularmonolith و src/app/modules/infrastructure/shared/database/tests ،مع worker مننفس revision ؛الهيكل seed لايدعو لإنشاءمجلداتبهذه الجولة.

## اعتماديات القدرات

F-00 تمكين وليست capability بيع مستقلة؛ foundationlibraries/schema contracts/worker/audit/proof/DTO/secrets يحتاجهاالأول. جميع rowsCAP تساوي EpicID ،ولا forwarddependencies صلبة. مراجعقدراتلاحقة في boundaries تعني integration امتدادًا،لااعتبارمتطلبكاملًا قبلها.

| CAP | المتطلبات السابقة الصلبة | حدود الاكتمال |
|---|---|---|
| 1 | F00 | identityemail تعملمنالبداية،لاانتظار 17 |
| 2 | 1 | grant/actionfieldpolicies قبل admin write |
| 3 | 2 | market/policy/methodsettings مع OQ |
| 4 | 2/3 | stockowned5 ، CRUDcatalog ليس inventoryoverride |
| 5 | 2/3/4 | commands/ledger هنا، Orderintegration10/11/13 |
| 6 | 3/4/5 | add/BuyNow اكتماله 9/10 ؛ netdeliveredrankcontract موحد يغذيه 13 لاحقًا |
| 7 | 2/4/6 | draft publish فقط |
| 8 | 1/2/3/4 | policytax/rounding/couponexceptiongate |
| 9 | 1/5/6/8 | cart not reservation |
| 10 | 1/3/5/8/9 | CODPendingprotectedresult ، charge11/collection13/fulltracking15 |
| 11 | 3/5/8/10 | refundtaskdurable حتى execution14 ؛ no completeP0launchwithoutrefund |
| 12 | 2/5/10/11 | cancelrequestbackend هنا، accountUI15 ، ship13 ، refund14 |
| 13 | 2/5/10/11/12 | fullshipment/independentcollection/inspection |
| 14 | 2/8/11/12/13 | refund budget متزامن وال networkoutsideTX |
| 15 | 1/10/11/12/13/14 | selfservice+guest readonly ، noreturnportal |
| 16 | 2/12/13/14/15 | supportscope/spendingread ، noCRM |
| 17 | 1/5/10/11/12/13/14 | eventproducersoutbox منملاحمهم،ليس forwardblocker لصحةالمعاملات |
| 18 | 2/5/11/14/17 | unifiedoperatorsurfaces توسع reconciliation الموجود |
| 19 | 2/5/10/11/13/14 | §10financialreadonly ، no advanced reports |
| 20 | 6/9/10/11/12 | consent/businesssourcepurchase ، noP1wishlist |

لا مدة sprint أو capacity معروفة؛ sequence يمكنالتوازيبـ contracts عندحلأسبابه،وليس releaseCOD-only. كل CAP يسلمشرائحبقصصمستقلةلاحقًا.

## بوابات القرار

| Gate | القرار والمالك | ما يمنعه حتى الحسم |
|---|---|---|
| OQ01 | Owner: market/currency/scale/language/warehouse/products | finaladdress/moneyschema/RTL/storepolicies CAP3–11/15 |
| OQ02 | Owner+tech: payment/email/storage/carrierprovider/sandbox | finalintegrationcontracts CAP1/3/4/11/14/17/20 |
| OQ03 | Owner+accountant: taxinclusion/rates/classes/shipping/invoice/rounding/coupon | finalpricing/checkout/refund/docs CAP8/10/11/12/14 |
| OQ04 | Owner+ops: COD/holdTTL/cancel/returns/latecouponsettlement | finalguards/policies CAP5/8/10–15/18 |
| OQ05 | Owner+privacy: retention/deletion/residency/consent | productionPII/logs/media/analytics ؛ CAP1/3/4/15–20 |
| OQ06 | Owner+tech+QA: passwords/MFA/session/proof/rate/targetSLO/budget/hosting | crosscuttingauth/security/load/deployment/readiness |
| OQ07 | Owner: baseline/window/business goals | commercialsuccessclaim/analyticscohort；metricdefinitions المثبتةلايعاداختراعها |
| OQ08 | Owner+ops: finalroleactionmap/alertresponsible/runbooks/supportproof/staff | authorizedadmin/customerrecovery/transitions/alerts |
| TC01 | Tech+QA: compatibleframework/React/TS/Node/driver-or-ORM/auth/validation/tests pins | bootstrap/code قصص foundation ؛لااختيار library مختلفةلكل module |
| TC02 | Tech+UX+QA: DTOfields/textcaps/paging/searchnormalization/canonicalhash/staffproof/retryactions | field/API dependentstories ؛المسودةتحدد shape وبواباتلا تدّعي fullwireapproval |
| VC01 | Owner+UX: visualidentity المؤجلة | finalcontrast/brandtokens ؛لا يمنعتعريف behavior |

late coupon policy ليستقرارًا تقنيًا يحسمبرد invoicezero:receipt دائم، cap/snapshot محفوظان،لا silentship حتى settlement مخولة؛ refund business policy لاتخترعه spec.

## Database changes وترتيب migrations المخطط

1. **foundation+identity:**versionedmigrationtool/transactioncontext/sharedprimitives ، users/sessions/proofs/grants/Ownerguard ، outbox/jobattempts/notificationdeliveries/audit. تفعّل privilege أقلامتياز؛نقاط permissions/rowlockschecked قبل admins.
2. **catalog/policies:**settingspolicyversions ، products/variants/categories/media/redirects ، balances/ledger/allocationsports ، homepage ، basiccoupons. شجرة categories/uniquecombos/case-normalizedSKUslugcoupon تمنع collision ؛نطاق unique يُثبتبالعقد،لا dualnormalization في UI/DB.
3. **cart/orders:**carts/items/operations ، orders/items/totals/addresses/history/holds+couponties/paymentattemptpending. snapshot مستقل/FKrestricttoreferencedfinancialrows ، noarchivedcascadefinancialdelete.
4. **payment/fulfillment/refund:**providerinbox/receipts/reconciliation ، shipment/returninspection/CODcollection ، refundbudget/allocations. migration و applicationowners تحافظ locks/typescompatible ؛الأثر recorded مرة.
5. **service/observability/readviews:**customeraddresses/notes/verifiedclaimlinking ، orderdeliverytemplates/recoveryquery/reportingindexes/purchaseeventdedupe. الجداولتنشأحينأول capability يحتاجها،فهذه groups ليست DDLtimeline يمنعشريحةسابقة.

لا SQL ملفات migration فعلية،ولا P1 جداول wishlist/reviews/brands/returnrequests/advancedrules/channelstuff/exports. tables داخل companionseed ؛ schemafieldnullability/FKscope/checks ولغة ORMDDL تثبتفي TC01/02 قبلقصتها. Cross-rowrefund/lastOwner/coupon/stockinvariants ليست rowCHECK وحده؛ transaction locks+uniqueeffects مطلوبة.

## التوافق والاستعادة

- greenfield:لا data migration من app قديم أو APIclientexisting ؛ docs/api/v1 namespace مقترحلا publishnow.
- بعد deployment أول:expand-compatiblecolumns ثم newreaders/writers ثم backfill ثم contractlater. expected_version و DTO version والتوقيت/نوع Money لايتغيرانبصمت. no destructive financialbackfill.
- rollingweb/worker تستخدم compatible event payload version ؛ worker يرفض unknown schema إلى failure/recovery مرئية بدل misparsemoney. in-flightproviderkeys/attemptrefs محفوظةعبر revision ،لا regeneratekeys على deploy.
- rollbackapplication لا يمحو charge/refund/receipt ؛ durablereconciliation بعد rollback. هجرة destructive تحتاج backup/restoreplan و approval سياسة،لا تنفذبهذه الجولة.
- storecurrencychange بعد first order خارج MVP ؛ historical snapshot يحتفظ currency/scale/policyversion. policy update لا rewritependingattemptamount ، method disable يحترم reconciliationexisting.
- sessions/proofs passwordreset/revocation ومفاتيح idempotency تحت retention approved ؛ cleanup لاينسف uniquehistoricalproviderrefs أو financialrecords. تطبيقالخصوصيةلا eraseledger بلاسياسة.
- backups تشمل DB/media وحمايةالمفاتيحلاستعادةالوصول؛ restore/rollbackdrills و RPO/RTO evidence وقت QA بعد اعتماد NFR. لاادعاء backwardcompatibledeployment حالي.

## جاهزية التسليم

المواصفةنصية draft مكتملةالنطاق المطلوب،والقصصالتنفيذيةالمتأثرة blocked حتى gates. المعايير SA/BT متاحةلتفصيل stories ؛لا capacity/sprint-status/generatedcode. المراجعةاللاحقةتعالجالقراراتوالعقودثم bmad-create-epics-and-stories/readiness ،ولايبدأ build منهذاالطلب.
