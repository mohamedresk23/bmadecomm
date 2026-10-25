"use client";

import { useEffect, useState } from "react";
import { ApiClient, ClientApiError } from "../../../../../shared/api/client";
import {
  HOMEPAGE_SECTION_TYPES,
  type HomepageSectionConfig,
  type HomepageSectionType,
} from "../../../../../modules/content/homepage/contracts/section-schema";

const SECTION_LABELS: Record<
  HomepageSectionType,
  { name: string; description: string }
> = {
  hero: {
    name: "قسم البداية (Hero)",
    description: "إبراز منتجات وتصنيفات رئيسية أعلى الصفحة الرئيسية (حتى 4 منتجات و4 تصنيفات)",
  },
  featured_categories: {
    name: "تصنيفات مميزة",
    description: "عرض تصنيفات مختارة للمتسوقين (1 إلى 12 تصنيفاً عند التفعيل)",
  },
  featured_products: {
    name: "منتجات مميزة (Recommended)",
    description: "منتجات مرتبة تحريرياً لعرضها على المتسوقين (1 إلى 24 منتجاً عند التفعيل)",
  },
  best_sellers: {
    name: "الأكثر مبيعاً",
    description: "عرض المنتجات الأكثر مبيعاً تلقائياً وفق المبيعات (1 إلى 24 منتجاً)",
  },
  new_arrivals: {
    name: "أحدث المنتجات",
    description: "عرض المنتجات المضافة حديثاً تلقائياً وفق تاريخ النشر (1 إلى 24 منتجاً)",
  },
  promotions: {
    name: "العروض والخصومات",
    description: "منتجات محددة تحريرياً ذات أسعار مخفضة أو عروض نشطة (1 إلى 24 منتجاً عند التفعيل)",
  },
};

interface DraftResponse {
  success: boolean;
  draft: {
    sections: HomepageSectionConfig[];
    revision: number;
    updatedAt: string;
    updatedBy: string | null;
  };
  latestPublication: {
    version: number;
    sourceDraftRevision: number;
    publishedAt: string;
    publishedBy: string;
  } | null;
  csrf: string;
}

export function HomepageEditor() {
  const [sections, setSections] = useState<HomepageSectionConfig[]>([]);
  const [revision, setRevision] = useState<number>(1);
  const [latestPublication, setLatestPublication] = useState<DraftResponse["latestPublication"]>(null);
  const [csrf, setCsrf] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [selectedTypeToAdd, setSelectedTypeToAdd] = useState<HomepageSectionType>("hero");
  const [message, setMessage] = useState<{ type: "success" | "error" | "conflict"; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const reloadDraft = async () => {
    try {
      setLoading(true);
      setMessage(null);
      const data = await ApiClient.fetch<DraftResponse>("/api/v1/admin/content/homepage");
      setSections(data.draft.sections || []);
      setRevision(data.draft.revision);
      setLatestPublication(data.latestPublication);
      setCsrf(data.csrf);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "فشل تحميل مسودة الصفحة الرئيسية",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    ApiClient.fetch<DraftResponse>("/api/v1/admin/content/homepage")
      .then((data) => {
        if (!isMounted) return;
        setSections(data.draft.sections || []);
        setRevision(data.draft.revision);
        setLatestPublication(data.latestPublication);
        setCsrf(data.csrf);
        setLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        setMessage({
          type: "error",
          text: err instanceof Error ? err.message : "فشل تحميل مسودة الصفحة الرئيسية",
        });
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const normalizePositions = (items: HomepageSectionConfig[]): HomepageSectionConfig[] => {
    return items.map((sec, idx) => ({
      ...sec,
      position: idx,
    }));
  };

  const moveSection = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sections.length) return;

    const copy = [...sections];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIndex, 0, moved);
    setSections(normalizePositions(copy));
    setMessage(null);
  };

  const toggleSectionEnabled = (index: number) => {
    const copy = [...sections];
    copy[index] = { ...copy[index], enabled: !copy[index].enabled };
    setSections(copy);
    setMessage(null);
  };

  const removeSection = (index: number) => {
    const copy = [...sections];
    copy.splice(index, 1);
    setSections(normalizePositions(copy));
    setMessage(null);
  };

  const addSection = (type: HomepageSectionType) => {
    if (sections.length >= 12) {
      setMessage({ type: "error", text: "لا يمكن إضافة أكثر من 12 قسماً في الصفحة الرئيسية" });
      return;
    }

    const newId = `sec-${type}-${Date.now()}`;
    const base = {
      id: newId,
      enabled: true,
      position: sections.length,
    };

    let newSection: HomepageSectionConfig;
    switch (type) {
      case "hero":
        newSection = { ...base, type: "hero", productIds: [], categoryIds: [] };
        break;
      case "featured_categories":
        newSection = { ...base, type: "featured_categories", categoryIds: [] };
        break;
      case "featured_products":
        newSection = { ...base, type: "featured_products", productIds: [] };
        break;
      case "best_sellers":
        newSection = { ...base, type: "best_sellers", limit: 8 };
        break;
      case "new_arrivals":
        newSection = { ...base, type: "new_arrivals", limit: 8 };
        break;
      case "promotions":
        newSection = { ...base, type: "promotions", productIds: [] };
        break;
    }

    setSections(normalizePositions([...sections, newSection]));
    setMessage(null);
  };

  const updateSectionField = (index: number, updater: (sec: HomepageSectionConfig) => HomepageSectionConfig) => {
    const copy = [...sections];
    copy[index] = updater(copy[index]);
    setSections(copy);
    setMessage(null);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    setFieldErrors({});

    try {
      const payload = {
        expectedRevision: revision,
        sections: normalizePositions(sections),
      };

      const res = await ApiClient.fetch<{ success: boolean; draft: DraftResponse["draft"]; csrf: string }>(
        "/api/v1/admin/content/homepage",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
          },
          body: JSON.stringify(payload),
        }
      );

      setRevision(res.draft.revision);
      setSections(res.draft.sections);
      setCsrf(res.csrf);
      setMessage({
        type: "success",
        text: `تم حفظ المسودة بنجاح (المراجعة ${res.draft.revision})`,
      });
    } catch (err) {
      if (err instanceof ClientApiError) {
        if (err.status === 409) {
          setMessage({
            type: "conflict",
            text: "تم تعديل المسودة بواسطة مستخدم آخر. يرجى تحديث الصفحة لجلب أحدث التغييرات.",
          });
        } else if (err.status === 422 && err.details) {
          const errors: Record<string, string> = {};
          err.details.forEach((d) => {
            errors[d.field] = d.message;
          });
          setFieldErrors(errors);
          setMessage({
            type: "error",
            text: "تعذر الحفظ لوجود أخطاء في البيانات المدخلة. راجع الحقول المحددة أدناه.",
          });
        } else {
          setMessage({
            type: "error",
            text: err.message || "حدث خطأ أثناء حفظ المسودة",
          });
        }
      } else {
        setMessage({
          type: "error",
          text: err instanceof Error ? err.message : "حدث خطأ غير متوقع",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center" dir="rtl">
        <p className="text-slate-600">جاري تحميل مسودة محتوى الصفحة الرئيسية...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header Info Card */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
              المراجعة الحالية: {revision}
            </span>
            {latestPublication ? (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                منشور حالياً: الإصدار {latestPublication.version} (من المسودة {latestPublication.sourceDraftRevision})
              </span>
            ) : (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                لم يتم النشر بعد (واجهة المتجر تعرض الحالة الافتراضية)
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            يمكنك إعادة ترتيب الأقسام باستخدام أزرار تحريك لأعلى ولأسفل بدون الحاجة للسحب والإفلات. التعديلات تحفظ في المسودة ولا تظهر للمتسوقين إلا بعد النشر.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={reloadDraft}
            disabled={saving}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            تحديث
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-blue-700 px-6 py-2 text-sm font-semibold text-white shadow hover:bg-blue-800 disabled:opacity-50"
          >
            {saving ? "جاري الحفظ..." : "حفظ المسودة"}
          </button>
        </div>
      </div>

      {/* Status Alert Banner */}
      {message && (
        <div
          role="alert"
          aria-live="polite"
          className={`rounded-lg p-4 text-sm font-medium ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : message.type === "conflict"
              ? "bg-amber-50 text-amber-900 border border-amber-300"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Field Errors Global Summary */}
      {Object.keys(fieldErrors).length > 0 && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h3 className="font-semibold text-red-800">أخطاء التحقق:</h3>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-red-700">
            {Object.entries(fieldErrors).map(([field, err]) => (
              <li key={field}>
                <span className="font-mono text-xs">{field}:</span> {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sections List */}
      <div className="space-y-4">
        {sections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
            <p className="text-slate-600 font-medium">لا توجد أقسام في مسودة الصفحة الرئيسية حالياً.</p>
            <p className="mt-1 text-sm text-slate-500">اختر نوع قسم من القائمة أدناه لإضافته.</p>
          </div>
        ) : (
          sections.map((section, idx) => {
            const meta = SECTION_LABELS[section.type];
            const sectionFieldPrefix = `sections[${idx}]`;
            const hasSectionError = Object.keys(fieldErrors).some((k) => k.startsWith(sectionFieldPrefix));

            return (
              <div
                key={section.id}
                data-testid={`section-card-${idx}`}
                className={`rounded-xl border bg-white p-6 shadow-sm transition-all ${
                  hasSectionError ? "border-red-300 bg-red-50/20" : "border-slate-200"
                }`}
              >
                {/* Section Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                      {idx + 1}
                    </span>
                    <div>
                      <h3 className="font-bold text-slate-900">{meta?.name || section.type}</h3>
                      <p className="text-xs text-slate-500">{meta?.description}</p>
                    </div>
                  </div>

                  {/* Actions & Ordering Controls */}
                  <div className="flex items-center gap-2">
                    {/* Toggle Enabled */}
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={section.enabled}
                        onChange={() => toggleSectionEnabled(idx)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className={section.enabled ? "font-semibold text-emerald-700" : "text-slate-400"}>
                        {section.enabled ? "مفعّل" : "معطّل"}
                      </span>
                    </label>

                    <div className="mx-2 h-4 w-px bg-slate-200" />

                    {/* Accessible Keyboard Reordering Controls */}
                    <button
                      type="button"
                      aria-label={`تحريك قسم ${meta?.name || section.id} لأعلى`}
                      disabled={idx === 0}
                      onClick={() => moveSection(idx, "up")}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-white"
                    >
                      ↑ تحريك لأعلى
                    </button>
                    <button
                      type="button"
                      aria-label={`تحريك قسم ${meta?.name || section.id} لأسفل`}
                      disabled={idx === sections.length - 1}
                      onClick={() => moveSection(idx, "down")}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-white"
                    >
                      ↓ تحريك لأسفل
                    </button>

                    <button
                      type="button"
                      aria-label={`حذف قسم ${meta?.name || section.id}`}
                      onClick={() => removeSection(idx)}
                      className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                    >
                      حذف
                    </button>
                  </div>
                </div>

                {/* Section Content Configuration */}
                <div className="mt-4 space-y-4">
                  {/* Hero configuration */}
                  {section.type === "hero" && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          معرّفات المنتجات المميزة في قسم البداية (حتى 4 منتجات)
                        </label>
                        <IdListEditor
                          ids={section.productIds}
                          max={4}
                          fieldPrefix={`${sectionFieldPrefix}.productIds`}
                          fieldErrors={fieldErrors}
                          placeholder="أدخل معرّف المنتج (مثال: prd_123)"
                          onChange={(newIds) =>
                            updateSectionField(idx, (s) => (s.type === "hero" ? { ...s, productIds: newIds } : s))
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          معرّفات التصنيفات المميزة في قسم البداية (حتى 4 تصنيفات)
                        </label>
                        <IdListEditor
                          ids={section.categoryIds}
                          max={4}
                          fieldPrefix={`${sectionFieldPrefix}.categoryIds`}
                          fieldErrors={fieldErrors}
                          placeholder="أدخل معرّف التصنيف (مثال: cat_123)"
                          onChange={(newIds) =>
                            updateSectionField(idx, (s) => (s.type === "hero" ? { ...s, categoryIds: newIds } : s))
                          }
                        />
                      </div>
                    </div>
                  )}

                  {/* Featured Categories */}
                  {section.type === "featured_categories" && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        معرّفات التصنيفات المختارة (1 إلى 12 تصنيفاً بالترتيب المطلوب)
                      </label>
                      <IdListEditor
                        ids={section.categoryIds}
                        max={12}
                        fieldPrefix={`${sectionFieldPrefix}.categoryIds`}
                        fieldErrors={fieldErrors}
                        placeholder="أدخل معرّف التصنيف"
                        onChange={(newIds) =>
                          updateSectionField(idx, (s) =>
                            s.type === "featured_categories" ? { ...s, categoryIds: newIds } : s
                          )
                        }
                      />
                    </div>
                  )}

                  {/* Featured Products */}
                  {section.type === "featured_products" && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        معرّفات المنتجات المختارة (1 إلى 24 منتجاً بالترتيب التحريري المطلوب)
                      </label>
                      <IdListEditor
                        ids={section.productIds}
                        max={24}
                        fieldPrefix={`${sectionFieldPrefix}.productIds`}
                        fieldErrors={fieldErrors}
                        placeholder="أدخل معرّف المنتج"
                        onChange={(newIds) =>
                          updateSectionField(idx, (s) =>
                            s.type === "featured_products" ? { ...s, productIds: newIds } : s
                          )
                        }
                      />
                    </div>
                  )}

                  {/* Best Sellers */}
                  {section.type === "best_sellers" && (
                    <div className="max-w-xs">
                      <label htmlFor={`limit-${section.id}`} className="block text-xs font-semibold text-slate-700">
                        عدد المنتجات المعروضة (1 إلى 24):
                      </label>
                      <input
                        id={`limit-${section.id}`}
                        type="number"
                        min={1}
                        max={24}
                        value={section.limit}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          updateSectionField(idx, (s) =>
                            s.type === "best_sellers" ? { ...s, limit: isNaN(val) ? 8 : val } : s
                          );
                        }}
                        className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
                      />
                      {fieldErrors[`${sectionFieldPrefix}.limit`] && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors[`${sectionFieldPrefix}.limit`]}</p>
                      )}
                    </div>
                  )}

                  {/* New Arrivals */}
                  {section.type === "new_arrivals" && (
                    <div className="max-w-xs">
                      <label htmlFor={`limit-${section.id}`} className="block text-xs font-semibold text-slate-700">
                        عدد المنتجات المعروضة (1 إلى 24):
                      </label>
                      <input
                        id={`limit-${section.id}`}
                        type="number"
                        min={1}
                        max={24}
                        value={section.limit}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          updateSectionField(idx, (s) =>
                            s.type === "new_arrivals" ? { ...s, limit: isNaN(val) ? 8 : val } : s
                          );
                        }}
                        className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
                      />
                      {fieldErrors[`${sectionFieldPrefix}.limit`] && (
                        <p className="mt-1 text-xs text-red-600">{fieldErrors[`${sectionFieldPrefix}.limit`]}</p>
                      )}
                    </div>
                  )}

                  {/* Promotions */}
                  {section.type === "promotions" && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        معرّفات المنتجات الترويجية (1 إلى 24 منتجاً)
                      </label>
                      <IdListEditor
                        ids={section.productIds}
                        max={24}
                        fieldPrefix={`${sectionFieldPrefix}.productIds`}
                        fieldErrors={fieldErrors}
                        placeholder="أدخل معرّف المنتج"
                        onChange={(newIds) =>
                          updateSectionField(idx, (s) =>
                            s.type === "promotions" ? { ...s, productIds: newIds } : s
                          )
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add New Section Controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label htmlFor="select-section-type" className="text-sm font-semibold text-slate-700">
          إضافة قسم جديد:
        </label>
        <select
          id="select-section-type"
          value={selectedTypeToAdd}
          onChange={(e) => setSelectedTypeToAdd(e.target.value as HomepageSectionType)}
          className="rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
        >
          {HOMEPAGE_SECTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {SECTION_LABELS[t].name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => addSection(selectedTypeToAdd)}
          disabled={sections.length >= 12}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
        >
          + إضافة القسم
        </button>
        {sections.length >= 12 && (
          <span className="text-xs text-amber-700 font-medium">وصلت للحد الأقصى من الأقسام (12)</span>
        )}
      </div>
    </div>
  );
}

/** Helper component for managing ordered lists of product/category IDs with accessible keyboard reordering */
function IdListEditor({
  ids,
  max,
  fieldPrefix,
  fieldErrors,
  placeholder,
  onChange,
}: {
  ids: string[];
  max: number;
  fieldPrefix: string;
  fieldErrors: Record<string, string>;
  placeholder: string;
  onChange: (ids: string[]) => void;
}) {
  const [inputValue, setInputValue] = useState("");

  const handleAdd = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (ids.includes(trimmed)) return;
    if (ids.length >= max) return;
    onChange([...ids, trimmed]);
    setInputValue("");
  };

  const handleRemove = (index: number) => {
    const copy = [...ids];
    copy.splice(index, 1);
    onChange(copy);
  };

  const handleMove = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= ids.length) return;
    const copy = [...ids];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIndex, 0, moved);
    onChange(copy);
  };

  return (
    <div className="mt-1 space-y-2">
      {/* Existing IDs list */}
      {ids.length > 0 && (
        <ul className="space-y-1.5">
          {ids.map((id, itemIdx) => {
            const itemField = `${fieldPrefix}[${itemIdx}]`;
            const itemError = fieldErrors[itemField];

            return (
              <li
                key={`${id}-${itemIdx}`}
                className={`flex items-center justify-between gap-2 rounded-lg border p-2 text-xs font-mono ${
                  itemError ? "border-red-300 bg-red-50 text-red-900" : "border-slate-200 bg-slate-50 text-slate-800"
                }`}
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="text-slate-400 font-sans">{itemIdx + 1}.</span>
                  <span className="truncate">{id}</span>
                  {itemError && <span className="font-sans text-red-600">({itemError})</span>}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`تحريك العنصر ${id} لأعلى`}
                    disabled={itemIdx === 0}
                    onClick={() => handleMove(itemIdx, "up")}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`تحريك العنصر ${id} لأسفل`}
                    disabled={itemIdx === ids.length - 1}
                    onClick={() => handleMove(itemIdx, "down")}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`إزالة العنصر ${id}`}
                    onClick={() => handleRemove(itemIdx)}
                    className="rounded border border-red-200 bg-white px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Global field error for this array (e.g. at least 1 required) */}
      {fieldErrors[fieldPrefix] && (
        <p className="text-xs text-red-600">{fieldErrors[fieldPrefix]}</p>
      )}

      {/* Input to add new ID */}
      {ids.length < max && (
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            placeholder={placeholder}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            className="flex-1 rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!inputValue.trim()}
            className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-200 disabled:opacity-40"
          >
            إضافة
          </button>
        </div>
      )}
    </div>
  );
}
