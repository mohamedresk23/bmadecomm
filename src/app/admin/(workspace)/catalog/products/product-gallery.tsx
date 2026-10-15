"use client";

import { useRef, useState } from "react";
import { GalleryDto, GalleryImageDto } from "../../../../../modules/catalog/products/contracts/gallery";

interface ProductGalleryProps {
  productId?: string;
  gallery: GalleryDto | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  csrf?: string;
  onUploadSuccess?: (gallery: GalleryDto) => void;
}

export function ProductGallery({
  productId,
  gallery,
  loading,
  error,
  onRetry,
  csrf,
  onUploadSuccess,
}: ProductGalleryProps) {
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageError = (imageId: string) => {
    setFailedImages((prev) => ({ ...prev, [imageId]: true }));
  };

  const handleRetryImage = (imageId: string) => {
    setFailedImages((prev) => ({ ...prev, [imageId]: false }));
    setReloadKeys((prev) => ({ ...prev, [imageId]: (prev[imageId] || 0) + 1 }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    if (!productId) return;
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
      });

      if (!res.ok) {
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
          throw new Error("لا يمكن إضافة أكثر من 10 صور للمنتج.");
        }
        if (res.status === 409) {
          throw new Error(data?.error?.message || "تعارض في حالة المنتج أو مفتاح العملية.");
        }
        throw new Error(data?.error?.message || `فشل رفع الصورة (${res.status})`);
      }

      const data = await res.json();
      setSelectedFile(null);
      setIdempotencyKey(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      if (onUploadSuccess && data.gallery) {
        onUploadSuccess(data.gallery);
      } else {
        onRetry();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء الرفع";
      setUploadError(message);
    } finally {
      setUploading(false);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !idempotencyKey || uploading) return;
    await executeUpload(selectedFile, idempotencyKey);
  };

  const handleRetryUpload = async () => {
    if (!selectedFile || !idempotencyKey || uploading) return;
    await executeUpload(selectedFile, idempotencyKey);
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
      aria-busy={loading || uploading}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold">معرض الصور</h3>
          {gallery && (
            <p className="text-xs text-slate-500">
              مراجعة المعرض: {gallery.revision} ({activeImagesCount} من 10 صور)
            </p>
          )}
        </div>

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
              disabled={uploading}
              className="text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
              aria-label="اختر صورة للمنتج"
              data-testid="gallery-upload-input"
            />
            <button
              type="submit"
              disabled={!selectedFile || uploading}
              className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              data-testid="gallery-upload-button"
            >
              {uploading ? "جارٍ الرفع…" : "رفع الصورة"}
            </button>
          </form>
        )}
      </div>

      {uploadError && (
        <div
          role="alert"
          className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800"
          data-testid="gallery-upload-error"
        >
          <p>{uploadError}</p>
          {selectedFile && (
            <button
              type="button"
              className="mt-2 text-xs font-semibold underline"
              onClick={handleRetryUpload}
              disabled={uploading}
              data-testid="gallery-upload-retry"
            >
              إعادة المحاولة
            </button>
          )}
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4" role="status">
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {gallery.images.map((image: GalleryImageDto) => {
            const isPrimary = image.id === gallery.primaryImageId;
            const hasIssue = gallery.publicationIssues.some(
              (issue: { field: string; message: string }) => issue.field === `images.${image.id}.altText`
            );
            const isFailed = failedImages[image.id];
            const reloadKey = reloadKeys[image.id] || 0;

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
                      alt={image.altText || "معاينة صورة المنتج"}
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

                <div className="mt-2 space-y-1">
                  <p className="truncate text-xs text-slate-600" title={image.altText || "(بدون نص بديل)"}>
                    {image.altText ? `النص: ${image.altText}` : "(بدون نص بديل)"}
                  </p>
                  {hasIssue && (
                    <span className="inline-block rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      مطلوب نص بديل للنشر
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

