/** @vitest-environment jsdom */
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductGallery } from "./product-gallery";
import { GalleryDto } from "../../../../../modules/catalog/products/contracts/gallery";

afterEach(() => {
  cleanup();
});

const mockGallery: GalleryDto = {
  productId: "prd_123",
  revision: "1",
  primaryImageId: "pim_1",
  images: [
    {
      id: "pim_1",
      mediaId: "med_1",
      position: 0,
      altText: "",
      mimeType: "image/png",
      size: 1024,
      previewUrl: "/api/v1/admin/catalog/products/prd_123/images/pim_1/content",
    },
    {
      id: "pim_2",
      mediaId: "med_2",
      position: 1,
      altText: "Back View",
      mimeType: "image/jpeg",
      size: 2048,
      previewUrl: "/api/v1/admin/catalog/products/prd_123/images/pim_2/content",
    },
  ],
  variantImages: [],
  publicationIssues: [
    { field: "images.pim_1.altText", message: "Alt text is required before publication" },
  ],
};

describe("ProductGallery UI component", () => {
  it("renders empty state placeholder for unsaved product", () => {
    render(<ProductGallery gallery={null} loading={false} error={null} onRetry={() => {}} />);
    expect(screen.getByText(/احفظ المسودة أولاً لإضافة واستعراض الصور/i)).toBeTruthy();
  });

  it("renders loading skeletons when loading", () => {
    render(<ProductGallery productId="prd_123" gallery={null} loading={true} error={null} onRetry={() => {}} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("renders error alert with retry button on failure", () => {
    const retryFn = vi.fn();
    render(<ProductGallery productId="prd_123" gallery={null} loading={false} error="فشل في الاتصال" onRetry={retryFn} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("فشل في الاتصال")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(retryFn).toHaveBeenCalledOnce();
  });

  it("renders empty gallery placeholder when images array is empty", () => {
    render(
      <ProductGallery
        productId="prd_123"
        gallery={{ ...mockGallery, images: [], primaryImageId: null, publicationIssues: [] }}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText("لا توجد صور بعد.")).toBeTruthy();
  });

  it("renders gallery thumbnails, primary badge, and alt text issue indicators", () => {
    render(<ProductGallery productId="prd_123" gallery={mockGallery} loading={false} error={null} onRetry={() => {}} />);
    expect(screen.getByText("الرئيسية")).toBeTruthy();
    expect(screen.getByText("مطلوب نص بديل للنشر")).toBeTruthy();
    expect(screen.getByText("النص: Back View")).toBeTruthy();
    expect(screen.getByText("(بدون نص بديل)")).toBeTruthy();
  });

  it("handles broken thumbnail with retry without re-rendering form", () => {
    render(<ProductGallery productId="prd_123" gallery={mockGallery} loading={false} error={null} onRetry={() => {}} />);
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(2);

    // Trigger onError on first image
    fireEvent.error(images[0]);
    expect(screen.getByText("تعذر تحميل المعاينة")).toBeTruthy();

    const retryBtn = screen.getByRole("button", { name: "إعادة المحاولة" });
    fireEvent.click(retryBtn);

    // After retry, img tag is restored
    expect(screen.queryByText("تعذر تحميل المعاينة")).toBeNull();
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("renders upload input and enables button when a valid file is selected", async () => {
    const onUploadSuccess = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          image: { id: "pim_new", position: 2 },
          gallery: { ...mockGallery, revision: "2" },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
        csrf="csrf_token_abc"
        onUploadSuccess={onUploadSuccess}
      />
    );

    const input = screen.getByTestId("gallery-upload-input") as HTMLInputElement;
    const uploadBtn = screen.getByTestId("gallery-upload-button") as HTMLButtonElement;

    // Button should initially be disabled
    expect(uploadBtn.disabled).toBe(true);

    const file = new File(["fake-image-bytes"], "test.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    // After selecting file, button is enabled
    expect(uploadBtn.disabled).toBe(false);

    fireEvent.click(uploadBtn);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/admin/catalog/products/prd_123/images");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf_token_abc");
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();

    await vi.waitFor(() => {
      expect(onUploadSuccess).toHaveBeenCalledOnce();
    });
  });

  it("shows maximum capacity badge and hides upload form when gallery has 10 images", () => {
    const tenImages = Array.from({ length: 10 }, (_, i) => ({
      id: `pim_${i}`,
      mediaId: `med_${i}`,
      position: i,
      altText: `Image ${i}`,
      mimeType: "image/png",
      size: 1024,
      previewUrl: `/api/v1/admin/catalog/products/prd_123/images/pim_${i}/content`,
    }));

    render(
      <ProductGallery
        productId="prd_123"
        gallery={{ ...mockGallery, images: tenImages }}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    expect(screen.getByText("تم بلوغ الحد الأقصى (10 صور)")).toBeTruthy();
    expect(screen.queryByTestId("gallery-upload-input")).toBeNull();
  });

  it("displays localized error and allows retrying with the same idempotency key on upload failure", async () => {
    const capturedKeys: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      capturedKeys.push(headers["Idempotency-Key"]);
      return new Response(
        JSON.stringify({ error: { code: "SERVER_ERROR", message: "Database failure during save" } }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    });

    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    const input = screen.getByTestId("gallery-upload-input");
    const uploadBtn = screen.getByTestId("gallery-upload-button");

    const file = new File(["test-image-bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(uploadBtn);

    await vi.waitFor(() => {
      expect(screen.getByTestId("gallery-upload-error")).toBeTruthy();
    });
    expect(screen.getByText("Database failure during save")).toBeTruthy();

    // Click retry
    const retryBtn = screen.getByTestId("gallery-upload-retry");
    fireEvent.click(retryBtn);

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    // Both calls must have used the EXACT same idempotency key
    expect(capturedKeys).toHaveLength(2);
    expect(capturedKeys[0]).toBe(capturedKeys[1]);
  });
});
