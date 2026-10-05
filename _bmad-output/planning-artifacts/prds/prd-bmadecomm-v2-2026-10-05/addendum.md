# ملحق المعمارية والمصدر — PRD v2

## مرجع المصدر والمحافظة على النطاق

الأصل Ecommerce_PRD.docx، الأقسام 4–100 المتاحة فقط. المقدمة الجديدة مبنية على نطاق B2C ودورة الشراء والإدارة، وليست نصًا مستعادًا من أقسام 1–3. النسخة الجديدة تنظم المصدر في 60 FR؛ لا تنفذ كودًا ولا تختار إطار عمل.

تجميعات الملاحم الأصلية الـ22 محفوظة في الجدول التالي. عناوين الملاحم السابقة الـ28 تصنف كميزات تحت هذه التجميعات، لا مجموعتين مستقلتين للـbacklog.

| المعرف | الاسم |
|---|---|
| EPIC-01 | Authentication |
| EPIC-02 | Product Catalog |
| EPIC-03 | Search & Filters |
| EPIC-04 | Product Details |
| EPIC-05 | Cart |
| EPIC-06 | Checkout |
| EPIC-07 | Customer Account |
| EPIC-08 | Orders |
| EPIC-09 | Admin Dashboard |
| EPIC-10 | Product Management |
| EPIC-11 | Inventory |
| EPIC-12 | Customers |
| EPIC-13 | Discounts |
| EPIC-14 | Shipping |
| EPIC-15 | Payments |
| EPIC-16 | Reviews |
| EPIC-17 | Returns & Refunds |
| EPIC-18 | Reports |
| EPIC-19 | Notifications |
| EPIC-20 | Roles & Permissions |
| EPIC-21 | Settings |
| EPIC-22 | Analytics |

## مخرجات المعمارية المطلوبة

- ERD: AdminUser/Role/Permission/membership، Customer/Address، Product/Variant/Attribute/Image/Category وProductCategory، Inventory/InventoryTransaction/Reservation، Cart/CartItem، Order/OrderItem/StatusHistory/contact-address snapshots، PaymentAttempt/Payment/provider event/idempotency، Refund/refund allocation، ShippingMethod/Zone/Shipment، Coupon/eligibility/Usage/reservation، Notification/AuditLog/Settings/HomepageContent/InternalNote.
- Wishlist/WishlistItem، Brand، Review، ReturnRequest/ReturnItem، additional notification channels تدخل عندما تعتمد P1. الواجهة المستقبلية لا تستلزم إنشاء كل جداولها في أول migration.
- Constraints: uniqueness والنطاق، foreign keys، immutable history، money precision، deleted-resource behavior، transaction boundaries وحماية التزامن. محرك قاعدة البيانات يختار بعد requirements وليس مفروضًا هنا.
- العقود: schemas والتحقق والصلاحيات وpaging/errors/versioning/idempotency وشروط stale writes؛ checkout/payment/stock/coupon/refund contracts قبل stories التابعة. api route examples في المصدر ليست API جاهزة.
- الفصل: customer/admin identity boundaries، server RBAC/ownership، guest proof، secrets في الخادم، media policy، CSRF/CORS/CSP حسب المعمارية.
- تدفق مالي: Order pending وسجل محلي قبل الدفع؛ معالجة partial failure بتسوية وتعويض وليس افتراض transaction موزعة واحدة مع المزود. Paid متأخر لا يُمحى بسبب انتهاء Order.
- التنفيذ الدوري/الخلفي للحجز والتسوية والرسائل والتنبيهات يحتاج استمرارية وإعادة تشغيل آمنة. queue/cache/search service مستقلة خيارات تصميم، لا شروط شراء تقنية مسبقة.
- فشل email لا يعكس Order، وفشل shipping provider يمنع الخدمة المعنية دون تعطيل الكتالوج، وفشل gateway يظهر Pending/recoverable outcome.
- اختيار deployment/runtime/database/storage/monitoring، migrations والنسخ/الاستعادة/rollback يتبع NFRs المقبولة. لا يبدأ scaffold ضمن مهمة تحرير PRD.
- يحافظ تصميم الأداء على ضغط الصور وResponsive Images وLazy Load عند الحاجة، cache للمحتوى المناسب وتقليل JavaScript، كما في الأصل؛ تتحقق الحدود العددية ولا تكفي قائمة الأساليب وحدها.

## تفاصيل التكاملات التي تحتاج تحقيقًا

Payment: eligibility والموافقات والعملة والطرق، sandbox، إنشاء intent/مرجع، webhook verification، event dedupe/order، void/capture/refund/timeouts/reconciliation. أمثلة Paymob/Stripe/PayPal لا تعد اختيارًا.

Shipping: مناطق وتسعير يدوي في المقترح؛ إن اختير API فتوثق quotes/booking/labels/tracking/failures/COD settlement وتحدد مسؤولية تحديث الحالة.

Email: domain verification وprovider access وقوالب verification/reset/transactional، delivery status وretry/dedupe. SMS/WhatsApp معتمدان لاحقًا حسب scope.

Storage: صور المنتج/الإرجاع، حدود محتوى وحجم، access controls وlifecycle ودعم transforms؛ CDN عند الحاجة لتحقيق الأداء.

Analytics: GA/Meta أمثلة؛ لا تعمل production دون تحديد consent والحقول وauthority/deduplication. بيانات purchase ليست بديلًا لدفتر المقبوضات.

## مراجع تحقق عامة

هذه مراجع للمعمارية، لا مزودون مختارون ولا تعليمات تنفيذ:

- [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): deny by default والتحقق من الوصول في كل طلب.
- [Stripe webhooks](https://docs.stripe.com/webhooks): مثال عملي للتحقق من callback ومعالجة التكرار وعدم افتراض ترتيب الأحداث؛ ينطبق عقد المزود الذي يُختار فعليًا.
- [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html): ممارسات passwords والمصادقة وإعادة الإثبات؛ أوقات الجلسات والروابط مقترحات خاصة بهذا المنتج، وليست قيمًا منسوبة للمرجع.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): تعريف معيار الوصول المقترح؛ لم يُنفذ تدقيق امتثال لتطبيق حالي.
- [Web Vitals](https://web.dev/articles/vitals): مقاييس LCP/INP/CLS؛ حدود الحمل وAPI الأخرى مقترحات لهذا المشروع.
