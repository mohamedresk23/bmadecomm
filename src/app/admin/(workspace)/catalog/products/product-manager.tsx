"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiClient, ClientApiError } from "../../../../../shared/api/client";
import { combinationKey, decimalToMinor, generateVariantMatrix, minorToDecimal, slugSchema, ProductDto } from "../../../../../modules/catalog/products/contracts/product";
import { GalleryDto } from "../../../../../modules/catalog/products/contracts/gallery";
import { ProductPublication } from "./product-publication";
import { ProductGallery } from "./product-gallery";

type FormVariant = { id?: string; sku: string; price: string; comparePrice: string; attributes: Record<string, string> };
type Pricing = { currency: string; currencyScale: number; pricingRevision: string };
type Collection = { products: ProductDto[]; csrf: string; metadata: Pricing & { categories: { id: string; name: string }[] } };
const formSignature = (name: string, description: string, categoryIds: string[], rows: FormVariant[], dimensions: string, slug = "", metaTitle = "", metaDescription = "") => JSON.stringify({ name, description, categoryIds, rows, dimensions, slug, metaTitle, metaDescription });
const emptyVariant = (): FormVariant => ({ sku: "", price: "", comparePrice: "", attributes: {} });
const endpoint = "/api/v1/admin/catalog/products";
const inputStyle = "mt-1.5 block min-h-11 w-full rounded-lg border border-slate-300 bg-white p-2.5 focus-visible:outline-2 focus-visible:outline-blue-700";
const buttonStyle = "min-h-11 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";
function fieldLabel(field: string) {
  const labels: Record<string, string> = { slug: "الرابط", metaTitle: "عنوان محركات البحث", metaDescription: "وصف محركات البحث", name: "اسم المنتج", description: "الوصف", categoryIds: "التصنيفات", variants: "المتغيرات", pricingRevision: "سياق الأسعار", sku: "SKU", priceMinor: "السعر", comparePriceMinor: "سعر المقارنة", attributes: "الأبعاد", id: "المتغير" };
  const variant = /^variants\.(\d+)\.([^.]+)/.exec(field);
  if (variant) return `متغير ${Number(variant[1]) + 1} — ${labels[variant[2]] ?? "بيانات المتغير"}`;
  return labels[field.split(".")[0]] ?? "";
}
function productMessage(message: string): string {
  const translations: Record<string, string> = {
    "Name is required": "اسم المنتج مطلوب.", "Invalid name": "اسم المنتج يحتوي على أحرف غير صالحة.",
    "Invalid description": "الوصف يحتوي على أحرف غير صالحة.", "Invalid identifier": "المعرّف غير صالح.",
    "Invalid attribute": "اسم البُعد أو قيمته غير صالح.", "Select at least one category": "اختر تصنيفاً واحداً على الأقل.",
    "Category IDs must be unique": "اختر كل تصنيف مرة واحدة.", "Select existing categories": "اختر تصنيفات موجودة.",
    "Unknown category": "التصنيف غير موجود.", "Validation failed": "صحح البيانات المشار إليها.",
    "Amount must be a nonnegative integer string": "أدخل مبلغاً صحيحاً غير سالب.", "Amount is too large": "المبلغ أكبر من الحد المسموح.",
    "Invalid currency scale": "عدد المنازل العشرية للعملة غير صالح.", "SKU already in use": "رمز SKU مستخدم بالفعل.",
    "SKU must contain 1–64 letters, digits, dots, underscores or hyphens": "أدخل رمز SKU من 1 إلى 64 حرفاً إنجليزياً أو رقماً أو نقطة أو شرطة أو شرطة سفلية.",
    "Duplicate attribute combination": "يوجد متغير آخر بنفس مجموعة الأبعاد.", "All variants must use the same dimensions": "يجب أن تستخدم جميع المتغيرات الأبعاد نفسها.",
    "Compare price must be at least regular price": "يجب ألا يقل سعر المقارنة عن السعر العادي.", "Variant IDs must be unique": "لا يمكن تكرار المتغير نفسه.",
    "Invalid variant ID": "المتغير غير صالح.", "Variant does not belong to this draft": "المتغير لا ينتمي إلى هذه المسودة.",
    "At most four dimensions are allowed": "يمكن إضافة أربعة أبعاد كحد أقصى.", "At most 100 variants are allowed": "يمكن إضافة 100 متغير كحد أقصى.",
    "Use unique dimensions and values": "استخدم أسماء أبعاد وقيم غير مكررة.",
    "Attribute names and values must be unique, nonempty and at most 60 characters": "يجب أن تكون أسماء الأبعاد وقيمها غير مكررة وغير فارغة وألا تتجاوز 60 حرفاً.",
    "Attribute names cannot contain a colon or be __proto__": "لا يمكن أن يتضمن اسم البُعد نقطتين رأسيتين أو أن يكون __proto__.",
    "Attribute values cannot contain a comma": "لا يمكن أن تتضمن قيمة البُعد فاصلة إنجليزية.",
    "Pricing revision required": "حدّث بيانات العملة قبل الحفظ.", "Review prices using the current store currency and scale": "راجع الأسعار وفق عملة المتجر ومنازلها العشرية الحالية.",
    "Pricing context changed. Refresh settings and review prices before saving.": "تغيرت عملة المتجر أو منازلها العشرية. حدّث البيانات وراجع الأسعار قبل الحفظ.",
    "Only drafts can be edited": "يمكن تعديل المسودات فقط.", "Product not found": "المنتج غير موجود.",
  };
  const decimal = /^Enter a nonnegative price with at most (\d+) decimal places$/.exec(message);
  if (decimal) return `أدخل سعراً غير سالب لا يتجاوز ${decimal[1]} منازل عشرية.`;
  if (/^Too (big|small):/.test(message)) return "القيمة أو عدد العناصر خارج الحدود المسموح بها.";
  if (/^Invalid input:/.test(message)) return "نوع البيانات غير صالح.";
  if (/^Unrecognized key/.test(message)) return "توجد حقول غير مسموح بها.";
  return translations[message] ?? message;
}

export function ProductManager() {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [id, setId] = useState<string>();
  const [selected, setSelected] = useState<ProductDto | null>(null);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [assessmentRevision, setAssessmentRevision] = useState(0);
  const [slug, setSlug] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [rows, setRows] = useState<FormVariant[]>([emptyVariant()]);
  const [dimensionText, setDimensionText] = useState("");
  const [appliedDimensions, setAppliedDimensions] = useState("");
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [pricesNeedReview, setPricesNeedReview] = useState(false);
  const [persistedVariants, setPersistedVariants] = useState<ProductDto["variants"]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [gallery, setGallery] = useState<GalleryDto | null>(null);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [isGalleryDirty, setIsGalleryDirty] = useState(false);
  const [cleanForm, setCleanForm] = useState(formSignature("", "", [], [emptyVariant()], ""));
  const pendingCreate = useRef<{ payload: string; key: string } | null>(null);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");
  const [expired, setExpired] = useState(false);

  const reportError = useCallback((err: unknown) => {
    const sessionExpired = err instanceof ClientApiError && err.status === 401;
    setExpired(sessionExpired);
    const issues = err && typeof err === "object" && "issues" in err && Array.isArray(err.issues) ? err.issues as { message: string }[] : null;
    setError(sessionExpired ? "انتهت الجلسة. سجل الدخول ثم أعد المحاولة؛ بياناتك محفوظة في النموذج." : issues ? issues.map(issue => productMessage(issue.message)).join(" ") : err instanceof Error ? productMessage(err.message) : "تعذر حفظ البيانات. أعد المحاولة.");
    setFields(Object.fromEntries(Object.entries(ApiClient.mapFieldErrors(err)).map(([field, message]) => [field, productMessage(message)])));
  }, []);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await ApiClient.fetch<Collection>(endpoint, { cache: "no-store" });
      setCollection(next);
      setPricesNeedReview(!!pricing && pricing.pricingRevision !== next.metadata.pricingRevision);
      if (!pricing) setPricing(next.metadata);
      setExpired(false);
      setError("");
    } catch (err) { reportError(err); }
    finally { setLoading(false); }
  }, [reportError, pricing]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void ApiClient.fetch<Collection>(endpoint, { cache: "no-store", signal: controller.signal })
      .then(response => { if (active) { setCollection(response); setPricing(response.metadata); } })
      .catch(err => { if (active) reportError(err); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [reportError]);

  function fill(product: ProductDto) {
    setSelected(product); setSlug(product.slug ?? ""); setMetaTitle(product.metaTitle ?? ""); setMetaDescription(product.metaDescription ?? "");
    setAssessmentRevision(value => value + 1);
    setPersistedVariants(product.variants);
    setId(product.id); setName(product.name); setDescription(product.description ?? ""); setCategoryIds(product.categoryIds);
    const loadedRows = product.variants.map(variant => ({ id: variant.id, sku: variant.sku, price: minorToDecimal(variant.priceMinor, variant.currencyScale), comparePrice: variant.comparePriceMinor == null ? "" : minorToDecimal(variant.comparePriceMinor, variant.currencyScale), attributes: variant.attributes }));
    setRows(loadedRows);
    const first = product.variants[0];
    if (first) {
      const loadedPricing = { currency: first.currency, currencyScale: first.currencyScale, pricingRevision: `${first.currency}:${first.currencyScale}` };
      setPricing(loadedPricing);
      setPricesNeedReview(loadedPricing.pricingRevision !== collection?.metadata.pricingRevision);
    }
    const dimensions = new Map<string, Set<string>>();
    product.variants.forEach(variant => Object.entries(variant.attributes).forEach(([name, value]) => {
      if (!dimensions.has(name)) dimensions.set(name, new Set());
      dimensions.get(name)!.add(value);
    }));
    const text = [...dimensions].map(([name, values]) => `${name}: ${[...values].join(", ")}`).join("\n");
    setDimensionText(text); setAppliedDimensions(text);
    setCleanForm(formSignature(product.name, product.description ?? "", product.categoryIds, loadedRows, text, product.slug ?? "", product.metaTitle ?? "", product.metaDescription ?? ""));
  }
  const galleryRequest = useRef(0);
  const loadGallery = useCallback(async (productId: string) => {
    const request = ++galleryRequest.current;
    setGallery(current => current?.productId === productId ? current : null);
    setGalleryLoading(true);
    setGalleryError(null);
    try {
      const res = await ApiClient.fetch<{ success: true; gallery: GalleryDto }>(
        `${endpoint}/${encodeURIComponent(productId)}/images`,
        { cache: "no-store" }
      );
      if (request === galleryRequest.current) setGallery(res.gallery);
    } catch {
      if (request !== galleryRequest.current) return;
      setGalleryError("تعذر تحميل صور المنتج. أعد المحاولة.");
    } finally {
      if (request === galleryRequest.current) setGalleryLoading(false);
    }
  }, []);

  function canReplace() {
    const isFormClean = cleanForm === formSignature(name, description, categoryIds, rows, dimensionText, slug, metaTitle, metaDescription);
    return (isFormClean && !isGalleryDirty) || window.confirm("لديك تغييرات غير محفوظة. هل تريد استبدالها؟");
  }
  async function edit(productId: string) {
    if (busy.current || publicationBusy || galleryBusy || !canReplace()) return;
    setIsGalleryDirty(false);
    busy.current = true; setLoading(true); setError(""); setFields({}); setSuccess("");
    try {
      const response = await ApiClient.fetch<{ product: ProductDto; csrf: string }>(`${endpoint}/${encodeURIComponent(productId)}`, { cache: "no-store" });
      fill(response.product);
      setCollection(current => current ? { ...current, csrf: response.csrf } : current);
      void loadGallery(productId);
    } catch (err) { reportError(err); }
    finally { busy.current = false; setLoading(false); }
  }
  function reset() {
    if (busy.current || publicationBusy || galleryBusy || !canReplace()) return;
    setSelected(null); setSlug(""); setMetaTitle(""); setMetaDescription("");
    setIsGalleryDirty(false);
    setId(undefined); setName(""); setDescription(""); setCategoryIds([]); setRows([emptyVariant()]); setDimensionText(""); setError(""); setFields({}); setSuccess("");
    setAppliedDimensions(""); setPricing(collection?.metadata ?? null); setPricesNeedReview(false);
    galleryRequest.current++;
    setGallery(null); setGalleryError(null); setGalleryLoading(false);
    setCleanForm(formSignature("", "", [], [emptyVariant()], "")); pendingCreate.current = null;
  }
  function generate() {
    try {
      const dimensions = dimensionText.trim() ? dimensionText.trim().split("\n").map(line => {
        const colon = line.indexOf(":");
        if (colon < 1) throw new Error("اكتب كل بُعد بصيغة الاسم: قيمة، قيمة (استخدم فاصلة ,)");
        return { name: line.slice(0, colon), values: line.slice(colon + 1).split(",") };
      }) : [];
      const matrix = generateVariantMatrix(dimensions);
      const existing = new Map(rows.map(row => [combinationKey(row.attributes), row]));
      const keys = new Set(matrix.map(combinationKey));
      if (rows.some(row => !keys.has(combinationKey(row.attributes)) && (row.id || row.sku || row.price || row.comparePrice)) && !window.confirm("سيؤدي التوليد إلى حذف صفوف تحتوي على بيانات. هل تريد المتابعة؟")) return;
      setRows(matrix.map(attributes => ({ ...(existing.get(combinationKey(attributes)) ?? emptyVariant()), attributes })));
      setAppliedDimensions(dimensionText);
      setError(""); setFields({}); setSuccess("");
    } catch (err) { reportError(err); }
  }
  function changeRow(index: number, key: "sku" | "price" | "comparePrice", value: string) {
    setRows(current => current.map((row, position) => position === index ? { ...row, [key]: value } : row));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy.current || publicationBusy || galleryBusy || !collection || !pricing) return;
    if (dimensionText !== appliedDimensions) { setError("طبّق تغييرات الأبعاد بزر توليد المتغيرات قبل الحفظ."); return; }
    if (pricesNeedReview || pricing.pricingRevision !== collection.metadata.pricingRevision) { setError("راجع الأسعار بالعملة الجديدة قبل الحفظ."); return; }
    busy.current = true; setSaving(true); setError(""); setFields({}); setSuccess("");
    try {
      const decimalErrors: Record<string, string> = {};
      const variants = rows.map((row, index) => {
        let priceMinor = "0", comparePriceMinor: string | null = null;
        try { priceMinor = decimalToMinor(row.price, pricing.currencyScale); }
        catch (err) { decimalErrors[`variants.${index}.priceMinor`] = productMessage((err as Error).message); }
        if (row.comparePrice.trim()) {
          try { comparePriceMinor = decimalToMinor(row.comparePrice, pricing.currencyScale); }
          catch (err) { decimalErrors[`variants.${index}.comparePriceMinor`] = productMessage((err as Error).message); }
        }
        return { ...(id && row.id ? { id: row.id } : {}), sku: row.sku, priceMinor, comparePriceMinor, attributes: row.attributes };
      });
      if (Object.keys(decimalErrors).length) { setFields(decimalErrors); setError("صحح الأسعار المشار إليها."); return; }
      const metadataErrors: Record<string, string> = {};
      if ((id || slug.trim()) && !slugSchema.safeParse(slug).success) metadataErrors.slug = "أدخل رابطاً صالحاً حتى 255 حرفاً.";
      if (metaTitle.trim().length > 70) metadataErrors.metaTitle = "العنوان لا يتجاوز 70 حرفاً.";
      if (metaDescription.trim().length > 160) metadataErrors.metaDescription = "الوصف لا يتجاوز 160 حرفاً.";
      if (Object.keys(metadataErrors).length) { setFields(metadataErrors); setError("صحح بيانات الرابط ومحركات البحث."); return; }
      const body = JSON.stringify({ name, description, categoryIds, variants, ...((id || slug.trim()) ? { slug: slug.trim().toLowerCase() } : {}), metaTitle: metaTitle.trim() || null, metaDescription: metaDescription.trim() || null });
      const fingerprint = JSON.stringify({ body, revision: pricing.pricingRevision });
      if (!id && pendingCreate.current?.payload !== fingerprint) pendingCreate.current = { payload: fingerprint, key: crypto.randomUUID() };
      const response = await ApiClient.fetch<{ product: ProductDto }>(id ? `${endpoint}/${encodeURIComponent(id)}` : endpoint, {
        method: id ? "PUT" : "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": collection.csrf, "X-Pricing-Revision": pricing.pricingRevision, ...(!id ? { "Idempotency-Key": pendingCreate.current!.key } : {}) },
        body,
      });
      pendingCreate.current = null;
      fill(response.product);
      await loadGallery(response.product.id);
      setCollection(current => current ? { ...current, products: [...current.products.filter(product => product.id !== response.product.id), response.product] } : current);
      setSuccess("تم حفظ المسودة بنجاح."); setExpired(false);
    } catch (err) { reportError(err); }
    finally { busy.current = false; setSaving(false); }
  }
  function feedback(field: string) {
    return fields[field] ? <span id={`error-${field}`} className="block text-sm text-rose-700">{fields[field]}</span> : null;
  }
  function accessible(field: string) { return { "aria-invalid": !!fields[field], "aria-describedby": [fields[field] ? `error-${field}` : "", /PriceMinor$|priceMinor$/.test(field) ? "price-help" : ""].filter(Boolean).join(" ") || undefined }; }
  return <section className="space-y-6" aria-busy={loading || saving}>
    {loading && <p role="status">جارٍ تحميل المنتجات…</p>}
    {error && <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4"><p>{error}</p>
      {Object.keys(fields).length > 0 && <ul aria-label="تفاصيل أخطاء الحفظ">{Object.entries(fields).map(([field, message]) => <li key={field}>{fieldLabel(field) && `${fieldLabel(field)}: `}{message}</li>)}</ul>}{expired && <a className="underline" href="/admin/login" target="_blank" rel="noreferrer">تسجيل الدخول</a>}
      <button type="button" className="mr-3 underline" disabled={saving || loading || galleryBusy || publicationBusy} onClick={() => void reload()}>إعادة تحميل البيانات</button>
    </div>}
    {success && <p role="status" className="rounded-lg bg-green-50 p-4 text-green-800">{success}</p>}
    {collection && <>
      <div className="rounded-2xl border border-slate-300 bg-white p-5 sm:p-6 shadow-xs">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-bold">المنتجات</h2><p className="mt-1 text-sm text-slate-600">{collection.products.length} منتجات — اختر منتجًا لتعديله أو أضف مسودة جديدة.</p></div>
          <button type="button" className={buttonStyle} disabled={saving || loading || galleryBusy || publicationBusy} onClick={reset}>منتج جديد</button>
        </div>
        {!collection.products.length && <p role="status" className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">لا توجد منتجات بعد.</p>}
        <ul className="divide-y divide-slate-200">{collection.products.map(product => <li key={product.id} className="admin-product-list-item flex items-center justify-between py-4"><span className="font-semibold">{product.name}<span className="ms-2 inline-block rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">{product.status === "published" ? "منشور" : "مسودة"}</span></span><button type="button" disabled={saving || loading || galleryBusy || publicationBusy} className={buttonStyle} onClick={() => void edit(product.id)}>تعديل {product.name}</button></li>)}</ul>
      </div>
      <form onSubmit={save} className="rounded-2xl border border-slate-300 bg-white p-5 sm:p-6 shadow-xs"><fieldset disabled={saving || loading || galleryBusy || publicationBusy} className="space-y-5">
        <legend className="text-lg font-bold">{id ? selected?.status === "published" ? "تعديل المنتج المنشور" : "تعديل المسودة" : "إنشاء مسودة"}</legend>
        <label className="block">اسم المنتج<input id="product-name" aria-label="اسم المنتج" className={inputStyle} value={name} onChange={event => setName(event.target.value)} maxLength={200} {...accessible("name")} />{feedback("name")}</label>
        <label className="block">الوصف<textarea id="product-description" aria-label="الوصف" className={inputStyle} value={description} onChange={event => setDescription(event.target.value)} maxLength={5000} {...accessible("description")} />{feedback("description")}</label>
        <label className="block">الرابط (Slug)<input id="product-slug" aria-label="الرابط (Slug)" dir="ltr" className={inputStyle} value={slug} onChange={event => setSlug(event.target.value)} {...accessible("slug")} />{feedback("slug")}</label>
        <p className="text-sm">أحرف إنجليزية وأرقام وشرطات منفردة، بحد أقصى 255 حرفاً. اتركه فارغاً للإنشاء التلقائي عند إنشاء المنتج.</p>
        {selected?.status === "published" && <p>تغيير رابط المنتج المنشور يحفظ العنوان السابق عبر إعادة توجيه.</p>}
        <label className="block">عنوان محركات البحث<input id="product-metaTitle" aria-label="عنوان محركات البحث" className={inputStyle} value={metaTitle} onChange={event => setMetaTitle(event.target.value)} {...accessible("metaTitle")} /><span>{metaTitle.length}/70</span>{feedback("metaTitle")}</label>
        <label className="block">وصف محركات البحث<textarea id="product-metaDescription" aria-label="وصف محركات البحث" className={inputStyle} value={metaDescription} onChange={event => setMetaDescription(event.target.value)} {...accessible("metaDescription")} /><span>{metaDescription.length}/160</span>{feedback("metaDescription")}</label>
        <p className="text-sm">الحقول الفارغة تلغي التخصيص وتستخدم اسم المنتج ووصفه تلقائياً.</p>
        <fieldset id="product-categoryIds" tabIndex={-1} aria-describedby={fields.categoryIds ? "error-categoryIds" : undefined}><legend>التصنيفات</legend>
          {!collection.metadata.categories.length && <p>أضف تصنيفاً أولاً من صفحة التصنيفات.</p>}
          {collection.metadata.categories.map(category => <label className="mr-4 inline-flex gap-2" key={category.id}><input type="checkbox" checked={categoryIds.includes(category.id)} onChange={event => setCategoryIds(current => event.target.checked ? [...current, category.id] : current.filter(value => value !== category.id))} />{category.name}</label>)}{feedback("categoryIds")}
        </fieldset>
        <div id="product-variants" tabIndex={-1}><label className="block">أبعاد المتغيرات<textarea className={inputStyle} dir="auto" value={dimensionText} onChange={event => setDimensionText(event.target.value)} aria-describedby="dimension-help" /></label>
          <p id="dimension-help" className="text-sm text-slate-600">كل بُعد في سطر مثل اللون: أحمر, أزرق. اتركه فارغاً لمنتج بسيط. التوليد يحتفظ بالصفوف المطابقة.</p>
          <button type="button" className={`${buttonStyle} mt-2`} onClick={generate}>توليد المتغيرات</button>
        </div>
        <p>العملة: {pricing?.currency} — {pricing?.currencyScale} منازل عشرية</p>
        {pricesNeedReview && <div role="alert" className="rounded-lg border p-3">
          <p>تغير سياق الأسعار من {pricing?.currency} ({pricing?.currencyScale}) إلى {collection.metadata.currency} ({collection.metadata.currencyScale}). راجع جميع الأسعار قبل الحفظ؛ ستبقى الأرقام المدخلة كما هي.</p>
          <button type="button" className={buttonStyle} onClick={() => { setPricing(collection.metadata); setPricesNeedReview(false); }}>راجعت الأسعار وأوافق على العملة الجديدة</button>
          <button type="button" className="mr-3 underline" disabled={saving || loading || galleryBusy || publicationBusy} onClick={() => void reload()}>إعادة تحميل البيانات</button>
        </div>}
        <p id="price-help" className="text-sm text-slate-600">استخدم الأرقام 0–9 والنقطة العشرية . لإدخال الأسعار، مثل 19.99.</p>
        {dimensionText !== appliedDimensions && <p role="status">طبّق تغييرات الأبعاد بزر توليد المتغيرات قبل الحفظ.</p>}
        <div className="space-y-4">{rows.map((row, index) => <fieldset key={row.id ?? combinationKey(row.attributes)} className="grid gap-4 rounded-xl border border-slate-300 bg-slate-50 p-4 sm:grid-cols-3">
          <legend>متغير {index + 1}: {Object.entries(row.attributes).map(([name, value]) => `${name}: ${value}`).join(" / ") || "افتراضي"}</legend>
          <label>SKU {index + 1}<input id={`variant-${row.id ?? index}-sku`} aria-label={`SKU ${index + 1}`} dir="ltr" className={inputStyle} value={row.sku} onChange={event => changeRow(index, "sku", event.target.value)} {...accessible(`variants.${index}.sku`)} />{feedback(`variants.${index}.sku`)}</label>
          <label>السعر {index + 1}<input id={`variant-${row.id ?? index}-priceMinor`} aria-label={`السعر ${index + 1}`} dir="ltr" inputMode="decimal" className={inputStyle} value={row.price} onChange={event => changeRow(index, "price", event.target.value)} {...accessible(`variants.${index}.priceMinor`)} />{feedback(`variants.${index}.priceMinor`)}</label>
          <label>سعر المقارنة {index + 1}<input aria-label={`سعر المقارنة ${index + 1}`} dir="ltr" inputMode="decimal" className={inputStyle} value={row.comparePrice} onChange={event => changeRow(index, "comparePrice", event.target.value)} {...accessible(`variants.${index}.comparePriceMinor`)} />{feedback(`variants.${index}.comparePriceMinor`)}</label>
          {feedback(`variants.${index}.attributes`)}{feedback(`variants.${index}.id`)}
        </fieldset>)}</div>
        <button className={`${buttonStyle} admin-primary-action w-full sm:w-auto`} type="submit" disabled={saving || loading || galleryBusy || publicationBusy || pricesNeedReview || dimensionText !== appliedDimensions}>{saving ? "جارٍ الحفظ…" : selected?.status === "published" ? "حفظ المنتج" : "حفظ المسودة"}</button>
      </fieldset></form>
      <ProductPublication key={id ?? "new"} product={selected} csrf={collection.csrf} revision={assessmentRevision} dirty={cleanForm !== formSignature(name, description, categoryIds, rows, dimensionText, slug, metaTitle, metaDescription) || isGalleryDirty} blocked={saving || loading || galleryBusy || galleryLoading || !!galleryError} onBusyChange={setPublicationBusy} onTransition={(product, csrf) => {
        fill(product);
        setCollection(current => current ? { ...current, csrf, products: current.products.map(item => item.id === product.id ? product : item) } : current);
      }} />
      <div id="product-gallery" tabIndex={-1}>
      <ProductGallery
        productId={id}
        variants={persistedVariants}
        productSaving={saving || publicationBusy}
        onBusyChange={setGalleryBusy}
        gallery={gallery}
        loading={galleryLoading || loading}
        error={galleryError}
        onRetry={() => { if (id) void loadGallery(id); }}
        csrf={collection?.csrf}
        onUploadSuccess={(updated) => { setGallery(updated); setAssessmentRevision(value => value + 1); }}
        onGalleryUpdate={(updated) => { setGallery(updated); setAssessmentRevision(value => value + 1); }}
        onDirtyChange={setIsGalleryDirty}
      />
      </div>
    </>}
  </section>;
}
