"use client";

import { useEffect, useState } from "react";
import type {
  CategoryTreeNode,
  CategoryDto,
} from "../../../../modules/catalog/categories/contracts/category";

interface CategoryFormData {
  id?: string;
  name: string;
  slug: string;
  description: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export function CategoryManager() {
  const [categories, setCategories] = useState<CategoryTreeNode[]>([]);
  const [csrf, setCsrf] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Form modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState<CategoryFormData>({
    name: "",
    slug: "",
    description: "",
    parentId: null,
    sortOrder: 0,
    isActive: true,
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Delete modal state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Flatten all categories for parent selector dropdown
  function flattenCategories(
    nodes: CategoryTreeNode[],
    prefix = ""
  ): Array<{ id: string; name: string }> {
    let result: Array<{ id: string; name: string }> = [];
    for (const node of nodes) {
      result.push({ id: node.id, name: prefix ? `${prefix} > ${node.name}` : node.name });
      if (node.children && node.children.length > 0) {
        result = result.concat(flattenCategories(node.children, prefix ? `${prefix} > ${node.name}` : node.name));
      }
    }
    return result;
  }

  function getDescendantIds(targetId: string, nodes: CategoryTreeNode[]): Set<string> {
    const result = new Set<string>();
    function findNode(tree: CategoryTreeNode[]): CategoryTreeNode | null {
      for (const node of tree) {
        if (node.id === targetId) return node;
        if (node.children && node.children.length > 0) {
          const found = findNode(node.children);
          if (found) return found;
        }
      }
      return null;
    }

    const targetNode = findNode(nodes);
    if (!targetNode) return result;

    function collect(node: CategoryTreeNode) {
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          result.add(child.id);
          collect(child);
        }
      }
    }

    collect(targetNode);
    return result;
  }

  async function loadData() {
    try {
      const res = await fetch("/api/v1/admin/catalog/categories", {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("فشل تحميل قائمة التصنيفات");
      }
      const data = await res.json();
      setCategories(data.categories || []);
      if (data.csrf) setCsrf(data.csrf);

      // Auto-expand all top-level nodes by default
      const initialExpanded: Record<string, boolean> = {};
      const expandAll = (nodes: CategoryTreeNode[]) => {
        for (const n of nodes) {
          initialExpanded[n.id] = true;
          if (n.children) expandAll(n.children);
        }
      };
      expandAll(data.categories || []);
      setExpandedNodes(initialExpanded);
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "تعذر جلب البيانات",
      });
    }
  }

  useEffect(() => {
    let isMounted = true;
    async function init() {
      try {
        const res = await fetch("/api/v1/admin/catalog/categories", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error("فشل تحميل قائمة التصنيفات");
        }
        const data = await res.json();
        if (!isMounted) return;
        setCategories(data.categories || []);
        if (data.csrf) setCsrf(data.csrf);

        const initialExpanded: Record<string, boolean> = {};
        const expandAll = (nodes: CategoryTreeNode[]) => {
          for (const n of nodes) {
            initialExpanded[n.id] = true;
            if (n.children) expandAll(n.children);
          }
        };
        expandAll(data.categories || []);
        setExpandedNodes(initialExpanded);
      } catch (err) {
        if (!isMounted) return;
        setToast({
          type: "error",
          message: err instanceof Error ? err.message : "تعذر جلب البيانات",
        });
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    void init();
    return () => {
      isMounted = false;
    };
  }, []);

  function toggleExpand(id: string) {
    setExpandedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function openCreateModal(parentId: string | null = null) {
    setFormData({
      name: "",
      slug: "",
      description: "",
      parentId,
      sortOrder: 0,
      isActive: true,
    });
    setFormErrors({});
    setModalOpen(true);
  }

  function openEditModal(node: CategoryDto) {
    setFormData({
      id: node.id,
      name: node.name,
      slug: node.slug,
      description: node.description || "",
      parentId: node.parentId,
      sortOrder: node.sortOrder,
      isActive: node.isActive,
    });
    setFormErrors({});
    setModalOpen(true);
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormErrors({});

    // Client-side quick validation
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) {
      errors.name = "اسم التصنيف مطلوب";
    }
    if (!formData.slug.trim()) {
      errors.slug = "الرابط الدائم (Slug) مطلوب";
    }
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      const isEdit = Boolean(formData.id);
      const url = isEdit
        ? `/api/v1/admin/catalog/categories/${formData.id}`
        : "/api/v1/admin/catalog/categories";
      const method = isEdit ? "PUT" : "POST";

      const payload = {
        name: formData.name.trim(),
        slug: formData.slug.trim(),
        description: formData.description.trim() || null,
        parentId: formData.parentId || null,
        sortOrder: Number(formData.sortOrder) || 0,
        isActive: formData.isActive,
      };

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf,
        },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        if (result.error?.details && Array.isArray(result.error.details)) {
          const fieldErrors: Record<string, string> = {};
          for (const d of result.error.details) {
            fieldErrors[d.field] = d.message;
          }
          setFormErrors(fieldErrors);
          return;
        }
        throw new Error(result.error?.message || "حدث خطأ أثناء حفظ التصنيف");
      }

      setToast({
        type: "success",
        message: isEdit ? "تم تحديث التصنيف بنجاح" : "تم إنشاء التصنيف بنجاح",
      });
      setModalOpen(false);
      await loadData();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "حدث خطأ غير متوقع",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteConfirm) return;
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/v1/admin/catalog/categories/${deleteConfirm.id}`, {
        method: "DELETE",
        headers: {
          "X-CSRF-Token": csrf,
        },
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error?.message || "فشل حذف التصنيف");
      }

      setToast({
        type: "success",
        message: "تم حذف التصنيف بنجاح",
      });
      setDeleteConfirm(null);
      await loadData();
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "حدث خطأ أثناء الحذف",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const descendantIds = formData.id ? getDescendantIds(formData.id, categories) : new Set<string>();
  const flatCategoryList = flattenCategories(categories).filter(
    (c) => c.id !== formData.id && !descendantIds.has(c.id)
  );

  return (
    <div className="space-y-6" dir="rtl">
      {/* Toast Notification */}
      {toast && (
        <div
          role="alert"
          className={`p-4 rounded-xl border flex items-center justify-between text-sm ${
            toast.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{toast.type === "success" ? "✓" : "⚠️"}</span>
            <span>{toast.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-xs font-semibold hover:underline"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* Header Actions */}
      <div className="bg-white rounded-2xl border border-slate-300 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">هيكل التصنيفات</h2>
          <p className="text-xs text-slate-600 mt-0.5">
            عرض وتنظيم الفئات الرئيسية والفرعية مع دعم الترتيب وحالات التفعيل
          </p>
        </div>
        <button
          type="button"
          onClick={() => openCreateModal(null)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-bold shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-700"
        >
          <span>+</span>
          <span>إضافة تصنيف رئيسي</span>
        </button>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-slate-300 p-12 text-center text-slate-500">
          <div className="inline-block animate-spin w-6 h-6 border-2 border-blue-700 border-t-transparent rounded-full mb-3" />
          <p className="text-sm font-semibold">جاري تحميل شجرة التصنيفات...</p>
        </div>
      ) : categories.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-300 p-12 text-center space-y-4">
          <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-xl text-slate-500">
            📁
          </div>
          <h3 className="text-base font-bold text-slate-900">لا توجد تصنيفات بعد</h3>
          <p className="text-xs text-slate-600 max-w-md mx-auto">
            ابدأ بإنشاء أول تصنيف رئيسي لتنظيم الكتالوج والمنتجات في متجرك.
          </p>
          <button
            type="button"
            onClick={() => openCreateModal(null)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold transition-colors"
          >
            <span>+</span>
            <span>إضافة أول تصنيف</span>
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-300 overflow-hidden shadow-xs divide-y divide-slate-200">
          {categories.map((node) => (
            <CategoryNodeItem
              key={node.id}
              node={node}
              depth={0}
              expanded={expandedNodes[node.id] ?? true}
              onToggle={toggleExpand}
              onAddChild={openCreateModal}
              onEdit={openEditModal}
              onDelete={(n) => setDeleteConfirm({ id: n.id, name: n.name })}
            />
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <h3 id="modal-title" className="text-base font-bold text-slate-900">
                {formData.id ? "تعديل بيانات التصنيف" : "إضافة تصنيف جديد"}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none p-1"
                aria-label="إغلاق النافذة"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-4">
              {/* Name */}
              <div className="space-y-1">
                <label htmlFor="cat-name" className="block text-xs font-bold text-slate-800">
                  اسم التصنيف <span className="text-rose-600">*</span>
                </label>
                <input
                  id="cat-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="مثال: أحذية، ملابس رجالية"
                  className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-hidden focus:ring-2 ${
                    formErrors.name
                      ? "border-rose-400 focus:ring-rose-200"
                      : "border-slate-300 focus:ring-blue-200 focus:border-blue-700"
                  }`}
                />
                {formErrors.name && (
                  <p className="text-xs text-rose-600">{formErrors.name}</p>
                )}
              </div>

              {/* Slug */}
              <div className="space-y-1">
                <label htmlFor="cat-slug" className="block text-xs font-bold text-slate-800">
                  الرابط الدائم (Slug) <span className="text-rose-600">*</span>
                </label>
                <input
                  id="cat-slug"
                  type="text"
                  dir="ltr"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  placeholder="men-shoes"
                  className={`w-full px-3 py-2 text-sm rounded-lg border font-mono text-left focus:outline-hidden focus:ring-2 ${
                    formErrors.slug
                      ? "border-rose-400 focus:ring-rose-200"
                      : "border-slate-300 focus:ring-blue-200 focus:border-blue-700"
                  }`}
                />
                {formErrors.slug ? (
                  <p className="text-xs text-rose-600">{formErrors.slug}</p>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    أحرف إنجليزية صغيرة وأرقام وفواصل فقط (lowercase kebab-case)
                  </p>
                )}
              </div>

              {/* Parent Category */}
              <div className="space-y-1">
                <label htmlFor="cat-parent" className="block text-xs font-bold text-slate-800">
                  التصنيف الأب (Parent Category)
                </label>
                <select
                  id="cat-parent"
                  value={formData.parentId || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      parentId: e.target.value ? e.target.value : null,
                    })
                  }
                  className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-hidden focus:ring-2 ${
                    formErrors.parentId
                      ? "border-rose-400 focus:ring-rose-200"
                      : "border-slate-300 focus:ring-blue-200 focus:border-blue-700"
                  }`}
                >
                  <option value="">بدون تصنيف أب (تصنيف رئيسي)</option>
                  {flatCategoryList.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
                {formErrors.parentId && (
                  <p className="text-xs text-rose-600">{formErrors.parentId}</p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-1">
                <label htmlFor="cat-desc" className="block text-xs font-bold text-slate-800">
                  الوصف (اختياري)
                </label>
                <textarea
                  id="cat-desc"
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="وصف مختصر لتصنيف المنتجات..."
                  className={`w-full px-3 py-2 text-sm rounded-lg border focus:ring-blue-200 focus:border-blue-700 focus:outline-hidden ${
                    formErrors.description ? "border-rose-400 focus:ring-rose-200" : "border-slate-300"
                  }`}
                />
                {formErrors.description && (
                  <p className="text-xs text-rose-600">{formErrors.description}</p>
                )}
              </div>

              {/* Sort Order & Is Active */}
              <div className="grid grid-cols-2 gap-4 pt-1">
                <div className="space-y-1">
                  <label htmlFor="cat-sort" className="block text-xs font-bold text-slate-800">
                    ترتيب العرض
                  </label>
                  <input
                    id="cat-sort"
                    type="number"
                    min="0"
                    value={formData.sortOrder}
                    onChange={(e) =>
                      setFormData({ ...formData, sortOrder: parseInt(e.target.value, 10) || 0 })
                    }
                    className={`w-full px-3 py-2 text-sm rounded-lg border focus:ring-blue-200 focus:border-blue-700 focus:outline-hidden ${
                      formErrors.sortOrder ? "border-rose-400 focus:ring-rose-200" : "border-slate-300"
                    }`}
                  />
                  {formErrors.sortOrder && (
                    <p className="text-xs text-rose-600">{formErrors.sortOrder}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <input
                    id="cat-active"
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="w-4 h-4 text-blue-700 rounded border-slate-300 focus:ring-blue-600"
                  />
                  <label htmlFor="cat-active" className="text-xs font-bold text-slate-800 cursor-pointer">
                    تصنيف نشط ومعروض بالمتجر
                  </label>
                </div>
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? "جاري الحفظ..." : formData.id ? "حفظ التغييرات" : "إضافة التصنيف"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-rose-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-700 flex items-center justify-center font-bold text-lg">
              ⚠️
            </div>
            <h3 id="delete-dialog-title" className="text-base font-bold text-slate-900">
              تأكيد حذف التصنيف
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              هل أنت متأكد من رغبتك في حذف التصنيف{" "}
              <strong className="text-slate-900 font-bold">&quot;{deleteConfirm.name}&quot;</strong>؟
              <br />
              <span className="text-rose-600 font-semibold">
                ملاحظة: لا يمكن حذف أي تصنيف يحتوي على تصنيفات فرعية تحته.
              </span>
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                disabled={isSubmitting}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={isSubmitting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
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

interface CategoryNodeItemProps {
  node: CategoryTreeNode;
  depth: number;
  expanded: boolean;
  onToggle: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onEdit: (node: CategoryDto) => void;
  onDelete: (node: CategoryDto) => void;
}

function CategoryNodeItem({
  node,
  depth,
  expanded,
  onToggle,
  onAddChild,
  onEdit,
  onDelete,
}: CategoryNodeItemProps) {
  const hasChildren = node.children && node.children.length > 0;
  const paddingRight = `${depth * 1.5 + 1}rem`;

  return (
    <div className="flex flex-col">
      <div
        className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors gap-3"
        style={{ paddingRight }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggle(node.id)}
              className="w-6 h-6 rounded flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors text-xs font-bold"
              aria-label={expanded ? "طي التصنيفات الفرعية" : "توسيع التصنيفات الفرعية"}
            >
              {expanded ? "▼" : "◀"}
            </button>
          ) : (
            <span className="w-6 h-6 flex items-center justify-center text-slate-300 text-xs" aria-hidden="true">
              •
            </span>
          )}

          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-slate-900 truncate">
                {node.name}
              </span>
              <span className="text-[11px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200" dir="ltr">
                /{node.slug}
              </span>
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  node.isActive
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                    : "bg-amber-50 text-amber-800 border border-amber-200"
                }`}
              >
                {node.isActive ? "نشط" : "معطل"}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                الترتيب: {node.sortOrder}
              </span>
            </div>
            {node.description && (
              <p className="text-xs text-slate-500 truncate max-w-md">
                {node.description}
              </p>
            )}
          </div>
        </div>

        {/* Node Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onAddChild(node.id)}
            className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
            title="إضافة تصنيف فرعي"
          >
            + فرع
          </button>
          <button
            type="button"
            onClick={() => onEdit(node)}
            className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors"
          >
            تعديل
          </button>
          <button
            type="button"
            onClick={() => onDelete(node)}
            className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors"
          >
            حذف
          </button>
        </div>
      </div>

      {/* Render children recursively if expanded */}
      {hasChildren && expanded && (
        <div className="divide-y divide-slate-100 bg-slate-50/40">
          {node.children.map((child) => (
            <CategoryNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

