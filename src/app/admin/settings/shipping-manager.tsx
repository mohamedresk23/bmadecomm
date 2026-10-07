"use client";

import { useEffect, useState } from "react";
import {
  EGYPT_GOVERNORATES,
  type ShippingZoneDto,
  type ShippingMethodDto,
} from "../../../modules/content/settings/contracts/shipping";

interface ZoneFormData {
  id?: string;
  name_ar: string;
  name_en: string;
  governorates: string[];
  is_active: boolean;
}

interface MethodFormData {
  id?: string;
  zone_id: string;
  name_ar: string;
  name_en: string;
  cost_pounds: string;
  estimated_days_min: number;
  estimated_days_max: number;
  is_active: boolean;
}

export function ShippingSettingsManager() {
  const [zones, setZones] = useState<ShippingZoneDto[]>([]);
  const [csrf, setCsrf] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Modals state
  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<ZoneFormData | null>(null);
  const [zoneFormErrors, setZoneFormErrors] = useState<Record<string, string>>({});

  const [methodModalOpen, setMethodModalOpen] = useState(false);
  const [editingMethod, setEditingMethod] = useState<MethodFormData | null>(null);
  const [methodFormErrors, setMethodFormErrors] = useState<Record<string, string>>({});

  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: "zone" | "method";
    id: string;
    title: string;
  } | null>(null);

  // Refresh shipping zones and methods after mutation
  async function loadData() {
    try {
      const res = await fetch("/api/v1/admin/settings/shipping/zones", {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("فشل تحميل بيانات مناطق الشحن.");
      }
      const data = await res.json();
      setZones(data.zones || []);
      if (data.csrf) setCsrf(data.csrf);
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "تعذر جلب البيانات.",
      });
    }
  }

  // Fetch initial shipping data on mount
  useEffect(() => {
    let isMounted = true;

    async function fetchInitial() {
      try {
        const res = await fetch("/api/v1/admin/settings/shipping/zones", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error("فشل تحميل بيانات مناطق الشحن.");
        }
        const data = await res.json();
        if (!isMounted) return;

        setZones(data.zones || []);
        if (data.csrf) setCsrf(data.csrf);
      } catch (err) {
        if (!isMounted) return;
        setToast({
          type: "error",
          message: err instanceof Error ? err.message : "تعذر جلب البيانات.",
        });
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void fetchInitial();
    return () => {
      isMounted = false;
    };
  }, []);

  // Compute map of governorates assigned to active zones
  // Maps govCode -> zoneName (excluding currently edited zone if any)
  const assignedGovMap = new Map<string, string>();
  for (const z of zones) {
    if (z.is_active && (!editingZone?.id || editingZone.id !== z.id)) {
      for (const gov of z.governorates) {
        assignedGovMap.set(gov.toLowerCase(), z.name_ar);
      }
    }
  }

  // Handle Zone Modal
  function handleOpenAddZone() {
    setEditingZone({
      name_ar: "",
      name_en: "",
      governorates: [],
      is_active: true,
    });
    setZoneFormErrors({});
    setZoneModalOpen(true);
  }

  function handleOpenEditZone(zone: ShippingZoneDto) {
    setEditingZone({
      id: zone.id,
      name_ar: zone.name_ar,
      name_en: zone.name_en,
      governorates: [...zone.governorates],
      is_active: zone.is_active,
    });
    setZoneFormErrors({});
    setZoneModalOpen(true);
  }

  async function handleSaveZone(e: React.FormEvent) {
    e.preventDefault();
    if (!editingZone) return;

    const errors: Record<string, string> = {};
    if (!editingZone.name_ar.trim()) errors.name_ar = "الاسم العربي مطلوب";
    if (!editingZone.name_en.trim()) errors.name_en = "الاسم الإنجليزي مطلوب";
    if (editingZone.governorates.length === 0) {
      errors.governorates = "يجب اختيار محافظة واحدة على الأقل";
    }

    if (Object.keys(errors).length > 0) {
      setZoneFormErrors(errors);
      return;
    }

    try {
      setIsSubmitting(true);
      setZoneFormErrors({});

      const isEdit = Boolean(editingZone.id);
      const url = isEdit
        ? `/api/v1/admin/settings/shipping/zones/${editingZone.id}`
        : "/api/v1/admin/settings/shipping/zones";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
        },
        body: JSON.stringify({
          name_ar: editingZone.name_ar.trim(),
          name_en: editingZone.name_en.trim(),
          country_code: "EG",
          governorates: editingZone.governorates,
          is_active: editingZone.is_active,
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        if (body.error?.code === "GOVERNORATE_ALREADY_ASSIGNED") {
          throw new Error(body.error.message || "المحافظة مخصصة بالفعل لمنطقة نشطة أخرى.");
        }
        throw new Error(body.error?.message || "فشل حفظ منطقة الشحن.");
      }

      setToast({
        type: "success",
        message: isEdit ? "تم تحديث منطقة الشحن بنجاح." : "تمت إضافة منطقة الشحن بنجاح.",
      });
      setZoneModalOpen(false);
      setEditingZone(null);
      await loadData();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "حدث خطأ أثناء الحفظ.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handle Method Modal
  function handleOpenAddMethod(zoneId: string) {
    setEditingMethod({
      zone_id: zoneId,
      name_ar: "",
      name_en: "",
      cost_pounds: "0",
      estimated_days_min: 1,
      estimated_days_max: 3,
      is_active: true,
    });
    setMethodFormErrors({});
    setMethodModalOpen(true);
  }

  function handleOpenEditMethod(method: ShippingMethodDto) {
    setEditingMethod({
      id: method.id,
      zone_id: method.zone_id,
      name_ar: method.name_ar,
      name_en: method.name_en,
      cost_pounds: (method.cost_minor / 100).toString(),
      estimated_days_min: method.estimated_days_min,
      estimated_days_max: method.estimated_days_max,
      is_active: method.is_active,
    });
    setMethodFormErrors({});
    setMethodModalOpen(true);
  }

  async function handleSaveMethod(e: React.FormEvent) {
    e.preventDefault();
    if (!editingMethod) return;

    const errors: Record<string, string> = {};
    if (!editingMethod.name_ar.trim()) errors.name_ar = "اسم طريقة الشحن بالعربية مطلوب";
    if (!editingMethod.name_en.trim()) errors.name_en = "اسم طريقة الشحن بالإنجليزية مطلوب";

    const costNum = parseFloat(editingMethod.cost_pounds);
    if (isNaN(costNum) || costNum < 0) {
      errors.cost_pounds = "يجب تحديد تكلفة شحن صالحة (0 أو أكثر)";
    }

    if (editingMethod.estimated_days_min < 0) {
      errors.estimated_days_min = "الحد الأدنى للأيام لا يمكن أن يكون سالباً";
    }
    if (editingMethod.estimated_days_max < 0) {
      errors.estimated_days_max = "الحد الأقصى للأيام لا يمكن أن يكون سالباً";
    }
    if (editingMethod.estimated_days_min > editingMethod.estimated_days_max) {
      errors.estimated_days_min = "الحد الأدنى للأيام يجب ألا يتجاوز الحد الأقصى";
    }

    if (Object.keys(errors).length > 0) {
      setMethodFormErrors(errors);
      return;
    }

    try {
      setIsSubmitting(true);
      setMethodFormErrors({});

      const isEdit = Boolean(editingMethod.id);
      const url = isEdit
        ? `/api/v1/admin/settings/shipping/methods/${editingMethod.id}`
        : "/api/v1/admin/settings/shipping/methods";
      const method = isEdit ? "PUT" : "POST";

      const costMinor = Math.round(costNum * 100);

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
        },
        body: JSON.stringify({
          zone_id: editingMethod.zone_id,
          name_ar: editingMethod.name_ar.trim(),
          name_en: editingMethod.name_en.trim(),
          cost_minor: costMinor,
          estimated_days_min: Number(editingMethod.estimated_days_min),
          estimated_days_max: Number(editingMethod.estimated_days_max),
          is_active: editingMethod.is_active,
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error?.message || "فشل حفظ طريقة الشحن.");
      }

      setToast({
        type: "success",
        message: isEdit ? "تم تحديث طريقة الشحن بنجاح." : "تمت إضافة طريقة الشحن بنجاح.",
      });
      setMethodModalOpen(false);
      setEditingMethod(null);
      await loadData();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "حدث خطأ أثناء الحفظ.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handle Deletions
  async function handleConfirmDelete() {
    if (!deleteConfirm) return;

    try {
      setIsSubmitting(true);
      const url =
        deleteConfirm.type === "zone"
          ? `/api/v1/admin/settings/shipping/zones/${deleteConfirm.id}`
          : `/api/v1/admin/settings/shipping/methods/${deleteConfirm.id}`;

      const res = await fetch(url, {
        method: "DELETE",
        headers: {
          "X-CSRF-Token": csrf,
        },
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error?.message || "فشل حذف العنصر.");
      }

      setToast({
        type: "success",
        message:
          deleteConfirm.type === "zone"
            ? "تم حذف منطقة الشحن وجميع طرق التوصيل التابعة لها."
            : "تم حذف طريقة الشحن بنجاح.",
      });
      setDeleteConfirm(null);
      await loadData();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "حدث خطأ أثناء الحذف.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // Governorate toggle helper
  function toggleGovernorate(govCode: string) {
    if (!editingZone) return;
    const exists = editingZone.governorates.includes(govCode);
    const updated = exists
      ? editingZone.governorates.filter((g) => g !== govCode)
      : [...editingZone.governorates, govCode];
    setEditingZone({ ...editingZone, governorates: updated });
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Toast Alert */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`p-4 rounded-md text-sm font-medium flex items-center justify-between ${
            toast.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-gray-500 hover:text-gray-700 font-bold ml-2"
            aria-label="إغلاق التنبيه"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Header Card */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">مناطق وطرق الشحن والتوصيل</h2>
          <p className="text-sm text-gray-500 mt-1">
            إدارة مناطق التغطية الجغرافية في جمهورية مصر العربية وتحديد تكاليف ومواعيد التوصيل لكل منطقة
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenAddZone}
          className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          data-testid="add-zone-button"
        >
          + إضافة منطقة شحن جديدة
        </button>
      </div>

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-gray-500">
          <p className="animate-pulse">جاري تحميل مناطق وطرق الشحن...</p>
        </div>
      ) : zones.length === 0 ? (
        /* Empty State */
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
            🚚
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">لا توجد مناطق شحن مهيأة</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
            لم تقم بتهيئة أي مناطق شحن حتى الآن. أضف أول منطقة شحن لتفعيل محرك أهلية التوصيل لعملائك.
          </p>
          <button
            type="button"
            onClick={handleOpenAddZone}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
          >
            إضافة أول منطقة شحن
          </button>
        </div>
      ) : (
        /* Zones List */
        <div className="space-y-6" data-testid="zones-list">
          {zones.map((zone) => (
            <div
              key={zone.id}
              className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
              data-testid={`zone-card-${zone.id}`}
            >
              {/* Zone Header */}
              <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gray-50/50">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold text-gray-900">{zone.name_ar}</h3>
                    <span className="text-sm text-gray-500 font-mono">({zone.name_en})</span>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                        zone.is_active
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      {zone.is_active ? "نشطة" : "معطلة"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    رمز الدولة: <span className="font-semibold">{zone.country_code}</span> | عدد
                    المحافظات المشمولة:{" "}
                    <span className="font-semibold">{zone.governorates.length}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenAddMethod(zone.id)}
                    className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100"
                    data-testid={`add-method-button-${zone.id}`}
                  >
                    + إضافة طريقة شحن
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEditZone(zone)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    data-testid={`edit-zone-button-${zone.id}`}
                  >
                    تعديل المنطقة
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDeleteConfirm({
                        type: "zone",
                        id: zone.id,
                        title: `المنطقة "${zone.name_ar}" وجميع طرق التوصيل التابعة لها`,
                      })
                    }
                    className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100"
                    data-testid={`delete-zone-button-${zone.id}`}
                  >
                    حذف
                  </button>
                </div>
              </div>

              {/* Governorates Badges */}
              <div className="px-6 py-3 bg-white border-b border-gray-100">
                <span className="text-xs font-medium text-gray-500 block mb-2">
                  المحافظات التابعة لهذه المنطقة:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {zone.governorates.map((govCode) => {
                    const found = EGYPT_GOVERNORATES.find((g) => g.code === govCode);
                    return (
                      <span
                        key={govCode}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700 border border-gray-200"
                      >
                        {found ? found.name_ar : govCode}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Methods Table */}
              <div className="p-6">
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">
                  طرق الشحن والأسعار ({zone.methods.length})
                </h4>
                {zone.methods.length === 0 ? (
                  <p className="text-xs text-gray-400 py-4 text-center bg-gray-50 rounded-md">
                    لا توجد طرق شحن مضافة لهذه المنطقة حتى الآن. لن تتاح هذه المنطقة للعملاء في صفحة الدفع حتى تضيف طريقة شحن واحدة على الأقل.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-gray-500 text-xs text-right">
                        <tr>
                          <th className="px-4 py-2 font-medium">طريقة الشحن</th>
                          <th className="px-4 py-2 font-medium">الاسم بالإنجليزية</th>
                          <th className="px-4 py-2 font-medium">التكلفة</th>
                          <th className="px-4 py-2 font-medium">المدة المتوقعة</th>
                          <th className="px-4 py-2 font-medium">الحالة</th>
                          <th className="px-4 py-2 font-medium text-left">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {zone.methods.map((method) => (
                          <tr key={method.id} data-testid={`method-row-${method.id}`}>
                            <td className="px-4 py-2.5 font-medium text-gray-900">
                              {method.name_ar}
                            </td>
                            <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">
                              {method.name_en}
                            </td>
                            <td className="px-4 py-2.5 font-semibold text-gray-900">
                              {method.cost_minor === 0 ? "مجاني" : method.cost_formatted}
                            </td>
                            <td className="px-4 py-2.5 text-gray-600 text-xs">
                              {method.estimated_days_min === method.estimated_days_max
                                ? `${method.estimated_days_min} يوم`
                                : `${method.estimated_days_min} - ${method.estimated_days_max} أيام`}
                            </td>
                            <td className="px-4 py-2.5">
                              <span
                                className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                                  method.is_active
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-gray-100 text-gray-500"
                                }`}
                              >
                                {method.is_active ? "مفعّلة" : "معطلة"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-left space-x-reverse space-x-2">
                              <button
                                type="button"
                                onClick={() => handleOpenEditMethod(method)}
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                                data-testid={`edit-method-${method.id}`}
                              >
                                تعديل
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteConfirm({
                                    type: "method",
                                    id: method.id,
                                    title: `طريقة الشحن "${method.name_ar}"`,
                                  })
                                }
                                className="text-xs text-red-600 hover:text-red-800 font-medium ml-2"
                                data-testid={`delete-method-${method.id}`}
                              >
                                حذف
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Add / Edit Shipping Zone */}
      {zoneModalOpen && editingZone && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="zone-modal-title"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 space-y-6 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 id="zone-modal-title" className="text-lg font-bold text-gray-900">
                {editingZone.id ? "تعديل منطقة الشحن" : "إضافة منطقة شحن جديدة"}
              </h3>
              <button
                type="button"
                onClick={() => setZoneModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveZone} noValidate className="space-y-4 overflow-y-auto flex-1 pl-1 pr-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    اسم المنطقة (بالعربية) *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingZone.name_ar}
                    onChange={(e) =>
                      setEditingZone({ ...editingZone, name_ar: e.target.value })
                    }
                    placeholder="مثال: القاهرة الكبرى"
                    className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                    data-testid="zone-name-ar-input"
                  />
                  {zoneFormErrors.name_ar && (
                    <p className="text-xs text-red-600 mt-1" role="alert">{zoneFormErrors.name_ar}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    اسم المنطقة (بالإنجليزية) *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingZone.name_en}
                    onChange={(e) =>
                      setEditingZone({ ...editingZone, name_en: e.target.value })
                    }
                    placeholder="e.g. Greater Cairo"
                    className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                    data-testid="zone-name-en-input"
                  />
                  {zoneFormErrors.name_en && (
                    <p className="text-xs text-red-600 mt-1" role="alert">{zoneFormErrors.name_en}</p>
                  )}
                </div>
              </div>

              {/* Active Toggle */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="zone-is-active"
                  checked={editingZone.is_active}
                  onChange={(e) =>
                    setEditingZone({ ...editingZone, is_active: e.target.checked })
                  }
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                  data-testid="zone-active-toggle"
                />
                <label htmlFor="zone-is-active" className="text-sm font-medium text-gray-700">
                  تفعيل هذه المنطقة للمبيعات واستقبال الطلبات
                </label>
              </div>

              {/* Governorates Checklist */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold text-gray-700">
                    المحافظات المشمولة في هذه المنطقة (27 محافظة مصرية) *
                  </label>
                  <span className="text-xs text-gray-500">
                    محدد: {editingZone.governorates.length} محافظة
                  </span>
                </div>
                {zoneFormErrors.governorates && (
                  <p className="text-xs text-red-600 mb-2">{zoneFormErrors.governorates}</p>
                )}

                <div className="border border-gray-200 rounded-md p-3 bg-gray-50/50 max-h-56 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {EGYPT_GOVERNORATES.map((gov) => {
                    const isChecked = editingZone.governorates.includes(gov.code);
                    const conflictZone = assignedGovMap.get(gov.code);
                    const isDisabled = Boolean(conflictZone);

                    return (
                      <label
                        key={gov.code}
                        className={`flex items-start gap-2 p-2 rounded text-xs border transition-colors ${
                          isDisabled
                            ? "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
                            : isChecked
                            ? "bg-blue-50 border-blue-200 text-blue-900 cursor-pointer font-medium"
                            : "bg-white border-gray-200 text-gray-700 cursor-pointer hover:bg-gray-50"
                        }`}
                        title={
                          isDisabled
                            ? `المحافظة مخصصة بالفعل لمنطقة نشطة أخرى: (${conflictZone})`
                            : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          disabled={isDisabled}
                          checked={isChecked}
                          onChange={() => toggleGovernorate(gov.code)}
                          className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
                          data-testid={`gov-checkbox-${gov.code}`}
                        />
                        <div className="flex-1">
                          <div>{gov.name_ar}</div>
                          <div className="text-[10px] text-gray-400 font-mono">
                            {isDisabled ? `(مخصصة لـ ${conflictZone})` : gov.name_en}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  ملاحظة: المحافظات المخصصة لمنطقة نشطة أخرى لا يمكن تحديدها منعاً لتضارب أسعار ومواعيد الشحن.
                </p>
              </div>

              <div className="pt-4 border-t flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setZoneModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  data-testid="submit-zone-button"
                >
                  {isSubmitting ? "جاري الحفظ..." : "حفظ المنطقة"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add / Edit Shipping Method */}
      {methodModalOpen && editingMethod && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="method-modal-title"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 space-y-6">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 id="method-modal-title" className="text-lg font-bold text-gray-900">
                {editingMethod.id ? "تعديل طريقة الشحن" : "إضافة طريقة شحن جديدة"}
              </h3>
              <button
                type="button"
                onClick={() => setMethodModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveMethod} noValidate className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  اسم طريقة الشحن (بالعربية) *
                </label>
                <input
                  type="text"
                  required
                  value={editingMethod.name_ar}
                  onChange={(e) =>
                    setEditingMethod({ ...editingMethod, name_ar: e.target.value })
                  }
                  placeholder="مثال: شحن قياسي، شحن سريع"
                  className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  data-testid="method-name-ar-input"
                />
                {methodFormErrors.name_ar && (
                  <p className="text-xs text-red-600 mt-1">{methodFormErrors.name_ar}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  اسم طريقة الشحن (بالإنجليزية) *
                </label>
                <input
                  type="text"
                  required
                  value={editingMethod.name_en}
                  onChange={(e) =>
                    setEditingMethod({ ...editingMethod, name_en: e.target.value })
                  }
                  placeholder="e.g. Standard Shipping, Express Delivery"
                  className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  data-testid="method-name-en-input"
                />
                {methodFormErrors.name_en && (
                  <p className="text-xs text-red-600 mt-1">{methodFormErrors.name_en}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  تكلفة الشحن (بالجنيه المصري EGP) *
                </label>
                <div className="relative rounded-md shadow-sm">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={editingMethod.cost_pounds}
                    onChange={(e) =>
                      setEditingMethod({ ...editingMethod, cost_pounds: e.target.value })
                    }
                    placeholder="0.00"
                    className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 pl-12 focus:ring-blue-500 focus:border-blue-500"
                    data-testid="method-cost-input"
                  />
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-xs text-gray-500 font-semibold">
                    ج.م
                  </div>
                </div>
                {methodFormErrors.cost_pounds && (
                  <p className="text-xs text-red-600 mt-1">{methodFormErrors.cost_pounds}</p>
                )}
                <p className="text-[11px] text-gray-400 mt-0.5">
                  أدخل 0 للشحن المجاني.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    الحد الأدنى للأيام *
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editingMethod.estimated_days_min}
                    onChange={(e) =>
                      setEditingMethod({
                        ...editingMethod,
                        estimated_days_min: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                    data-testid="method-days-min-input"
                  />
                  {methodFormErrors.estimated_days_min && (
                    <p className="text-xs text-red-600 mt-1">
                      {methodFormErrors.estimated_days_min}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    الحد الأقصى للأيام *
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editingMethod.estimated_days_max}
                    onChange={(e) =>
                      setEditingMethod({
                        ...editingMethod,
                        estimated_days_max: parseInt(e.target.value, 10) || 0,
                      })
                    }
                    className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                    data-testid="method-days-max-input"
                  />
                  {methodFormErrors.estimated_days_max && (
                    <p className="text-xs text-red-600 mt-1">
                      {methodFormErrors.estimated_days_max}
                    </p>
                  )}
                </div>
              </div>

              {/* Active Toggle */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="method-is-active"
                  checked={editingMethod.is_active}
                  onChange={(e) =>
                    setEditingMethod({ ...editingMethod, is_active: e.target.checked })
                  }
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                  data-testid="method-active-toggle"
                />
                <label htmlFor="method-is-active" className="text-sm font-medium text-gray-700">
                  تفعيل طريقة الشحن هذه للعملاء
                </label>
              </div>

              <div className="pt-4 border-t flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setMethodModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  data-testid="submit-method-button"
                >
                  {isSubmitting ? "جاري الحفظ..." : "حفظ طريقة الشحن"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Delete */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-red-600">تأكيد الحذف</h3>
            <p className="text-sm text-gray-600">
              هل أنت متأكد من رغبتك في حذف {deleteConfirm.title}؟
              {deleteConfirm.type === "zone" && (
                <span className="block mt-2 font-medium text-red-500">
                  تحذير: سيتم حذف جميع طرق الشحن والأسعار المرتبطة بهذه المنطقة بشكل نهائي.
                </span>
              )}
            </p>
            <div className="flex justify-end gap-3 pt-3">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                data-testid="confirm-delete-button"
              >
                {isSubmitting ? "جاري الحذف..." : "تأكيد الحذف"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
