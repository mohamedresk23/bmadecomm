"use client";

import { useEffect, useRef, useState } from "react";
import { ApiClient, ClientApiError } from "../../../../../shared/api/client";
import { ProductDto } from "../../../../../modules/catalog/products/contracts/product";
import { PublicationReadinessDto, PublicationReadinessCode } from "../../../../../modules/catalog/products/contracts/publication-readiness";

type Props = { product: ProductDto | null; csrf: string; revision: number; dirty: boolean; blocked: boolean; onBusyChange: (busy: boolean) => void; onTransition: (product: ProductDto, csrf: string) => void };
const labels: Record<string, string> = { MISSING_NAME: "أدخل اسم المنتج", MISSING_DESCRIPTION: "أدخل وصف المنتج", INVALID_SLUG: "صحح رابط المنتج", SLUG_CONFLICT: "الرابط مستخدم، اختر رابطاً آخر", MISSING_VARIANTS: "أضف متغيراً نشطاً", MISSING_SKU: "أدخل رمز SKU", INVALID_PRICE: "أدخل سعراً موجباً", MISSING_IMAGES: "أضف صورة للمنتج", MISSING_ALT_TEXT: "أدخل النص البديل للصورة", MISSING_CATEGORIES: "اختر تصنيفاً" };
export function ProductPublication({ product, revision, dirty, blocked, onBusyChange, onTransition }: Props) {
  const [assessment, setAssessment] = useState<{ id: string; revision: number; value: PublicationReadinessDto } | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [mutating, setMutating] = useState(false);
  const mutation = useRef(false);
  const request = useRef(0);
  const id = product?.id;
  const status = product?.status;
  useEffect(() => {
    const sequence = ++request.current;
    if (!id || status !== "draft") return;
    const controller = new AbortController();
    void ApiClient.fetch<PublicationReadinessDto>(`/api/catalog/products/${encodeURIComponent(id)}/readiness`, { cache: "no-store", signal: controller.signal })
      .then(value => { if (typeof value.isReady !== "boolean" || !Array.isArray(value.issues)) throw new Error("Invalid readiness response"); if (sequence === request.current && !controller.signal.aborted) { setAssessment({ id, revision, value }); setError(""); setExpired(false); } })
      .catch(err => { if (sequence === request.current && !controller.signal.aborted) { setAssessment(null); setError("تعذر فحص جاهزية النشر. أعد المحاولة."); setExpired(err instanceof ClientApiError && err.status === 401); } })
      .finally(() => { if (sequence === request.current && !controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
  }, [id, status, revision, retry]);
  const current = assessment?.id === id && assessment?.revision === revision ? assessment.value : null;
  const canPublish = status === "draft" && current?.isReady === true;
  const unavailable = blocked || dirty || mutating || (status === "draft" && (!canPublish || loading));
  async function transition() {
    if (!product || unavailable || mutation.current) return;
    const action = status === "published" ? "unpublish" : "publish";
    if (!window.confirm(action === "publish" ? "هل تريد نشر هذا المنتج؟" : "هل تريد إلغاء نشر هذا المنتج؟")) return;
    mutation.current = true; setMutating(true); onBusyChange(true); setError("");
    request.current++;
    try {
      const session = await ApiClient.fetch<{ csrf: string }>(`/api/v1/admin/catalog/products/${encodeURIComponent(product.id)}`, { cache: "no-store" });
      const response = await ApiClient.fetch<{ product: ProductDto; csrf: string }>(`/api/catalog/products/${encodeURIComponent(product.id)}/${action}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf }, body: "{}" });
      setAssessment(null); onTransition(response.product, response.csrf); setExpired(false);
    } catch (err) {
      if (err instanceof ClientApiError && err.code === "PUBLICATION_READINESS_FAILED") {
        setAssessment({ id: product.id, revision, value: { isReady: false, issues: (err.details ?? []).map(issue => ({ ...issue, code: (issue as { code?: string }).code as PublicationReadinessCode })) } });
      }
      setExpired(err instanceof ClientApiError && err.status === 401);
      setError("تعذر تغيير حالة النشر. راجع المتطلبات ثم أعد المحاولة؛ بياناتك محفوظة.");
    } finally { mutation.current = false; setMutating(false); onBusyChange(false); }
  }
  function focus(field: string) {
    const [group, persistedId, control] = field.split(".");
    const target = group === "gallery" ? (persistedId ? `alt-text-${persistedId}` : "product-gallery") : group === "variants" ? (persistedId ? `variant-${persistedId}-${control}` : "product-variants") : `product-${group}`;
    const element = document.getElementById(target) ?? document.getElementById(`product-${group}`);
    element?.scrollIntoView?.({ block: "center", behavior: "smooth" }); element?.focus();
  }
  if (!product) return <section className="rounded-xl border p-5"><p>احفظ المنتج أولاً لفحص متطلبات النشر.</p></section>;
  const groups = ["name", "description", "slug", "categoryIds", "variants", "gallery"];
  return <section dir="rtl" className="space-y-3 rounded-xl border p-5" aria-label="نشر المنتج" aria-busy={mutating || (status === "draft" && !current && !error)}>
    <h2 className="font-bold">حالة المنتج: {status === "published" ? "منشور" : "مسودة"}</h2>
    {status === "draft" && !current && !error && <p role="status">جارٍ فحص جاهزية النشر…</p>}
    {error && <div role="alert"><p>{error}</p>{expired && <a href="/admin/login" target="_blank" rel="noreferrer">سجل الدخول ثم أعد المحاولة</a>}<button type="button" className="underline" disabled={mutating || blocked} onClick={() => { setLoading(true); setAssessment(null); setError(""); setRetry(value => value + 1); }}>إعادة فحص الجاهزية</button></div>}
    {status === "draft" && current && <div>{current.isReady ? <p>المنتج جاهز للنشر.</p> : groups.map(group => {
      const issues = current.issues.filter(issue => issue.field.split(".")[0] === group);
      return issues.length ? <ul key={group} className="list-inside list-disc">{issues.map((issue, index) => <li key={`${issue.field}-${index}`}><button type="button" className="min-h-11 underline focus-visible:outline-2" disabled={mutating || blocked} onClick={() => focus(issue.field)}>{labels[issue.code] ?? issue.message}</button></li>)}</ul> : null;
    })}</div>}
    {dirty && <p>احفظ تغييرات المنتج والصور قبل تغيير حالة النشر.</p>}
    <button type="button" disabled={unavailable} className="min-h-11 rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => void transition()}>{mutating ? "جارٍ التنفيذ…" : status === "published" ? "إلغاء النشر" : "نشر المنتج"}</button>
  </section>;
}
