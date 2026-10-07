# API Contracts — Epic 03: Store Operational Settings

All administrative routes require an active staff session with the `owner` role, validate the CSRF token on mutating requests, and return standard JSON responses under `/api/v1/`.

---

## 1. Administrative Settings Endpoints

### 1.1 Store Profile & Identity (E03-01)

#### `GET /api/v1/admin/settings/profile`
Retrieves full store profile settings and the currency lock status.

- **Headers:** `Cookie: session=<staff_token>`
- **Response (200 OK):**
```json
{
  "profile": {
    "store_name": "متجر بيميد",
    "legal_name": "شركة التجارة الإلكترونية المصرية ش.ذ.م.م",
    "support_email": "support@bmadecomm.eg",
    "support_phone": "+201012345678",
    "address": "15 شارع مصدق، الدقي، الجيزة، مصر",
    "logo_media_id": "0192a83f-91a1-7000-8800-000000000001",
    "logo_url": "/api/v1/media/0192a83f-91a1-7000-8800-000000000001/public",
    "default_language": "ar-EG",
    "currency": "EGP",
    "currency_symbol": "ج.م",
    "currency_exponent": 2,
    "timezone": "Africa/Cairo",
    "date_format": "YYYY-MM-DD",
    "order_prefix": "ORD-",
    "updated_at": "2026-10-07T11:00:00Z",
    "updated_by": "user_owner_01"
  },
  "currency_locked": true,
  "currency_locked_reason": "Orders exist in the store database. Operating currency cannot be modified."
}
```

---

#### `PUT /api/v1/admin/settings/profile`
Updates store profile settings. If `currency` is altered while `currency_locked` is true, the request fails with 409 Conflict.

- **Headers:** 
  - `Cookie: session=<staff_token>`
  - `X-CSRF-Token: <csrf_token>`
  - `Content-Type: application/json`
- **Request Body:**
```json
{
  "store_name": "متجر بيميد الرسمي",
  "legal_name": "شركة التجارة الإلكترونية المصرية ش.ذ.م.م",
  "support_email": "support@bmadecomm.eg",
  "support_phone": "+201012345678",
  "address": "15 شارع مصدق، الدقي، الجيزة، مصر",
  "logo_media_id": "0192a83f-91a1-7000-8800-000000000002",
  "default_language": "ar-EG",
  "currency": "EGP",
  "timezone": "Africa/Cairo",
  "date_format": "YYYY-MM-DD",
  "order_prefix": "ORD-"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "profile": {
    "store_name": "متجر بيميد الرسمي",
    "legal_name": "شركة التجارة الإلكترونية المصرية ش.ذ.م.م",
    "support_email": "support@bmadecomm.eg",
    "support_phone": "+201012345678",
    "address": "15 شارع مصدق، الدقي، الجيزة، مصر",
    "logo_media_id": "0192a83f-91a1-7000-8800-000000000002",
    "logo_url": "/api/v1/media/0192a83f-91a1-7000-8800-000000000002/public",
    "default_language": "ar-EG",
    "currency": "EGP",
    "currency_symbol": "ج.م",
    "currency_exponent": 2,
    "timezone": "Africa/Cairo",
    "date_format": "YYYY-MM-DD",
    "order_prefix": "ORD-",
    "updated_at": "2026-10-07T12:30:00Z",
    "updated_by": "user_owner_01"
  }
}
```
- **Error Response (409 Conflict):**
```json
{
  "error": {
    "code": "CURRENCY_LOCKED_ORDERS_EXIST",
    "message": "Cannot modify currency once orders exist in the database.",
    "details": [
      {
        "field": "currency",
        "message": "Currency is locked to EGP because historical orders exist."
      }
    ],
    "request_id": "req-89a12c4b"
  }
}
```

---

### 1.2 Shipping Zones and Methods (E03-02)

#### `GET /api/v1/admin/settings/shipping/zones`
Retrieves all shipping zones with their assigned governorates and associated shipping methods.

- **Response (200 OK):**
```json
{
  "zones": [
    {
      "id": "zone_cairo_giza",
      "name_ar": "القاهرة الكبرى",
      "name_en": "Greater Cairo",
      "country_code": "EG",
      "governorates": ["cairo", "giza"],
      "is_active": true,
      "methods": [
        {
          "id": "sm_cairo_standard",
          "name_ar": "توصيل عادي",
          "name_en": "Standard Delivery",
          "cost_minor": 5000,
          "cost_formatted": "50.00 ج.م",
          "estimated_days_min": 1,
          "estimated_days_max": 2,
          "is_active": true
        },
        {
          "id": "sm_cairo_express",
          "name_ar": "توصيل سريع",
          "name_en": "Express Delivery",
          "cost_minor": 8500,
          "cost_formatted": "85.00 ج.م",
          "estimated_days_min": 1,
          "estimated_days_max": 1,
          "is_active": true
        }
      ]
    },
    {
      "id": "zone_alex_delta",
      "name_ar": "الإسكندرية والدلتا",
      "name_en": "Alexandria & Delta",
      "country_code": "EG",
      "governorates": ["alexandria", "beheira", "dakahlia", "gharbia", "kafr_el_sheikh", "monufia", "qalyubia"],
      "is_active": true,
      "methods": [
        {
          "id": "sm_alex_standard",
          "name_ar": "توصيل قياسي",
          "name_en": "Standard Delivery",
          "cost_minor": 6500,
          "cost_formatted": "65.00 ج.م",
          "estimated_days_min": 2,
          "estimated_days_max": 4,
          "is_active": true
        }
      ]
    }
  ]
}
```

---

#### `POST /api/v1/admin/settings/shipping/zones`
Creates a new shipping zone. Validates that selected governorates are not already active in another zone.

- **Request Body:**
```json
{
  "name_ar": "الصعيد والمحافظات النائية",
  "name_en": "Upper Egypt & Remote",
  "country_code": "EG",
  "governorates": ["asyut", "sohag", "qena", "luxor", "aswan", "red_sea", "new_valley"],
  "is_active": true
}
```
- **Response (201 Created):**
```json
{
  "success": true,
  "zone": {
    "id": "zone_upper_egypt",
    "name_ar": "الصعيد والمحافظات النائية",
    "name_en": "Upper Egypt & Remote",
    "country_code": "EG",
    "governorates": ["asyut", "sohag", "qena", "luxor", "aswan", "red_sea", "new_valley"],
    "is_active": true,
    "created_at": "2026-10-07T12:40:00Z"
  }
}
```
- **Error Response (422 Unprocessable Entity - Duplicate Governorate):**
```json
{
  "error": {
    "code": "GOVERNORATE_ALREADY_ASSIGNED",
    "message": "One or more governorates are already assigned to active shipping zones.",
    "details": [
      {
        "field": "governorates",
        "message": "Governorate 'cairo' is already assigned to zone 'القاهرة الكبرى'."
      }
    ],
    "request_id": "req-90bc128d"
  }
}
```

---

#### `POST /api/v1/admin/settings/shipping/methods`
Adds a shipping method to an existing shipping zone.

- **Request Body:**
```json
{
  "zone_id": "zone_upper_egypt",
  "name_ar": "شحن قياسي",
  "name_en": "Standard Shipping",
  "cost_minor": 9000,
  "estimated_days_min": 3,
  "estimated_days_max": 6,
  "is_active": true
}
```
- **Response (201 Created):**
```json
{
  "success": true,
  "method": {
    "id": "sm_upper_standard",
    "zone_id": "zone_upper_egypt",
    "name_ar": "شحن قياسي",
    "name_en": "Standard Shipping",
    "cost_minor": 9000,
    "estimated_days_min": 3,
    "estimated_days_max": 6,
    "is_active": true,
    "created_at": "2026-10-07T12:45:00Z"
  }
}
```

---

### 1.3 Payment Method Enablement (E03-03)

#### `GET /api/v1/admin/settings/payments`
Lists payment methods with configuration toggles and instructions. Excludes any internal secrets.

- **Response (200 OK):**
```json
{
  "payment_methods": [
    {
      "id": "cod",
      "title_ar": "الدفع عند الاستلام",
      "title_en": "Cash on Delivery (COD)",
      "instructions_ar": "الدفع نقدًا عند استلام الشحنة من مندوب التوصيل.",
      "instructions_en": "Pay cash upon receiving your order from the courier.",
      "is_enabled": true,
      "min_order_subtotal_minor": 0,
      "max_order_subtotal_minor": 1000000,
      "updated_at": "2026-10-07T10:00:00Z"
    },
    {
      "id": "online_card",
      "title_ar": "الدفع الإلكتروني عبر البطاقة",
      "title_en": "Credit / Debit Card",
      "instructions_ar": "الدفع الآمن باستخدام بطاقات فيزا وماستركارد وميزة.",
      "instructions_en": "Secure online payment via Visa, Mastercard, or Meeza.",
      "is_enabled": true,
      "min_order_subtotal_minor": 1000,
      "max_order_subtotal_minor": null,
      "updated_at": "2026-10-07T10:00:00Z"
    }
  ]
}
```

---

#### `PUT /api/v1/admin/settings/payments/{id}`
Updates the enabled status and user-facing copy for a payment method.

- **Request Body:**
```json
{
  "is_enabled": false,
  "title_ar": "الدفع عند الاستلام (معطل مؤقتًا)",
  "title_en": "Cash on Delivery (Temporarily Disabled)",
  "instructions_ar": "نعتذر، خدمة الدفع عند الاستلام غير متاحة حاليًا.",
  "instructions_en": "Sorry, COD is currently unavailable.",
  "min_order_subtotal_minor": 0,
  "max_order_subtotal_minor": 500000
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "payment_method": {
    "id": "cod",
    "is_enabled": false,
    "title_ar": "الدفع عند الاستلام (معطل مؤقتًا)",
    "title_en": "Cash on Delivery (Temporarily Disabled)",
    "instructions_ar": "نعتذر، خدمة الدفع عند الاستلام غير متاحة حاليًا.",
    "instructions_en": "Sorry, COD is currently unavailable.",
    "min_order_subtotal_minor": 0,
    "max_order_subtotal_minor": 500000,
    "updated_at": "2026-10-07T13:00:00Z"
  }
}
```

---

### 1.4 Versioned Policies (E03-04)

#### `GET /api/v1/admin/settings/policies/current`
Retrieves the active, current financial and operational policy version.

- **Response (200 OK):**
```json
{
  "current_policy": {
    "id": "pol_0192a83f-91a1-7000-8800-000000000001",
    "version": 1,
    "tax_mode": "exclusive",
    "tax_rate_basis_points": 1400,
    "tax_rate_percentage": "14.00%",
    "tax_shipping": false,
    "rounding_method": "half_up",
    "rounding_minor_unit": 100,
    "order_confirmation_mode": "manual",
    "inventory_tracking_enabled": true,
    "default_low_stock_threshold": 5,
    "reservation_ttl_seconds": 900,
    "cod_confirmation_timeout_seconds": 86400,
    "change_reason": "Initial store deployment baseline",
    "effective_from": "2026-10-05T08:00:00Z",
    "created_by": "user_owner_01"
  }
}
```

---

#### `POST /api/v1/admin/settings/policies`
Creates a brand-new policy version. The version number is atomically incremented by the database. Historical orders continue to refer to older versions.

- **Request Body:**
```json
{
  "tax_mode": "exclusive",
  "tax_rate_basis_points": 1400,
  "tax_shipping": true,
  "order_confirmation_mode": "auto_on_paid",
  "inventory_tracking_enabled": true,
  "default_low_stock_threshold": 10,
  "reservation_ttl_seconds": 1200,
  "cod_confirmation_timeout_seconds": 86400,
  "change_reason": "Enabled tax on shipping and increased low-stock alert threshold to 10."
}
```
- **Response (201 Created):**
```json
{
  "success": true,
  "policy": {
    "id": "pol_0192a83f-91a1-7000-8800-000000000002",
    "version": 2,
    "tax_mode": "exclusive",
    "tax_rate_basis_points": 1400,
    "tax_rate_percentage": "14.00%",
    "tax_shipping": true,
    "rounding_method": "half_up",
    "rounding_minor_unit": 100,
    "order_confirmation_mode": "auto_on_paid",
    "inventory_tracking_enabled": true,
    "default_low_stock_threshold": 10,
    "reservation_ttl_seconds": 1200,
    "cod_confirmation_timeout_seconds": 86400,
    "change_reason": "Enabled tax on shipping and increased low-stock alert threshold to 10.",
    "effective_from": "2026-10-07T13:15:00Z",
    "created_by": "user_owner_01"
  }
}
```

---

#### `GET /api/v1/admin/settings/policies/history`
Lists all historical policy versions in reverse chronological order for auditing and inspection.

- **Query Parameters:** `page=1&page_size=10`
- **Response (200 OK):**
```json
{
  "history": [
    {
      "id": "pol_0192a83f-91a1-7000-8800-000000000002",
      "version": 2,
      "change_reason": "Enabled tax on shipping and increased low-stock alert threshold to 10.",
      "effective_from": "2026-10-07T13:15:00Z",
      "created_by": "user_owner_01"
    },
    {
      "id": "pol_0192a83f-91a1-7000-8800-000000000001",
      "version": 1,
      "change_reason": "Initial store deployment baseline",
      "effective_from": "2026-10-05T08:00:00Z",
      "created_by": "user_owner_01"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 10,
    "total_count": 2,
    "total_pages": 1
  }
}
```

---

## 2. Storefront Public Endpoints

### 2.1 Public Store Settings

#### `GET /api/v1/store/settings/public`
Public, cacheable endpoint providing general store metadata for storefront navigation, footers, customer service links, and checkout payment selectors.

- **Headers:** Anonymous (no authentication required)
- **Response (200 OK):**
```json
{
  "store_name": "متجر بيميد الرسمي",
  "logo_url": "/api/v1/media/0192a83f-91a1-7000-8800-000000000002/public",
  "support_email": "support@bmadecomm.eg",
  "support_phone": "+201012345678",
  "address": "15 شارع مصدق، الدقي، الجيزة، مصر",
  "default_language": "ar-EG",
  "currency": "EGP",
  "currency_symbol": "ج.م",
  "timezone": "Africa/Cairo",
  "enabled_payment_methods": [
    {
      "id": "cod",
      "title": "الدفع عند الاستلام",
      "instructions": "الدفع نقدًا عند استلام الشحنة من مندوب التوصيل."
    },
    {
      "id": "online_card",
      "title": "الدفع الإلكتروني عبر البطاقة",
      "instructions": "الدفع الآمن باستخدام بطاقات فيزا وماستركارد وميزة."
    }
  ]
}
```

---

### 2.2 Shipping Eligibility Check

#### `POST /api/v1/store/shipping/check-eligibility`
Evaluates a customer's target delivery address against configured zones and returns applicable methods.

- **Request Body:**
```json
{
  "country_code": "EG",
  "governorate": "cairo",
  "city": "Nasr City",
  "postal_code": "11765"
}
```
- **Response (200 OK - Serviced Location):**
```json
{
  "is_eligible": true,
  "zone_name": "القاهرة الكبرى",
  "available_methods": [
    {
      "method_id": "sm_cairo_standard",
      "name": "توصيل عادي",
      "cost_minor": 5000,
      "cost_formatted": "50.00 ج.م",
      "estimated_days_min": 1,
      "estimated_days_max": 2
    },
    {
      "method_id": "sm_cairo_express",
      "name": "توصيل سريع",
      "cost_minor": 8500,
      "cost_formatted": "85.00 ج.م",
      "estimated_days_min": 1,
      "estimated_days_max": 1
    }
  ]
}
```
- **Response (200 OK - Unserviced Location):**
```json
{
  "is_eligible": false,
  "reason": "عذرًا، التوصيل غير متاح حاليًا لهذه المحافظة (North Sinai).",
  "available_methods": []
}
```

---

## 3. Internal Application Service Contracts

Exported across domain boundaries within the application runtime:

```typescript
// src/modules/content/settings/contracts/services.ts

export interface StoreProfileDTO {
  storeName: string;
  legalName?: string | null;
  supportEmail: string;
  supportPhone: string;
  address: string;
  logoMediaId?: string | null;
  defaultLanguage: string;
  currency: string;
  currencySymbol: string;
  currencyExponent: number;
  timezone: string;
  dateFormat: string;
  orderPrefix: string;
}

export interface ShippingMethodQuoteDTO {
  methodId: string;
  nameAr: string;
  nameEn: string;
  costMinor: number;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  isActive: boolean;
}

export interface ShippingEligibilityResult {
  isEligible: boolean;
  zoneId?: string;
  zoneName?: string;
  availableMethods: ShippingMethodQuoteDTO[];
  rejectionReason?: string;
}

export interface OperationalPolicyDTO {
  id: string;
  version: number;
  taxMode: "exclusive" | "inclusive" | "disabled";
  taxRateBasisPoints: number;
  taxShipping: boolean;
  roundingMethod: string;
  roundingMinorUnit: number;
  orderConfirmationMode: "manual" | "auto_on_paid";
  inventoryTrackingEnabled: boolean;
  defaultLowStockThreshold: number;
  reservationTtlSeconds: number;
  codConfirmationTimeoutSeconds: number;
  effectiveFrom: Date;
}

export interface IShippingEligibilityService {
  checkEligibility(address: {
    countryCode: string;
    governorate: string;
  }): Promise<ShippingEligibilityResult>;

  getMethodQuote(methodId: string): Promise<ShippingMethodQuoteDTO | null>;
}

export interface IPolicyService {
  getCurrentPolicy(): Promise<OperationalPolicyDTO>;
  getPolicyByVersion(version: number): Promise<OperationalPolicyDTO | null>;
  getPolicyById(id: string): Promise<OperationalPolicyDTO | null>;
}
```

