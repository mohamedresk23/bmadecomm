"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GalleryDto, GalleryImageDto } from "../../../../../modules/catalog/products/contracts/gallery";

interface ProductGalleryProps {
  productId?: string;
  readOnly?: boolean;
  variants?: { id: string; sku: string; attributes: Record<string, string> }[];
  productSaving?: boolean;
  onBusyChange?: (busy: boolean) => void;
  gallery: GalleryDto | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  csrf?: string;
  onUploadSuccess?: (gallery: GalleryDto) => void;
  onGalleryUpdate?: (gallery: GalleryDto) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

export function ProductGallery(props: ProductGalleryProps) {
  return <ProductGalleryState key={props.productId ?? "unsaved"} {...props} />;
}

function ProductGalleryState({
  productId,
  readOnly = false,
  gallery: incomingGallery,
  variants = [],
  productSaving = false,
  onBusyChange,
  loading: incomingLoading,
  error,
  onRetry,
  csrf,
  onUploadSuccess,
  onGalleryUpdate,
  onDirtyChange,
}: ProductGalleryProps) {
  const loading = incomingLoading || productSaving;
  const [gallery, setGallery] = useState(incomingGallery?.productId === productId ? incomingGallery : null);
  const [localMappings, setLocalMappings] = useState<Record<string, string> | null>(null);
  const mappings = localMappings ?? Object.fromEntries((gallery?.variantImages ?? []).map(item => [item.variantId, item.imageId]));
  const [discardOnRefresh, setDiscardOnRefresh] = useState(false);
  const [seenGallery, setSeenGallery] = useState(incomingGallery);
  const variantIdentity = JSON.stringify(variants.map(variant => variant.id).sort());
  const [seenVariants, setSeenVariants] = useState(variantIdentity);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const uploadController = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => { uploadController.current?.abort(); }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const announcementSequence = useRef(0);
  const moveButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const removeButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const pendingFocus = useRef<string | null>(null);
  const pendingFocusAfterRemove = useRef<string | null>(null);
  const orderedImages = localOrder
    ? localOrder.flatMap(id => gallery?.images.find(image => image.id === id) ?? [])
    : gallery?.images ?? [];
  useLayoutEffect(() => {
    if (pendingFocus.current) {
      moveButtons.current[pendingFocus.current]?.focus();
      pendingFocus.current = null;
    }
    if (pendingFocusAfterRemove.current) {
      if (pendingFocusAfterRemove.current === "upload-input") {
        fileInputRef.current?.focus();
      } else {
        removeButtons.current[pendingFocusAfterRemove.current]?.focus();
      }
      pendingFocusAfterRemove.current = null;
    }
  });

  // Image removal state
  const [removingImageId, setRemovingImageId] = useState<string | null>(null);
  const [confirmRemoveImageId, setConfirmRemoveImageId] = useState<string | null>(null);

  // Alt text editing and dirty tracking
  const [localAltTexts, setLocalAltTexts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const orderDirty = orderedImages.some((image, index) => image.id !== gallery?.images[index]?.id);
  const mappingDirty = JSON.stringify(Object.entries(mappings).filter(([,image]) => image).sort()) !== JSON.stringify((gallery?.variantImages ?? []).map(item => [item.variantId, item.imageId]).sort());
  const isDirty = mappingDirty || orderDirty || ((gallery?.images.some((img) => {
    const local = localAltTexts[img.id];
    return local !== undefined && local.trim() !== img.altText.trim();
  })) ?? false);

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => {
      onDirtyChange?.(false);
    };
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(saving || uploading || !!removingImageId);
    return () => onBusyChange?.(false);
  }, [saving, uploading, removingImageId, onBusyChange]);


  // Keep the reviewed snapshot until a successful explicit discard or save.
  // A null/failed refresh must never erase local work.
  if (incomingGallery?.productId === productId && incomingGallery && (incomingGallery !== seenGallery || variantIdentity !== seenVariants)) {
    setSeenGallery(incomingGallery);
    setSeenVariants(variantIdentity);
    if (isDirty && !discardOnRefresh) {
      if (incomingGallery.revision !== gallery?.revision || Object.entries(mappings).some(([variantId, imageId]) => imageId && !variants.some(variant => variant.id === variantId))) {
        setIsStale(true);
        const cleared = (gallery?.variantImages ?? []).filter(mapping => !incomingGallery.variantImages.some(item => item.variantId === mapping.variantId)).length;
        setSaveError(`تغيرت تعيينات الصور.${cleared ? ` تم مسح ${cleared} من تعيينات المتغيرات؛ تستخدم الصورة الرئيسية الآن.` : ""} احتفظنا بتعديلاتك؛ أعد التحميل للتجاهل والمراجعة.`);
      }
    } else {
      const cleared = (gallery?.variantImages ?? []).filter(mapping => !incomingGallery.variantImages.some(item => item.variantId === mapping.variantId));
      setGallery(incomingGallery);
      setLocalOrder(null); setLocalAltTexts({}); setLocalMappings(null);
      setSaveError(null); setIsStale(false); setFieldErrors({});
      if (cleared.length) setSaveSuccess(`تم مسح ${cleared.length} من تعيينات صور المتغيرات. تستخدم الصورة الرئيسية الآن.`);
      setDiscardOnRefresh(false);
    }
  }

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);

  const handleImageError = (imageId: string) => {
    setFailedImages((prev) => ({ ...prev, [imageId]: true }));
  };

  const handleRetryImage = (imageId: string) => {
    setFailedImages((prev) => ({ ...prev, [imageId]: false }));
    setReloadKeys((prev) => ({ ...prev, [imageId]: (prev[imageId] || 0) + 1 }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly) return;
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    setUploadError(null);
    if (file) {
      const newKey = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `idemp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      setIdempotencyKey(newKey);
    } else {
      setIdempotencyKey(null);
    }
  };

  const executeUpload = async (fileToUpload: File, keyToUse: string) => {
    if (readOnly || !productId || loading || error || saving || gallery?.productId !== productId) return;
    const controller = new AbortController();
    uploadController.current = controller;
    let canRetry = true;
    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", fileToUpload);

    try {
      const headers: Record<string, string> = {
        "Idempotency-Key": keyToUse,
      };
      if (csrf) {
        headers["X-CSRF-Token"] = csrf;
      }

      const res = await fetch(`/api/v1/admin/catalog/products/${encodeURIComponent(productId)}/images`, {
        method: "POST",
        headers,
        body: formData,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      if (!res.ok) {
        canRetry = res.status >= 500 || res.status === 408 || res.status === 429;
        const data = await res.json().catch(() => null);
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After");
          throw new Error(
            `تم تجاوز الحد المسموح لعمليات الرفع (20 محاولة خلال 10 دقائق). يرجى الانتظار ${retryAfter || 60} ثانية.`
          );
        }
        if (res.status === 413) {
          throw new Error("حجم الملف يتجاوز الحد الأقصى المسموح (5 ميجابايت).");
        }
        if (res.status === 415) {
          throw new Error("صيغة الملف غير مدعومة. الصيغ المسموحة: JPEG و PNG و WebP.");
        }
        if (res.status === 422) {
          throw new Error(data?.error?.message || "Image validation failed. Choose a valid static image.");
        }
        if (res.status === 409) {
          canRetry = /already in progress|unable to acquire idempotency reservation/i.test(data?.error?.message ?? "");
          throw new Error(data?.error?.message || "تعارض في حالة المنتج أو مفتاح العملية.");
        }
        throw new Error(data?.error?.message || `فشل رفع الصورة (${res.status})`);
      }

      const data = await res.json();
      if (controller.signal.aborted) return;
      setGallery(data.gallery);
      setLocalMappings(null);
      setLocalOrder(null);
      setLocalAltTexts({});
      setSelectedFile(null);
      setIdempotencyKey(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      if (onGalleryUpdate && data.gallery) {
        onGalleryUpdate(data.gallery);
      } else if (onUploadSuccess && data.gallery) {
        onUploadSuccess(data.gallery);
      } else {
        onRetry();
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      setRetryable(canRetry);
      if (!canRetry) setIdempotencyKey(null);
      const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء الرفع";
      setUploadError(message);
    } finally {
      if (!controller.signal.aborted) setUploading(false);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || !selectedFile || !idempotencyKey || uploading || saving) return;
    if (isDirty) {
      const confirmed = window.confirm("سيؤدي رفع صورة جديدة إلى تجاهل ترتيب الصور والأوصاف وتعيينات صور المتغيرات غير المحفوظة عند نجاح الرفع. هل تريد المتابعة؟");
      if (!confirmed) return;
    }
    await executeUpload(selectedFile, idempotencyKey);
  };

  const handleRetryUpload = async () => {
    if (readOnly || !selectedFile || !idempotencyKey || uploading || saving) return;
    if (isDirty) {
      const confirmed = window.confirm("سيؤدي رفع صورة جديدة إلى تجاهل ترتيب الصور والأوصاف وتعيينات صور المتغيرات غير المحفوظة عند نجاح الرفع. هل تريد المتابعة؟");
      if (!confirmed) return;
    }
    await executeUpload(selectedFile, idempotencyKey);
  };

  const handleSaveGallery = async () => {
    if (readOnly || !productId || !gallery || !isDirty || saving || uploading || loading || error || isStale || gallery.productId !== productId) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    setIsStale(false);
    setFieldErrors({});

    const submittedMappings = Object.entries(mappings).filter(([, imageId]) => imageId).map(([variantId, imageId]) => ({ variantId, imageId }));
    const imagesPayload = orderedImages.map((img) => ({
      id: img.id,
      altText: localAltTexts[img.id] !== undefined ? localAltTexts[img.id] : img.altText,
    }));

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (csrf) {
        headers["X-CSRF-Token"] = csrf;
      }

      const res = await fetch(`/api/v1/admin/catalog/products/${encodeURIComponent(productId)}/images`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          expectedRevision: gallery.revision,
          images: imagesPayload,
          variantImages: submittedMappings,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 409) {
          if (data?.error?.code === "STALE_GALLERY") {
            setIsStale(true);
            throw new Error("تم تعديل المعرض من قبل مستخدم أو عملية أخرى. يرجى مراجعة المعرض وإعادة المحاولة.");
          }
          throw new Error(data?.error?.message || "تعارض في حالة المنتج.");
        }
        if (res.status === 422) {
          if (data?.error?.details && Array.isArray(data.error.details)) {
            const errors: Record<string, string> = {};
            for (const d of data.error.details) {
              if (d.field) {
                const mapping = /^variantImages\.(\d+)(?:\.|$)/.exec(d.field);
                const variantId = mapping ? submittedMappings[Number(mapping[1])]?.variantId : undefined;
                errors[variantId ? `variantImages.${variantId}` : d.field] = d.message;
              }
            }
            setFieldErrors(errors);
          }
          throw new Error(data?.error?.message || "يرجى تصحيح الأخطاء المشار إليها.");
        }
        if (res.status === 401) {
          throw new Error("انتهت الجلسة. سجل الدخول ثم أعد المحاولة؛ بياناتك محفوظة في النموذج.");
        }
        if (res.status >= 500) {
          throw new Error("حدث خطأ في الخادم أثناء حفظ المعرض. أعد المحاولة.");
        }
        throw new Error(data?.error?.message || `فشل حفظ المعرض (${res.status})`);
      }

      const data = await res.json();
      setGallery(data.gallery);
      setLocalMappings(null);
      setLocalAltTexts({});
      setLocalOrder(null);
      setFieldErrors({});
      setSaveError(null);
      setIsStale(false);
      setSaveSuccess("تم حفظ المعرض بنجاح.");

      if (onGalleryUpdate && data.gallery) {
        onGalleryUpdate(data.gallery);
      } else if (onUploadSuccess && data.gallery) {
        onUploadSuccess(data.gallery);
      } else {
        onRetry();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء حفظ المعرض";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleExecuteRemove = async (imageIdToRemove: string | null) => {
    if (readOnly || !productId || !gallery || !imageIdToRemove || !!removingImageId || saving || uploading || loading || !!error || gallery.productId !== productId) return;

    setRemovingImageId(imageIdToRemove);
    setSaveError(null);
    setSaveSuccess(null);
    setIsStale(false);

    const removedIndex = orderedImages.findIndex((img) => img.id === imageIdToRemove);
    const remainingAfter = orderedImages.filter((img) => img.id !== imageIdToRemove);
    let nextFocusId: string | null = null;
    if (remainingAfter.length === 0) {
      nextFocusId = "upload-input";
    } else {
      const nextIndex = Math.min(removedIndex, remainingAfter.length - 1);
      nextFocusId = remainingAfter[nextIndex]?.id ?? null;
    }

    const wasMapped = (gallery.variantImages ?? []).some((m) => m.imageId === imageIdToRemove);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (csrf) {
        headers["X-CSRF-Token"] = csrf;
      }

      const res = await fetch(`/api/v1/admin/catalog/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageIdToRemove)}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({
          expectedRevision: gallery.revision,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 409) {
          if (data?.error?.code === "STALE_GALLERY") {
            setIsStale(true);
            throw new Error("تم تعديل المعرض من قبل مستخدم أو عملية أخرى. يرجى مراجعة المعرض وإعادة المحاولة.");
          }
          throw new Error(data?.error?.message || "تعارض في حالة المنتج.");
        }
        if (res.status === 401) {
          throw new Error("انتهت الجلسة. سجل الدخول ثم أعد المحاولة؛ بياناتك محفوظة في النموذج.");
        }
        if (res.status >= 500) {
          throw new Error("حدث خطأ في الخادم أثناء إزالة الصورة. أعد المحاولة.");
        }
        throw new Error(data?.error?.message || `فشل إزالة الصورة (${res.status})`);
      }

      const data = await res.json();
      setGallery(data.gallery);
      setLocalMappings(null);
      setLocalAltTexts({});
      setLocalOrder(null);
      setFieldErrors({});
      setSaveError(null);
      setIsStale(false);
      setConfirmRemoveImageId(null);

      const announcement = `الإجراء ${++announcementSequence.current}: ` + (data.gallery.images.length === 0
        ? "تمت إزالة الصورة. لا توجد صور في المعرض الآن."
        : wasMapped
        ? "تمت إزالة الصورة وفك ارتباط المتغيرات بها؛ تستخدم الصورة الرئيسية الآن."
        : "تمت إزالة الصورة من المعرض بنجاح.");
      setMoveAnnouncement(announcement);
      setSaveSuccess(announcement);

      pendingFocusAfterRemove.current = nextFocusId;

      if (onGalleryUpdate && data.gallery) {
        onGalleryUpdate(data.gallery);
      } else if (onUploadSuccess && data.gallery) {
        onUploadSuccess(data.gallery);
      } else {
        onRetry();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء إزالة الصورة";
      setSaveError(message);
      setConfirmRemoveImageId(null);
      if (imageIdToRemove) {
        removeButtons.current[imageIdToRemove]?.focus();
      }
    } finally {
      setRemovingImageId(null);
    }
  };


  if (!productId) {
    return (
      <section className="rounded-2xl border border-slate-300 bg-white p-5 sm:p-6 shadow-xs">
        <h3 className="text-lg font-bold">معرض الصور</h3>
        <p className="mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          احفظ المسودة أولاً لإضافة واستعراض الصور.
        </p>
      </section>
    );
  }

  const activeImagesCount = gallery?.images?.length ?? 0;
  const isMaxCapacity = activeImagesCount >= 10;

  return (
    <section
      className="space-y-4 rounded-2xl border border-slate-300 bg-white p-5 sm:p-6 shadow-xs"
      aria-busy={loading || uploading || saving || !!removingImageId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold">معرض الصور</h3>
            {isDirty && (
              <span
                className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800"
                data-testid="gallery-dirty-badge"
              >
                تغييرات غير محفوظة
              </span>
            )}
          </div>
          {gallery && (
            <p className="text-xs text-slate-500">
              مراجعة المعرض: {gallery.revision} ({activeImagesCount} من 10 صور)
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSaveGallery}
            disabled={readOnly || !isDirty || isStale || saving || uploading || !!removingImageId || loading || !!error || gallery?.productId !== productId}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            data-testid="gallery-save-button"
          >
            {saving ? "جارٍ الحفظ…" : "حفظ المعرض"}
          </button>

          {isMaxCapacity ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              تم بلوغ الحد الأقصى (10 صور)
            </span>
          ) : (
            <form onSubmit={handleUploadSubmit} className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                disabled={readOnly || uploading || saving || !!removingImageId || loading || !!error || gallery?.productId !== productId}
                className="text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
                aria-label="اختر صورة للمنتج"
                data-testid="gallery-upload-input"
              />
              <button
                type="submit"
                disabled={readOnly || !selectedFile || !idempotencyKey || uploading || saving || !!removingImageId || loading || !!error || gallery?.productId !== productId}
                className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                data-testid="gallery-upload-button"
              >
                {uploading ? "جارٍ الرفع…" : "رفع الصورة"}
              </button>
            </form>
          )}
        </div>
      </div>

      {readOnly && <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700" data-testid="gallery-readonly-notice">معرض المنتج المنشور للعرض فقط. ألغِ النشر أولًا لتعديل الصور.</p>}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="gallery-move-status">{moveAnnouncement}</p>

      {saveSuccess && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800"
          data-testid="gallery-save-success"
        >
          <p>{saveSuccess}</p>
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800"
          data-testid="gallery-save-error"
        >
          <p>{saveError}</p>
          {isStale && (
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-blue-700 underline"
              onClick={() => {
                if (!window.confirm("سيؤدي إعادة التحميل إلى تجاهل ترتيب الصور والأوصاف وتعيينات صور المتغيرات غير المحفوظة. هل تريد المتابعة؟")) return;
                setDiscardOnRefresh(true);
                onRetry();
              }}
              data-testid="gallery-reload-button"
            >
              إعادة تحميل المعرض
            </button>
          )}
        </div>
      )}

      {gallery && <fieldset disabled={readOnly || saving || uploading || !!removingImageId || loading || !!error || gallery.productId !== productId} className="space-y-3">

        <legend className="font-semibold">صور المتغيرات المحفوظة</legend>
        <p className="text-sm text-slate-600">احفظ المتغيرات الجديدة أولاً. بدون تعيين تستخدم الصورة الرئيسية، أو لا توجد صورة عندما يكون المعرض فارغاً.</p>
        {variants.map(variant => <label key={variant.id} className="block text-sm">
          {variant.sku} {Object.entries(variant.attributes).map(([name, value]) => `${name}: ${value}`).join(" / ")}
          <select className="mt-1 block min-h-11 w-full rounded-lg border border-slate-400 bg-white p-2"
            aria-invalid={!!fieldErrors[`variantImages.${variant.id}`]} aria-describedby={fieldErrors[`variantImages.${variant.id}`] ? `variant-image-error-${variant.id}` : undefined}
            data-testid={`variant-image-${variant.id}`} aria-label={`صورة المتغير ${variant.sku}`}
            value={mappings[variant.id] ?? ""} onChange={event => { if (readOnly) return; setLocalMappings({ ...mappings, [variant.id]: event.target.value }); setSaveSuccess(null); }}>
            <option value="">الصورة الرئيسية / بدون صورة</option>
            {orderedImages.map((image, index) => <option key={image.id} value={image.id}>{index + 1}: {(localAltTexts[image.id] ?? image.altText).trim() || `الصورة ${index + 1} (بدون وصف)`}</option>)}
          </select>
          {fieldErrors[`variantImages.${variant.id}`] && <span id={`variant-image-error-${variant.id}`} role="alert">{fieldErrors[`variantImages.${variant.id}`]}</span>}
        </label>)}
        {Object.entries(fieldErrors).filter(([field]) => field.startsWith("variantImages")).map(([field, message]) => <p key={field} role="alert">{message}</p>)}
      </fieldset>}

      {uploadError && (
        <div
          role="alert"
          className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800"
          data-testid="gallery-upload-error"
        >
          <p>{uploadError}</p>
          {selectedFile && retryable && (
            <button
              type="button"
              className="mt-2 text-xs font-semibold underline"
              onClick={handleRetryUpload}
              disabled={readOnly || uploading || saving || !!removingImageId || loading || !!error || gallery?.productId !== productId}
              data-testid="gallery-upload-retry"
            >
              إعادة المحاولة
            </button>
          )}
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-4" role="status">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded-xl bg-slate-200"
              aria-label="جارٍ تحميل الصور…"
            />
          ))}
        </div>
      )}

      {error && !loading && (
        <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 text-sm font-semibold underline"
            onClick={onRetry}
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {!loading && !error && gallery && gallery.images.length === 0 && (
        <p
          role="status"
          className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600"
        >
          لا توجد صور بعد.
        </p>
      )}

      {!loading && !error && gallery && gallery.images.length > 0 && (
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
          {orderedImages.map((image: GalleryImageDto, index) => {
            const isPrimary = index === 0;
            const currentAlt = localAltTexts[image.id] !== undefined ? localAltTexts[image.id] : image.altText;
            const isBlank = currentAlt.trim() === "";
            const isFailed = failedImages[image.id];
            const reloadKey = reloadKeys[image.id] || 0;
            const fieldError = fieldErrors[`images.${image.id}.altText`];

            return (
              <div
                key={image.id}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-2"
                data-testid={`gallery-image-${image.id}`}
              >
                <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-slate-200">
                  {isFailed ? (
                    <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center">
                      <span className="text-xs text-rose-600">تعذر تحميل المعاينة</span>
                      <button
                        type="button"
                        onClick={() => handleRetryImage(image.id)}
                        className="mt-2 text-xs font-semibold text-blue-700 underline"
                      >
                        إعادة المحاولة
                      </button>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`${image.previewUrl}?v=${reloadKey}`}
                      alt={currentAlt.trim() || "معاينة صورة المنتج"}
                      className="h-full w-full object-cover"
                      onError={() => handleImageError(image.id)}
                    />
                  )}

                  {isPrimary && (
                    <span className="absolute top-2 right-2 rounded-full bg-blue-700 px-2.5 py-0.5 text-xs font-bold text-white shadow-xs">
                      الرئيسية
                    </span>
                  )}
                </div>

                <div className="mt-2 space-y-1.5">
                  <p className="text-xs text-slate-600" data-testid={`gallery-position-${image.id}`}>الصورة {index + 1} من {orderedImages.length}</p>
                  <div className="flex flex-wrap gap-2">
                    {([-1, 1] as const).map(direction => {
                      const boundary = index + direction < 0 || index + direction >= orderedImages.length;
                      const key = `${image.id}:${direction}`;
                      return <button key={direction} type="button"
                        ref={node => { moveButtons.current[key] = node; }}
                        aria-label={`${direction === -1 ? "نقل إلى موضع سابق" : "نقل إلى موضع لاحق"} للصورة ${index + 1}`}
                        aria-disabled={readOnly || boundary}
                        disabled={readOnly || saving || uploading || loading || !!removingImageId || !!error || gallery.productId !== productId}
                        data-testid={`gallery-move-${direction === -1 ? "earlier" : "later"}-${image.id}`}
                        className="min-h-11 rounded-lg border border-slate-400 px-3 py-2 text-xs font-semibold aria-disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50"
                        onClick={() => {
                          if (readOnly || boundary || saving || uploading || loading || !!removingImageId || error) return;
                          const ids = orderedImages.map(item => item.id);
                          const previousPrimary = ids[0];
                          [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
                          pendingFocus.current = key;
                          setLocalOrder(ids);
                          setSaveSuccess(null);
                          setMoveAnnouncement(`التغيير ${++announcementSequence.current}: تم نقل الصورة ${image.id} إلى الموضع ${index + direction + 1} من ${ids.length}. ${previousPrimary !== ids[0] ? "الصورة في الموضع الأول هي الرئيسية الآن." : "لم تتغير الصورة الرئيسية."}`);
                        }}>
                        {direction === -1 ? "نقل إلى موضع سابق" : "نقل إلى موضع لاحق"}
                      </button>;
                    })}
                    <button
                      type="button"
                      ref={(node) => { removeButtons.current[image.id] = node; }}
                      aria-label={`إزالة الصورة ${index + 1}`}
                      disabled={readOnly || saving || uploading || loading || !!removingImageId || !!error || gallery.productId !== productId}
                      data-testid={`gallery-remove-${image.id}`}
                      className="min-h-11 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
                      onClick={() => {
                        if (readOnly) return;
                        setConfirmRemoveImageId(image.id);
                      }}
                    >
                      إزالة الصورة
                    </button>
                  </div>
                  <p className="truncate text-xs text-slate-500" title={currentAlt || "(بدون نص بديل)"}>
                    {currentAlt ? `النص: ${currentAlt}` : "(بدون نص بديل)"}
                  </p>

                  <label
                    htmlFor={`alt-text-${image.id}`}
                    className="block text-xs font-medium text-slate-700"
                  >
                    النص البديل
                  </label>
                  <input
                    id={`alt-text-${image.id}`}
                    type="text"
                    value={currentAlt}
                    maxLength={500}
                    disabled={readOnly || saving || uploading || loading || !!removingImageId || !!error || gallery?.productId !== productId}
                    onChange={(e) => {
                      if (readOnly) return;
                      const val = e.target.value;
                      setLocalAltTexts((prev) => ({ ...prev, [image.id]: val }));
                      setSaveSuccess(null);
                      if (fieldErrors[`images.${image.id}.altText`]) {
                        setFieldErrors((prev) => {
                          const next = { ...prev };
                          delete next[`images.${image.id}.altText`];
                          return next;
                        });
                      }
                    }}
                    className={`block w-full rounded-md border p-1.5 text-xs text-slate-900 shadow-xs focus:ring-1 focus:outline-none ${
                      fieldError ? "border-rose-400 focus:border-rose-500 focus:ring-rose-500" : "border-slate-300 focus:border-blue-600 focus:ring-blue-600"
                    }`}
                    aria-label={`النص البديل للصورة ${index + 1}`}
                    aria-invalid={!!fieldError}
                    aria-describedby={fieldError ? `error-images-${image.id}-altText` : undefined}
                    data-testid={`gallery-alt-input-${image.id}`}
                  />

                  {fieldError && (
                    <p
                      id={`error-images-${image.id}-altText`}
                      role="alert"
                      className="text-[11px] text-rose-600"
                      data-testid={`gallery-alt-error-${image.id}`}
                    >
                      {fieldError}
                    </p>
                  )}

                  {isBlank && (
                    <span
                      className="inline-block rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                      data-testid={`gallery-readiness-warning-${image.id}`}
                    >
                      مطلوب نص بديل للنشر
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmRemoveImageId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="gallery-remove-dialog-title"
          data-testid="gallery-remove-dialog"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !removingImageId) {
              const idToFocus = confirmRemoveImageId;
              setConfirmRemoveImageId(null);
              removeButtons.current[idToFocus]?.focus();
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
        >
          <div className="max-w-md w-full rounded-2xl border border-rose-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-50 text-lg font-bold text-rose-700">
              ⚠️
            </div>
            <h3 id="gallery-remove-dialog-title" className="text-base font-bold text-slate-900">
              تأكيد إزالة الصورة
            </h3>
            <p className="text-xs leading-relaxed text-slate-600">
              هل أنت متأكد من رغبتك في إزالة هذه الصورة من المعرض؟ سيتم فك ارتباط الصورة من أي متغيرات مرتبطة بها (ستستخدم المتغيرات الصورة الرئيسية تلقائياً). لن يتم حذف ملف الصورة الأصلي للحفاظ على السجلات السابقة.
            </p>
            {isDirty && (
              <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                تنبيه: لديك تعديلات غير محفوظة في المعرض (ترتيب أو أوصاف أو تعيينات). ستؤدي إزالة الصورة إلى تجاهل هذه التعديلات غير المحفوظة.
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                disabled={!!removingImageId}
                onClick={() => {
                  const idToFocus = confirmRemoveImageId;
                  setConfirmRemoveImageId(null);
                  removeButtons.current[idToFocus]?.focus();
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                data-testid="gallery-remove-cancel"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={readOnly || !!removingImageId}
                onClick={() => handleExecuteRemove(confirmRemoveImageId)}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
                data-testid="gallery-remove-confirm"
              >
                {removingImageId ? "جارٍ الإزالة…" : "تأكيد الإزالة"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

