"use client";

import { useState } from "react";
import { GalleryDto, GalleryImageDto } from "../../../../../modules/catalog/products/contracts/gallery";

interface ProductGalleryProps {
  productId?: string;
  gallery: GalleryDto | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function ProductGallery({
  productId,
  gallery,
  loading,
  error,
  onRetry,
}: ProductGalleryProps) {
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});

  const handleImageError = (imageId: string) => {
    setFailedImages((prev) => ({ ...prev, [imageId]: true }));
  };

  const handleRetryImage = (imageId: string) => {
    setFailedImages((prev) => ({ ...prev, [imageId]: false }));
    setReloadKeys((prev) => ({ ...prev, [imageId]: (prev[imageId] || 0) + 1 }));
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

  return (
    <section
      className="space-y-4 rounded-2xl border border-slate-300 bg-white p-5 sm:p-6 shadow-xs"
      aria-busy={loading}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">معرض الصور</h3>
          {gallery && (
            <p className="text-xs text-slate-500">
              مراجعة المعرض: {gallery.revision}
            </p>
          )}
        </div>
      </div>

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
              (issue) => issue.field === `images.${image.id}.altText`
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

