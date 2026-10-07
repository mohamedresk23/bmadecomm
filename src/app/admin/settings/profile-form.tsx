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
    async function fetchProfile() {
      try {
        const res = await fetch("/api/v1/admin/settings/profile", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error("تعذر جلب إعدادات المتجر من الخادم.");
        }
        const data: AdminStoreProfileResponse = await res.json();
        if (!isMounted) return;

        setStoreName(data.profile.store_name);
        setLegalName(data.profile.legal_name || "");
        setSupportEmail(data.profile.support_email);
        setSupportPhone(data.profile.support_phone);
        setAddress(data.profile.address || "");
        setLogoMediaId(data.profile.logo_media_id);
        setLogoUrl(data.profile.logo_url);
        setDefaultLanguage(data.profile.default_language);
        setCurrency(data.profile.currency);
        setTimezone(data.profile.timezone);
        setDateFormat(data.profile.date_format);
        setOrderPrefix(data.profile.order_prefix);
        setCurrencyLocked(data.currency_locked);
        setCurrencyLockedReason(data.currency_locked_reason);
        setCsrf(data.csrf ?? "");
      } catch (err) {
        if (!isMounted) return;
        setToast({
          type: "error",
          message: err instanceof Error ? err.message : "فشل تحميل الإعدادات.",
        });
      } finally {
        if (!isMounted) return;
        setIsLoading(false);
      }
    }

    void fetchProfile();
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
      <div className="bg-white rounded-2xl border border-slate-300 p-8 text-center text-slate-600" role="status">
        <p className="animate-pulse font-medium">جاري تحميل إعدادات المتجر...</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6"
      dir="rtl"
      noValidate
    >
      {/* Toast / Notification Banner */}
      {toast && (
        <div
          role={toast.type === "error" ? "alert" : "status"}
          className={`p-4 rounded-xl text-sm font-semibold flex items-center justify-between ${
            toast.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-300"
              : "bg-rose-50 text-rose-800 border border-rose-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{toast.type === "success" ? "✓" : "⚠️"}</span>
            <span>{toast.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-slate-500 hover:text-slate-800 font-bold p-1 rounded"
            aria-label="إغلاق التنبيه"
          >
            ✕
          </button>
        </div>
      )}

      {/* Store Identity & Branding Card */}
      <section className="bg-white rounded-2xl border border-slate-300 p-5 sm:p-7 shadow-xs space-y-6">
        <div className="border-b border-slate-200 pb-4">
          <h2 className="text-base sm:text-lg font-bold text-slate-900">هوية المتجر والعلامة التجارية</h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">يظهر الشعار واسم المتجر في رأس الصفحات وفواتير الشراء المعتمدة</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          <div>
            <label htmlFor="store_name" className="block text-sm font-semibold text-slate-800 mb-1.5">
              اسم المتجر <span className="text-rose-700" aria-label="مطلوب">*</span>
            </label>
            <input
              id="store_name"
              name="store_name"
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm text-slate-900 bg-white transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-700 ${
                fieldErrors.store_name
                  ? "border-rose-400 focus:border-rose-700"
                  : "border-slate-400 focus:border-blue-700 focus:ring-blue-200"
              }`}
              aria-invalid={Boolean(fieldErrors.store_name)}
              aria-describedby={fieldErrors.store_name ? "store_name_error" : undefined}
            />
            {fieldErrors.store_name && (
              <p id="store_name_error" className="mt-1.5 text-xs text-rose-700 font-semibold" role="alert">
                {fieldErrors.store_name}
              </p>
            )}
            <p className="text-xs text-slate-600 mt-1">يظهر للعملاء في رأس المتجر وعنوان التبويب في المتصفح</p>
          </div>

          <div>
            <label htmlFor="legal_name" className="block text-sm font-semibold text-slate-800 mb-1.5">
              الاسم القانوني للكيان التجاري
            </label>
            <input
              id="legal_name"
              name="legal_name"
              type="text"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-400 text-sm text-slate-900 bg-white transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-700 focus:border-blue-700"
            />
            <p className="text-xs text-slate-600 mt-1">يُطبع في تذييل الفواتير والسجلات الرسمية المعتمدة</p>
          </div>
        </div>

        {/* Logo Upload Section */}
        <div className="pt-2">
          <label className="block text-sm font-semibold text-slate-800 mb-2">شعار المتجر</label>
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
            {logoUrl ? (
              <div className="relative w-28 h-28 rounded-2xl border border-slate-300 overflow-hidden bg-slate-50 flex items-center justify-center p-2 shadow-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl}
                  alt="شعار المتجر"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="w-28 h-28 rounded-2xl border-2 border-dashed border-slate-400 flex flex-col items-center justify-center text-xs text-slate-500 bg-slate-50 p-2 text-center">
                <span className="text-xl mb-1">🖼️</span>
                <span>لا يوجد شعار</span>
              </div>
            )}

            <div className="space-y-2 text-center sm:text-right">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleLogoUpload}
                className="hidden"
                id="logo_file_input"
                aria-label="اختر ملف الشعار"
              />
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="px-4 py-2 bg-blue-50 text-blue-800 hover:bg-blue-100 text-xs sm:text-sm font-bold rounded-xl border border-blue-300 transition-colors focus-visible:ring-2 focus-visible:ring-blue-700 disabled:opacity-50"
                >
                  {isUploading ? "جاري الرفع..." : logoUrl ? "تغيير الشعار" : "رفع شعار جديد"}
                </button>
                {logoUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setLogoUrl(null);
                      setLogoMediaId(null);
                    }}
                    className="px-4 py-2 text-rose-800 hover:bg-rose-50 text-xs sm:text-sm font-bold rounded-xl border border-rose-300 transition-colors focus-visible:ring-2 focus-visible:ring-rose-700"
                  >
                    إزالة الشعار
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-600">
                الملفات المدعومة: <bdi dir="ltr">PNG, JPEG, WebP</bdi> بحجم أقصى <bdi dir="rtl">5 ميجابايت</bdi>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Support & Contact Channels Card */}
      <section className="bg-white rounded-2xl border border-slate-300 p-5 sm:p-7 shadow-xs space-y-6">
        <div className="border-b border-slate-200 pb-4">
          <h2 className="text-base sm:text-lg font-bold text-slate-900">بيانات التواصل والدعم</h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">قنوات التواصل المعتمدة لخدمة العملاء والرد على الاستفسارات</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          <div>
            <label htmlFor="support_email" className="block text-sm font-semibold text-slate-800 mb-1.5">
              البريد الإلكتروني للدعم <span className="text-rose-700" aria-label="مطلوب">*</span>
            </label>
            <input
              id="support_email"
              name="support_email"
              type="email"
              dir="ltr"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm text-slate-900 text-right bg-white font-mono transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-700 ${
                fieldErrors.support_email
                  ? "border-rose-400 focus:border-rose-700"
                  : "border-slate-400 focus:border-blue-700"
              }`}
              aria-invalid={Boolean(fieldErrors.support_email)}
              aria-describedby={fieldErrors.support_email ? "support_email_error" : undefined}
            />
            {fieldErrors.support_email && (
              <p id="support_email_error" className="mt-1.5 text-xs text-rose-700 font-semibold" role="alert">
                {fieldErrors.support_email}
              </p>
            )}
            <p className="text-xs text-slate-600 mt-1">يستلم إشعارات استفسارات العملاء والطلبات المعلقة</p>
          </div>

          <div>
            <label htmlFor="support_phone" className="block text-sm font-semibold text-slate-800 mb-1.5">
              هاتف الدعم (مصر) <span className="text-rose-700" aria-label="مطلوب">*</span>
            </label>
            <input
              id="support_phone"
              name="support_phone"
              type="tel"
              dir="ltr"
              placeholder="+201012345678"
              value={supportPhone}
              onChange={(e) => setSupportPhone(e.target.value)}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm text-slate-900 text-right bg-white font-mono transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-700 ${
                fieldErrors.support_phone
                  ? "border-rose-400 focus:border-rose-700"
                  : "border-slate-400 focus:border-blue-700"
              }`}
              aria-invalid={Boolean(fieldErrors.support_phone)}
              aria-describedby={fieldErrors.support_phone ? "support_phone_error" : undefined}
            />
            {fieldErrors.support_phone && (
              <p id="support_phone_error" className="mt-1.5 text-xs text-rose-700 font-semibold" role="alert">
                {fieldErrors.support_phone}
              </p>
            )}
            <p className="text-xs text-slate-600 mt-1">متاح للعملاء للتواصل السريع والمساعدة المباشرة</p>
          </div>

          <div className="md:col-span-2">
            <label htmlFor="address" className="block text-sm font-semibold text-slate-800 mb-1.5">
              العنوان الفعلي (المكتب / المستودع الرئيسي)
            </label>
            <textarea
              id="address"
              name="address"
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-400 text-sm text-slate-900 bg-white transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-700 focus:border-blue-700"
            />
          </div>
        </div>
      </section>

      {/* Regional & Financial Settings Card */}
      <section className="bg-white rounded-2xl border border-slate-300 p-5 sm:p-7 shadow-xs space-y-6">
        <div className="border-b border-slate-200 pb-4">
          <h2 className="text-base sm:text-lg font-bold text-slate-900">الإعدادات الإقليمية والمالية</h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">القواعد الحسابية والزمنية لمعالجة العمليات المالية والطلبات</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          {/* Currency Input with Lock Guard Badge */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="currency" className="block text-sm font-semibold text-slate-800">
                عملة التشغيل الأساسية <span className="text-rose-700" aria-label="مطلوب">*</span>
              </label>
              {currencyLocked && (
                <span
                  className="inline-flex items-center gap-1 text-xs font-bold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-300"
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
              className={`w-full px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-700 ${
                currencyLocked
                  ? "bg-slate-100 cursor-not-allowed text-slate-700 border-slate-300"
                  : "border-slate-400 bg-white text-slate-900 focus:border-blue-700"
              }`}
            >
              {SUPPORTED_CURRENCIES.map((curr) => (
                <option key={curr} value={curr}>
                  {curr}
                </option>
              ))}
            </select>
            {currencyLocked && (
              <p id="currency_lock_help" className="mt-1.5 text-xs text-amber-900 font-medium">
                {currencyLockedReason ||
                  "لا يمكن تعديل العملة بعد تسجيل أول طلب في المتجر للحفاظ على سلامة المعاملات المالية."}
              </p>
            )}
            {fieldErrors.currency && (
              <p className="mt-1.5 text-xs text-rose-700 font-semibold" role="alert">
                {fieldErrors.currency}
              </p>
            )}
          </div>

          {/* Order Prefix */}
          <div>
            <label htmlFor="order_prefix" className="block text-sm font-semibold text-slate-800 mb-1.5">
              بادئة أرقام الطلبات (Order Prefix)
            </label>
            <input
              id="order_prefix"
              name="order_prefix"
              type="text"
              dir="ltr"
              value={orderPrefix}
              onChange={(e) => setOrderPrefix(e.target.value.toUpperCase())}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm font-mono text-slate-900 text-right bg-white transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-700 ${
                fieldErrors.order_prefix
                  ? "border-rose-400 focus:border-rose-700"
                  : "border-slate-400 focus:border-blue-700"
              }`}
              aria-invalid={Boolean(fieldErrors.order_prefix)}
              aria-describedby={fieldErrors.order_prefix ? "order_prefix_error" : undefined}
            />
            {fieldErrors.order_prefix && (
              <p id="order_prefix_error" className="mt-1.5 text-xs text-rose-700 font-semibold" role="alert">
                {fieldErrors.order_prefix}
              </p>
            )}
            <p className="text-xs text-slate-600 mt-1">
              مثال: <bdi dir="ltr" className="font-mono font-bold text-blue-800 bg-blue-50 px-1 py-0.5 rounded border border-blue-200">ORD-</bdi> (حروف كبيرة وأرقام فقط، بحد أقصى 10 رموز)
            </p>
          </div>

          {/* Timezone */}
          <div>
            <label htmlFor="timezone" className="block text-sm font-semibold text-slate-800 mb-1.5">
              المنطقة الزمنية للمتجر
            </label>
            <select
              id="timezone"
              name="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-400 text-sm text-slate-900 bg-white transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-700 focus:border-blue-700"
            >
              <option value="Africa/Cairo">Africa/Cairo (توقيت القاهرة GMT+2)</option>
              <option value="Asia/Riyadh">Asia/Riyadh (توقيت الرياض GMT+3)</option>
              <option value="Asia/Dubai">Asia/Dubai (توقيت دبي GMT+4)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>

          {/* Date Format */}
          <div>
            <label htmlFor="date_format" className="block text-sm font-semibold text-slate-800 mb-1.5">
              تنسيق التاريخ المعروض
            </label>
            <select
              id="date_format"
              name="date_format"
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-400 text-sm text-slate-900 bg-white transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-700 focus:border-blue-700"
            >
              <option value="YYYY-MM-DD">YYYY-MM-DD (2026-10-07)</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY (07/10/2026)</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY (10/07/2026)</option>
            </select>
          </div>
        </div>
      </section>

      {/* Submit Button Bar */}
      <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
        <span className="text-xs text-slate-600">كافة الحقول المعلمة بـ <span className="text-rose-700 font-bold">*</span> إلزامية للتأكيد</span>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full sm:w-auto inline-flex justify-center items-center px-7 py-2.5 rounded-xl border border-transparent bg-blue-700 hover:bg-blue-800 text-sm font-bold text-white shadow-sm transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {isSubmitting ? "جاري الحفظ..." : "حفظ التغييرات"}
        </button>
      </div>
    </form>
  );
}
