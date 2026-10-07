"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  SUPPORTED_CURRENCIES,
  storeProfileUpdateInputSchema,
  type AdminStoreProfileResponse,
  type StoreProfileDto,
} from "../../../modules/content/settings/contracts/store-profile";

interface ProfileFormProps {
  initialData?: AdminStoreProfileResponse;
}

export function StoreProfileForm({ initialData }: ProfileFormProps) {
  const [storeName, setStoreName] = useState(initialData?.profile.store_name ?? "");
  const [legalName, setLegalName] = useState(initialData?.profile.legal_name ?? "");
  const [supportEmail, setSupportEmail] = useState(initialData?.profile.support_email ?? "");
  const [supportPhone, setSupportPhone] = useState(initialData?.profile.support_phone ?? "");
  const [address, setAddress] = useState(initialData?.profile.address ?? "");
  const [logoMediaId, setLogoMediaId] = useState<string | null>(
    initialData?.profile.logo_media_id ?? null
  );
  const [logoUrl, setLogoUrl] = useState<string | null>(
    initialData?.profile.logo_url ?? null
  );
  const [defaultLanguage, setDefaultLanguage] = useState(
    initialData?.profile.default_language ?? "ar-EG"
  );
  const [currency, setCurrency] = useState(initialData?.profile.currency ?? "EGP");
  const [timezone, setTimezone] = useState(initialData?.profile.timezone ?? "Africa/Cairo");
  const [dateFormat, setDateFormat] = useState(
    initialData?.profile.date_format ?? "YYYY-MM-DD"
  );
  const [orderPrefix, setOrderPrefix] = useState(
    initialData?.profile.order_prefix ?? "ORD-"
  );

  const [currencyLocked, setCurrencyLocked] = useState(
    initialData?.currency_locked ?? false
  );
  const [currencyLockedReason, setCurrencyLockedReason] = useState<string | null>(
    initialData?.currency_locked_reason ?? null
  );
  const [csrf, setCsrf] = useState(initialData?.csrf ?? "");

  const [isLoading, setIsLoading] = useState(!initialData);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch initial profile if not provided via SSR props
  useEffect(() => {
    if (initialData) return;

    let isMounted = true;
    async function loadProfile() {
      try {
        const res = await fetch("/api/v1/admin/settings/profile", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error("فشل تحميل إعدادات المتجر");
        }
        const data: AdminStoreProfileResponse = await res.json();
        if (!isMounted) return;

        setStoreName(data.profile.store_name);
        setLegalName(data.profile.legal_name ?? "");
        setSupportEmail(data.profile.support_email);
        setSupportPhone(data.profile.support_phone);
        setAddress(data.profile.address ?? "");
        setLogoMediaId(data.profile.logo_media_id);
        setLogoUrl(data.profile.logo_url);
        setDefaultLanguage(data.profile.default_language);
        setCurrency(data.profile.currency);
        setTimezone(data.profile.timezone);
        setDateFormat(data.profile.date_format);
        setOrderPrefix(data.profile.order_prefix);
        setCurrencyLocked(data.currency_locked);
        setCurrencyLockedReason(data.currency_locked_reason);
        if (data.csrf) setCsrf(data.csrf);
      } catch (err) {
        if (!isMounted) return;
        setToast({
          type: "error",
          message: err instanceof Error ? err.message : "تعذر جلب البيانات.",
        });
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadProfile();
    return () => {
      isMounted = false;
    };
  }, [initialData]);

  // Handle Logo Upload via /api/media/upload
  async function handleLogoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setToast(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/media/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "فشل رفع الصورة.");
      }

      const data = await res.json();
      setLogoMediaId(data.id);
      setLogoUrl(URL.createObjectURL(file));
      setToast({ type: "success", message: "تم رفع الشعار بنجاح." });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "فشل رفع الشعار.",
      });
    } finally {
      setIsUploading(false);
    }
  }

  // Handle Form Submission
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setToast(null);
    setFieldErrors({});

    const payload = {
      store_name: storeName,
      legal_name: legalName || null,
      support_email: supportEmail,
      support_phone: supportPhone,
      address: address || null,
      logo_media_id: logoMediaId || null,
      default_language: defaultLanguage,
      currency,
      timezone,
      date_format: dateFormat,
      order_prefix: orderPrefix,
    };

    // Client-side schema validation
    const parsed = storeProfileUpdateInputSchema.safeParse(payload);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errors[issue.path.join(".")] = issue.message;
      }
      setFieldErrors(errors);
      setToast({
        type: "error",
        message: "يرجى تصحيح البيانات غير الصالحة في النموذج.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (csrf) {
        headers["X-CSRF-Token"] = csrf;
      }

      const res = await fetch("/api/v1/admin/settings/profile", {
        method: "PUT",
        headers,
        body: JSON.stringify(parsed.data),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data.error?.code === "CURRENCY_LOCKED_ORDERS_EXIST") {
          setFieldErrors({
            currency:
              data.error.details?.[0]?.message ||
              "لا يمكن تغيير العملة بعد تسجيل طلبات في المتجر.",
          });
          setCurrencyLocked(true);
          throw new Error("لا يمكن تغيير العملة بعد تسجيل أول طلب في المتجر.");
        }

        if (data.error?.details) {
          const errors: Record<string, string> = {};
          for (const d of data.error.details) {
            errors[d.field] = d.message;
          }
          setFieldErrors(errors);
        }
        throw new Error(data.error?.message || "فشل حفظ إعدادات المتجر.");
      }

      const updatedProfile: StoreProfileDto = data.profile;
      if (updatedProfile.logo_url) {
        setLogoUrl(updatedProfile.logo_url);
      }
      setToast({ type: "success", message: "تم حفظ إعدادات المتجر بنجاح." });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "حدث خطأ أثناء الحفظ.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="p-8 text-center" role="status">
        <p className="text-gray-600">جاري تحميل إعدادات المتجر...</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 max-w-4xl bg-white p-6 rounded-lg shadow-sm border border-gray-100"
      dir="rtl"
      noValidate
    >
      {/* Toast / Notification Banner */}
      {toast && (
        <div
          role={toast.type === "error" ? "alert" : "status"}
          className={`p-4 rounded-md text-sm font-medium ${
            toast.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Store Identity & Branding */}
      <div className="border-b border-gray-200 pb-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">هوية المتجر والعلامة التجارية</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="store_name" className="block text-sm font-medium text-gray-700">
              اسم المتجر <span className="text-red-500">*</span>
            </label>
            <input
              id="store_name"
              name="store_name"
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none ${
                fieldErrors.store_name
                  ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                  : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              }`}
              aria-invalid={Boolean(fieldErrors.store_name)}
              aria-describedby={fieldErrors.store_name ? "store_name_error" : undefined}
            />
            {fieldErrors.store_name && (
              <p id="store_name_error" className="mt-1 text-xs text-red-600" role="alert">
                {fieldErrors.store_name}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="legal_name" className="block text-sm font-medium text-gray-700">
              الاسم القانوني للكيان التجاري
            </label>
            <input
              id="legal_name"
              name="legal_name"
              type="text"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Logo Upload Section */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">شعار المتجر</label>
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <div className="relative w-24 h-24 rounded border border-gray-200 overflow-hidden bg-gray-50 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl}
                  alt="شعار المتجر"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="w-24 h-24 rounded border border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400 bg-gray-50">
                لا يوجد شعار
              </div>
            )}

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleLogoUpload}
                className="hidden"
                id="logo_file_input"
                aria-label="اختر ملف الشعار"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none disabled:opacity-50"
              >
                {isUploading ? "جاري الرفع..." : logoUrl ? "تغيير الشعار" : "رفع شعار"}
              </button>
              <p className="mt-1 text-xs text-gray-500">
                صيغ الصور المدعومة: PNG, JPEG, WebP بحجم أقصى 5 ميجابايت.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Support & Contact Channels */}
      <div className="border-b border-gray-200 pb-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">بيانات التواصل والدعم</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="support_email" className="block text-sm font-medium text-gray-700">
              البريد الإلكتروني للدعم <span className="text-red-500">*</span>
            </label>
            <input
              id="support_email"
              name="support_email"
              type="email"
              dir="ltr"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none ${
                fieldErrors.support_email
                  ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                  : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              }`}
              aria-invalid={Boolean(fieldErrors.support_email)}
              aria-describedby={fieldErrors.support_email ? "support_email_error" : undefined}
            />
            {fieldErrors.support_email && (
              <p id="support_email_error" className="mt-1 text-xs text-red-600" role="alert">
                {fieldErrors.support_email}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="support_phone" className="block text-sm font-medium text-gray-700">
              هاتف الدعم (مصر) <span className="text-red-500">*</span>
            </label>
            <input
              id="support_phone"
              name="support_phone"
              type="tel"
              dir="ltr"
              placeholder="+201012345678"
              value={supportPhone}
              onChange={(e) => setSupportPhone(e.target.value)}
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none ${
                fieldErrors.support_phone
                  ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                  : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              }`}
              aria-invalid={Boolean(fieldErrors.support_phone)}
              aria-describedby={fieldErrors.support_phone ? "support_phone_error" : undefined}
            />
            {fieldErrors.support_phone && (
              <p id="support_phone_error" className="mt-1 text-xs text-red-600" role="alert">
                {fieldErrors.support_phone}
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="address" className="block text-sm font-medium text-gray-700">
            العنوان الفعلي (المكتب / المستودع الرئيسي)
          </label>
          <textarea
            id="address"
            name="address"
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Regional & Financial Settings */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">الإعدادات الإقليمية والمالية</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Currency Input with Lock Guard Badge */}
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="currency" className="block text-sm font-medium text-gray-700">
                عملة التشغيل الأساسية <span className="text-red-500">*</span>
              </label>
              {currencyLocked && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                  title="لا يمكن تغيير العملة بعد تسجيل أول طلب في المتجر"
                >
                  🔒 مقفلة
                </span>
              )}
            </div>
            <select
              id="currency"
              name="currency"
              value={currency}
              disabled={currencyLocked}
              onChange={(e) => setCurrency(e.target.value)}
              aria-describedby={currencyLocked ? "currency_lock_help" : undefined}
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none ${
                currencyLocked
                  ? "bg-gray-100 cursor-not-allowed text-gray-500 border-gray-200"
                  : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              }`}
            >
              {SUPPORTED_CURRENCIES.map((curr) => (
                <option key={curr} value={curr}>
                  {curr}
                </option>
              ))}
            </select>
            {currencyLocked && (
              <p id="currency_lock_help" className="mt-1 text-xs text-amber-700">
                {currencyLockedReason ||
                  "لا يمكن تعديل العملة بعد تسجيل أول طلب في المتجر للحفاظ على سلامة المعاملات المالية."}
              </p>
            )}
            {fieldErrors.currency && (
              <p className="mt-1 text-xs text-red-600" role="alert">
                {fieldErrors.currency}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="order_prefix" className="block text-sm font-medium text-gray-700">
              بادئة أرقام الطلبات (Order Prefix)
            </label>
            <input
              id="order_prefix"
              name="order_prefix"
              type="text"
              dir="ltr"
              value={orderPrefix}
              onChange={(e) => setOrderPrefix(e.target.value.toUpperCase())}
              className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none ${
                fieldErrors.order_prefix
                  ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                  : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              }`}
              aria-invalid={Boolean(fieldErrors.order_prefix)}
              aria-describedby={fieldErrors.order_prefix ? "order_prefix_error" : undefined}
            />
            {fieldErrors.order_prefix && (
              <p id="order_prefix_error" className="mt-1 text-xs text-red-600" role="alert">
                {fieldErrors.order_prefix}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              مثال: ORD- (حروف كبيرة وأرقام فقط، بحد أقصى 10 رموز)
            </p>
          </div>

          <div>
            <label htmlFor="timezone" className="block text-sm font-medium text-gray-700">
              المنطقة الزمنية للمتجر
            </label>
            <select
              id="timezone"
              name="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
            >
              <option value="Africa/Cairo">Africa/Cairo (توقيت القاهرة GMT+2)</option>
              <option value="Asia/Riyadh">Asia/Riyadh (توقيت الرياض GMT+3)</option>
              <option value="Asia/Dubai">Asia/Dubai (توقيت دبي GMT+4)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>

          <div>
            <label htmlFor="date_format" className="block text-sm font-medium text-gray-700">
              تنسيق التاريخ المعروض
            </label>
            <select
              id="date_format"
              name="date_format"
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500"
            >
              <option value="YYYY-MM-DD">YYYY-MM-DD (2026-10-07)</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY (07/10/2026)</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY (10/07/2026)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <div className="pt-4 flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isSubmitting ? "جاري الحفظ..." : "حفظ التغييرات"}
        </button>
      </div>
    </form>
  );
}
