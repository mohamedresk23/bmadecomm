/** @vitest-environment jsdom */
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
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

describe("persisted variant image selectors", () => {
  const variants: { id: string; sku: string; attributes: Record<string, string> }[] = [{ id: "v1", sku: "RED-S", attributes: { color: "red", size: "s" } }, { id: "v2", sku: "BLUE-M", attributes: { color: "blue" } }];
  const props = { productId: "prd_123", variants, gallery: mockGallery, loading: false, error: null, onRetry: vi.fn() };
  it("ignores another product snapshot across a failed switch and accepts the matching refresh cleanly", () => {
    const { rerender } = render(<ProductGallery {...props} />);
    rerender(<ProductGallery {...props} productId="other" gallery={mockGallery} error="Failed switch" />);
    expect(screen.queryByTestId("gallery-image-pim_1")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByTestId("gallery-dirty-badge")).toBeNull();
    rerender(<ProductGallery {...props} productId="other" gallery={{ ...mockGallery, productId: "other" }} />);
    expect(screen.getByTestId("gallery-image-pim_1")).toBeTruthy();
    expect((screen.getByTestId("variant-image-v1").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
    expect(screen.queryByTestId("gallery-dirty-badge")).toBeNull();
  });
  it("offers explicit recovery when a locally mapped variant is removed without changing revision", () => {
    const retry = vi.fn();
    const { rerender } = render(<ProductGallery {...props} onRetry={retry} />);
    fireEvent.change(screen.getByTestId("variant-image-v1"), { target: { value: "pim_2" } });
    fireEvent.change(screen.getByTestId("gallery-alt-input-pim_1"), { target: { value: "Keep pending description" } });
    rerender(<ProductGallery {...props} variants={[variants[1]]} gallery={{ ...mockGallery }} onRetry={retry} />);
    expect(screen.queryByTestId("variant-image-v1")).toBeNull();
    expect((screen.getByTestId("gallery-save-button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("gallery-alt-input-pim_1") as HTMLInputElement).value).toBe("Keep pending description");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByTestId("gallery-reload-button"));
    expect(confirm.mock.calls[0][0]).toContain("تعيينات صور المتغيرات");
    expect(retry).toHaveBeenCalledOnce();
    rerender(<ProductGallery {...props} variants={[variants[1]]} gallery={{ ...mockGallery }} onRetry={retry} />);
    expect(screen.queryByTestId("gallery-dirty-badge")).toBeNull();
    expect(screen.queryByTestId("gallery-reload-button")).toBeNull();
    expect((screen.getByTestId("gallery-alt-input-pim_1") as HTMLInputElement).value).toBe("");
  });
  it("associates indexed mapping errors with the submitted variant and summarizes unmatched errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: { message: "Validation failed", details: [{ field: "variantImages.0.imageId", message: "Choose an active image" }, { field: "variantImages.99", message: "Unmatched mapping issue" }] } }) }));
    render(<ProductGallery {...props} />);
    expect(screen.getAllByRole("option", { name: /الصورة 1 \(بدون وصف\)/ })).toHaveLength(2);
    fireEvent.change(screen.getByTestId("variant-image-v2"), { target: { value: "pim_1" } });
    fireEvent.click(screen.getByTestId("gallery-save-button"));
    await screen.findByTestId("gallery-save-error");
    const select = screen.getByTestId("variant-image-v2");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(select.getAttribute("aria-describedby")!)?.textContent).toBe("Choose an active image");
    expect(screen.getByTestId("variant-image-v1").getAttribute("aria-invalid")).toBe("false");
    expect(screen.getByText("Unmatched mapping issue")).toBeTruthy();
  });
  it("maps and shares persisted IDs, includes mapping changes in dirty/save, and clears with fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ gallery: { ...mockGallery, revision: "1", variantImages: variants.map(variant => ({ variantId: variant.id, imageId: "pim_2" })) } }) });
    vi.stubGlobal("fetch", fetchMock);
    const update = vi.fn();
    render(<ProductGallery {...props} onGalleryUpdate={update} />);
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    fireEvent.change(screen.getByTestId("variant-image-v1"), { target: { value: "pim_2" } });
    fireEvent.change(screen.getByTestId("variant-image-v2"), { target: { value: "pim_2" } });
    expect(screen.getByTestId("gallery-dirty-badge")).toBeTruthy();
    fireEvent.click(screen.getByTestId("gallery-save-button"));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.variantImages).toEqual(variants.map(variant => ({ variantId: variant.id, imageId: "pim_2" })));
    fireEvent.change(screen.getByTestId("variant-image-v1"), { target: { value: "" } });
    expect((screen.getByTestId("variant-image-v1") as HTMLSelectElement).value).toBe("");
    expect(screen.getByTestId("gallery-dirty-badge")).toBeTruthy();
  });
  it("keeps local order, alt and mapping with the original revision through null/failed/stale refresh", async () => {
    const retry = vi.fn();
    const { rerender } = render(<ProductGallery {...props} onRetry={retry} />);
    fireEvent.change(screen.getByTestId("variant-image-v1"), { target: { value: "pim_2" } });
    fireEvent.change(screen.getByTestId("gallery-alt-input-pim_1"), { target: { value: "Keep description" } });
    fireEvent.click(screen.getByTestId("gallery-move-earlier-pim_2"));
    rerender(<ProductGallery {...props} gallery={null} loading={true} onRetry={retry} />);
    rerender(<ProductGallery {...props} gallery={null} error="Failed refresh" onRetry={retry} />);
    rerender(<ProductGallery {...props} gallery={{ ...mockGallery, revision: "2" }} onRetry={retry} />);
    expect((screen.getByTestId("gallery-alt-input-pim_1") as HTMLInputElement).value).toBe("Keep description");
    expect((screen.getByTestId("variant-image-v1") as HTMLSelectElement).value).toBe("pim_2");
    expect(screen.getAllByTestId(/^gallery-image-/)[0].getAttribute("data-testid")).toBe("gallery-image-pim_2");
    expect((screen.getByTestId("gallery-save-button") as HTMLButtonElement).disabled).toBe(true);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByTestId("gallery-reload-button"));
    expect(retry).toHaveBeenCalledOnce();
    rerender(<ProductGallery {...props} gallery={null} error="Still failed" onRetry={retry} />);
    rerender(<ProductGallery {...props} gallery={{ ...mockGallery, revision: "2" }} onRetry={retry} />);
    expect((screen.getByTestId("gallery-alt-input-pim_1") as HTMLInputElement).value).toBe(mockGallery.images[0].altText);
    expect((screen.getByTestId("variant-image-v1") as HTMLSelectElement).value).toBe("");
  });
  it("announces cleared mappings after a clean product refresh and disables conflicting writes", () => {
    const mapped = { ...mockGallery, variantImages: [{ variantId: "v1", imageId: "pim_2" }] };
    const { rerender } = render(<ProductGallery {...props} gallery={mapped} />);
    rerender(<ProductGallery {...props} gallery={{ ...mockGallery, revision: "1" }} productSaving />);
    expect(screen.getByTestId("gallery-save-success").textContent).toContain("تم مسح 1");
    expect((screen.getByTestId("variant-image-v1").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  });
  it.each([401, 422, 503])("retains entered mapping and original revision after HTTP %s", async status => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: { message: "Save failed", details: [{ field: "variantImages.0", message: "Review mapping" }] } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProductGallery {...props} />);
    fireEvent.change(screen.getByTestId("variant-image-v1"), { target: { value: "pim_2" } });
    fireEvent.click(screen.getByTestId("gallery-save-button"));
    await waitFor(() => expect(screen.getByTestId("gallery-save-error")).toBeTruthy());
    expect((screen.getByTestId("variant-image-v1") as HTMLSelectElement).value).toBe("pim_2");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).expectedRevision).toBe(mockGallery.revision);
    expect(screen.getByTestId("gallery-dirty-badge")).toBeTruthy();
  });
});

describe("ProductGallery UI component", () => {
  it("renders empty state placeholder for unsaved product", () => {
    render(<ProductGallery gallery={null} loading={false} error={null} onRetry={() => {}} />);
    expect(screen.getByText(/احفظ المسودة أولاً لإضافة واستعراض الصور/i)).toBeTruthy();
  });

  it("renders loading skeletons when loading", () => {
    render(<ProductGallery productId="prd_123" gallery={null} loading={true} error={null} onRetry={() => {}} />);
    expect(screen.getAllByLabelText("جارٍ تحميل الصور…")).toHaveLength(3);
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


it("renders policy validation accurately without permanent-error retry and sends CSRF", async () => {
  const fetcher=vi.fn().mockResolvedValue({ok:false,status:422,json:async()=>({error:{message:"Static images required"}})});vi.stubGlobal("fetch",fetcher);
  try {
    render(<ProductGallery productId="prd_123" gallery={mockGallery} loading={false} error={null} onRetry={()=>{}} csrf="real-csrf" />);
    fireEvent.change(screen.getByTestId("gallery-upload-input"),{target:{files:[new File(["x"],"x.png",{type:"image/png"})]}});fireEvent.click(screen.getByTestId("gallery-upload-button"));
    await waitFor(()=>expect(screen.getByText("Static images required")).toBeTruthy());expect(screen.queryByTestId("gallery-upload-retry")).toBeNull();
    expect(fetcher.mock.calls[0][1].headers["X-CSRF-Token"]).toBe("real-csrf");
  } finally {vi.unstubAllGlobals();}
});
it("disables unavailable galleries and ignores an old product upload result",async()=>{
  let resolve!: (value:unknown)=>void;const fetcher=vi.fn(()=>new Promise(r=>{resolve=r;}));vi.stubGlobal("fetch",fetcher);const success=vi.fn();
  try {
    const view=render(<ProductGallery productId="prd_123" gallery={mockGallery} loading={false} error={null} onRetry={()=>{}} onUploadSuccess={success}/>);
    fireEvent.change(screen.getByTestId("gallery-upload-input"),{target:{files:[new File(["x"],"x.png")]}});fireEvent.click(screen.getByTestId("gallery-upload-button"));
    view.rerender(<ProductGallery productId="other" gallery={null} loading={true} error={null} onRetry={()=>{}} onUploadSuccess={success}/>);
    expect((screen.getByTestId("gallery-upload-input") as HTMLInputElement).disabled).toBe(true);
    resolve({ok:true,json:async()=>({gallery:mockGallery})});await waitFor(()=>expect(fetcher).toHaveBeenCalled());await Promise.resolve();expect(success).not.toHaveBeenCalled();
  } finally {vi.unstubAllGlobals();}
});


it("retains the same key for in-progress contention and disables retry while gallery unavailable",async()=>{
  const fetcher=vi.fn().mockResolvedValue({ok:false,status:409,json:async()=>({error:{message:"An upload with this idempotency key is already in progress"}})});vi.stubGlobal("fetch",fetcher);
  try{const props={productId:"prd_123",gallery:mockGallery,loading:false,error:null,onRetry:()=>{}};const view=render(<ProductGallery {...props}/>);
    fireEvent.change(screen.getByTestId("gallery-upload-input"),{target:{files:[new File(["x"],"x.png")]}});fireEvent.click(screen.getByTestId("gallery-upload-button"));
    await waitFor(()=>expect(screen.getByTestId("gallery-upload-retry")).toBeTruthy());const key=fetcher.mock.calls[0][1].headers["Idempotency-Key"];
    view.rerender(<ProductGallery {...props} loading={true}/>);expect((screen.getByTestId("gallery-upload-retry") as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<ProductGallery {...props}/>);fireEvent.click(screen.getByTestId("gallery-upload-retry"));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));expect(fetcher.mock.calls[1][1].headers["Idempotency-Key"]).toBe(key);
  }finally{vi.unstubAllGlobals();}
});
it("uses a generic validation fallback for message-less 422",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:422,json:async()=>({error:{}})}));try{render(<ProductGallery productId="prd_123" gallery={mockGallery} loading={false} error={null} onRetry={()=>{}}/>);fireEvent.change(screen.getByTestId("gallery-upload-input"),{target:{files:[new File(["x"],"x.png")]}});fireEvent.click(screen.getByTestId("gallery-upload-button"));await screen.findByText("Image validation failed. Choose a valid static image.");expect(screen.queryByTestId("gallery-upload-retry")).toBeNull();}finally{vi.unstubAllGlobals();}
});

describe("ProductGallery alt text editing and publication readiness", () => {
  it("renders alt text inputs with initial values for each active image", () => {
    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    const input1 = screen.getByTestId("gallery-alt-input-pim_1") as HTMLInputElement;
    const input2 = screen.getByTestId("gallery-alt-input-pim_2") as HTMLInputElement;

    expect(input1.value).toBe("");
    expect(input2.value).toBe("Back View");
  });

  it("tracks dirty badge and save button states when alt text changes and reverts", () => {
    const onDirtyChange = vi.fn();
    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
        onDirtyChange={onDirtyChange}
      />
    );

    const saveBtn = screen.getByTestId("gallery-save-button") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    expect(screen.queryByTestId("gallery-dirty-badge")).toBeNull();

    const input1 = screen.getByTestId("gallery-alt-input-pim_1");

    // Modify alt text
    fireEvent.change(input1, { target: { value: "Front View Updated" } });

    expect(saveBtn.disabled).toBe(false);
    expect(screen.getByTestId("gallery-dirty-badge")).toBeTruthy();
    expect(onDirtyChange).toHaveBeenCalledWith(true);

    // Revert back to original
    fireEvent.change(input1, { target: { value: "" } });

    expect(saveBtn.disabled).toBe(true);
    expect(screen.queryByTestId("gallery-dirty-badge")).toBeNull();
    expect(onDirtyChange).toHaveBeenCalledWith(false);
  });

  it("submits PUT request with expected revision and updated alt text on Save click", async () => {
    const onGalleryUpdate = vi.fn();
    const updatedGallery: GalleryDto = {
      ...mockGallery,
      revision: "2",
      images: [
        { ...mockGallery.images[0], altText: "Front Angle" },
        mockGallery.images[1],
      ],
      publicationIssues: [],
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, gallery: updatedGallery }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
        csrf="csrf_token_xyz"
        onGalleryUpdate={onGalleryUpdate}
      />
    );

    const input1 = screen.getByTestId("gallery-alt-input-pim_1");
    fireEvent.change(input1, { target: { value: "Front Angle" } });

    const saveBtn = screen.getByTestId("gallery-save-button");
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/admin/catalog/products/prd_123/images");
    expect(init?.method).toBe("PUT");
    expect((init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf_token_xyz");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const sentBody = JSON.parse(init?.body as string);
    expect(sentBody).toEqual({
      expectedRevision: "1",
      images: [
        { id: "pim_1", altText: "Front Angle" },
        { id: "pim_2", altText: "Back View" },
      ],
      variantImages: [],
    });

    await waitFor(() => {
      expect(onGalleryUpdate).toHaveBeenCalledWith(updatedGallery);
    });
  });

  it("toggles publication readiness warning when alt text is typed or cleared", () => {
    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    // Initially pim_1 has empty altText -> warning is shown
    expect(screen.getByTestId("gallery-readiness-warning-pim_1")).toBeTruthy();
    // pim_2 has "Back View" -> no warning
    expect(screen.queryByTestId("gallery-readiness-warning-pim_2")).toBeNull();

    // Type text for pim_1 -> warning should disappear
    const input1 = screen.getByTestId("gallery-alt-input-pim_1");
    fireEvent.change(input1, { target: { value: "Detailed Description" } });
    expect(screen.queryByTestId("gallery-readiness-warning-pim_1")).toBeNull();

    // Clear text back to whitespace -> warning reappears
    fireEvent.change(input1, { target: { value: "   " } });
    expect(screen.getByTestId("gallery-readiness-warning-pim_1")).toBeTruthy();
  });

  it("displays inline field error on 422 validation failure while retaining entered text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "UNPROCESSABLE_ENTITY",
            message: "Validation failed",
            details: [{ field: "images.pim_1.altText", message: "Alt text must be at most 500 characters" }],
          },
        }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      )
    );

    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    const input1 = screen.getByTestId("gallery-alt-input-pim_1") as HTMLInputElement;
    const longText = "a".repeat(501);
    fireEvent.change(input1, { target: { value: longText } });

    fireEvent.click(screen.getByTestId("gallery-save-button"));

    await waitFor(() => {
      expect(screen.getByTestId("gallery-alt-error-pim_1")).toBeTruthy();
    });

    expect(screen.getByText("Alt text must be at most 500 characters")).toBeTruthy();
    // Text is preserved
    expect(input1.value).toBe(longText);
  });

  it("prompts confirmation when uploading while gallery is dirty: cancel retains edits, confirm proceeds", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, image: { id: "new" }, gallery: mockGallery }), { status: 201 })
    );

    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    const input1 = screen.getByTestId("gallery-alt-input-pim_1") as HTMLInputElement;
    fireEvent.change(input1, { target: { value: "Dirty edit pending save" } });

    const uploadInput = screen.getByTestId("gallery-upload-input");
    const uploadBtn = screen.getByTestId("gallery-upload-button");
    const file = new File(["test"], "photo.png", { type: "image/png" });
    fireEvent.change(uploadInput, { target: { files: [file] } });

    // 1. User cancels confirmation prompt
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(uploadBtn);

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(input1.value).toBe("Dirty edit pending save");

    // 2. User confirms confirmation prompt
    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(uploadBtn);

    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("guards dirty gallery with window beforeunload event", () => {
    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    const input1 = screen.getByTestId("gallery-alt-input-pim_1");
    fireEvent.change(input1, { target: { value: "Dirty description" } });

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("disables upload controls and blocks upload execution while saving is true", async () => {
    let resolveSave!: (res: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      () => new Promise((resolve) => { resolveSave = resolve; })
    );

    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    const input1 = screen.getByTestId("gallery-alt-input-pim_1");
    fireEvent.change(input1, { target: { value: "New alt pending save" } });

    const saveBtn = screen.getByTestId("gallery-save-button");
    const uploadInput = screen.getByTestId("gallery-upload-input") as HTMLInputElement;
    const uploadBtn = screen.getByTestId("gallery-upload-button") as HTMLButtonElement;

    fireEvent.click(saveBtn);

    // While saving is true
    expect(saveBtn.textContent).toBe("جارٍ الحفظ…");
    expect(uploadInput.disabled).toBe(true);
    expect(uploadBtn.disabled).toBe(true);

    // Resolve save
    resolveSave(
      new Response(JSON.stringify({ success: true, gallery: { ...mockGallery, revision: "2" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    await waitFor(() => {
      expect(screen.queryByTestId("gallery-save-button")?.getAttribute("disabled")).toBe("");
    });
  });

  it("calls onDirtyChange with false on unmount", () => {
    const onDirtyChange = vi.fn();
    const { unmount } = render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
        onDirtyChange={onDirtyChange}
      />
    );

    const input1 = screen.getByTestId("gallery-alt-input-pim_1");
    fireEvent.change(input1, { target: { value: "Dirty edit" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    unmount();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("compares trimmed values in isDirty to match server trimming", () => {
    const onDirtyChange = vi.fn();
    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
        onDirtyChange={onDirtyChange}
      />
    );

    const input1 = screen.getByTestId("gallery-alt-input-pim_1");
    // pim_1 altText is "" originally. Entering whitespace only should NOT mark dirty!
    fireEvent.change(input1, { target: { value: "   " } });
    expect(screen.queryByTestId("gallery-dirty-badge")).toBeNull();
    expect((screen.getByTestId("gallery-save-button") as HTMLButtonElement).disabled).toBe(true);

    // Entering non-whitespace text marks dirty
    fireEvent.change(input1, { target: { value: "Real description" } });
    expect(screen.getByTestId("gallery-dirty-badge")).toBeTruthy();

    // Entering same text with padding should not mark dirty when matching original
    const input2 = screen.getByTestId("gallery-alt-input-pim_2");
    // pim_2 is "Back View" originally.
    fireEvent.change(input2, { target: { value: "  Back View  " } });
    // revert input1 to empty
    fireEvent.change(input1, { target: { value: "" } });
    expect(screen.queryByTestId("gallery-dirty-badge")).toBeNull();
  });

  it("falls back to default alt text when input is blank or whitespace only", () => {
    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    const images = screen.getAllByRole("img");
    expect(images[0].getAttribute("alt")).toBe("معاينة صورة المنتج");

    // Enter whitespace in pim_2 (which had "Back View")
    const input2 = screen.getByTestId("gallery-alt-input-pim_2");
    fireEvent.change(input2, { target: { value: "     " } });

    // Image alt should fall back to default
    expect(images[1].getAttribute("alt")).toBe("معاينة صورة المنتج");
  });

  it("renders accessible status announcement upon successful save", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, gallery: { ...mockGallery, revision: "2" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    const input1 = screen.getByTestId("gallery-alt-input-pim_1");
    fireEvent.change(input1, { target: { value: "Valid description" } });

    fireEvent.click(screen.getByTestId("gallery-save-button"));

    await waitFor(() => {
      const announcement = screen.getByTestId("gallery-save-success");
      expect(announcement).toBeTruthy();
      expect(announcement.getAttribute("role")).toBe("status");
      expect(announcement.getAttribute("aria-live")).toBe("polite");
      expect(announcement.textContent).toContain("تم حفظ المعرض بنجاح.");
    });
  });
});


describe("accessible local gallery order", () => {
  const props = { productId: "prd_123", gallery: mockGallery, loading: false, error: null, onRetry: vi.fn() };
  const order = () => screen.getAllByTestId(/^gallery-image-/).map(node => node.getAttribute("data-testid"));
  it("swaps in logical order, retains ID descriptions and boundary focus, and undo becomes clean", () => {
    const dirty = vi.fn(); render(<ProductGallery {...props} onDirtyChange={dirty} />);
    const earlier = screen.getByTestId("gallery-move-earlier-pim_2");
    earlier.focus(); fireEvent.click(earlier);
    expect(order()).toEqual(["gallery-image-pim_2", "gallery-image-pim_1"]);
    expect(document.activeElement).toBe(earlier);
    expect(earlier.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(earlier);
    expect(order()).toEqual(["gallery-image-pim_2", "gallery-image-pim_1"]);
    expect((screen.getByTestId("gallery-alt-input-pim_2") as HTMLInputElement).value).toBe("Back View");
    expect(screen.getByTestId("gallery-move-status").textContent).toContain("1");
    expect(screen.getByTestId("gallery-move-status").getAttribute("aria-live")).toBe("polite");
    expect(dirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByTestId("gallery-move-later-pim_2"));
    expect(order()).toEqual(["gallery-image-pim_1", "gallery-image-pim_2"]);
    expect((screen.getByTestId("gallery-save-button") as HTMLButtonElement).disabled).toBe(true);
    expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it("sends the local permutation and descriptions and blocks edits while saving", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ProductGallery {...props} />);
    fireEvent.change(screen.getByTestId("gallery-alt-input-pim_1"), { target: { value: "Front edited" } });
    fireEvent.click(screen.getByTestId("gallery-move-earlier-pim_2"));
    fireEvent.click(screen.getByTestId("gallery-save-button"));
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).images).toEqual([{ id: "pim_2", altText: "Back View" }, { id: "pim_1", altText: "Front edited" }]);
    expect((screen.getByTestId("gallery-move-later-pim_2") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("gallery-alt-input-pim_1") as HTMLInputElement).disabled).toBe(true);
    finish(new Response("{}", { status: 500 }));
    await screen.findByTestId("gallery-save-error");
    expect(order()).toEqual(["gallery-image-pim_2", "gallery-image-pim_1"]);
    expect((screen.getByTestId("gallery-alt-input-pim_1") as HTMLInputElement).value).toBe("Front edited");
  });
  it("keeps stale edits reviewable and requires confirmed discard before reload", async () => {
    const retry = vi.fn(); const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "STALE_GALLERY" } }), { status: 409 }));
    const view = render(<ProductGallery {...props} onRetry={retry} />);
    fireEvent.click(screen.getByTestId("gallery-move-earlier-pim_2"));
    fireEvent.change(screen.getByTestId("gallery-alt-input-pim_1"), { target: { value: "Retain me" } });
    fireEvent.click(screen.getByTestId("gallery-save-button"));
    await screen.findByTestId("gallery-reload-button");
    expect((screen.getByTestId("gallery-save-button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("gallery-reload-button")); expect(retry).not.toHaveBeenCalled();
    expect(order()[0]).toBe("gallery-image-pim_2");
    expect((screen.getByTestId("gallery-alt-input-pim_1") as HTMLInputElement).value).toBe("Retain me");
    confirm.mockReturnValue(true); fireEvent.click(screen.getByTestId("gallery-reload-button")); expect(retry).toHaveBeenCalledOnce();
    view.rerender(<ProductGallery {...props} gallery={{ ...mockGallery, revision: "2" }} onRetry={retry} />);
    expect(order()[0]).toBe("gallery-image-pim_1");
    expect((screen.getByTestId("gallery-alt-input-pim_1") as HTMLInputElement).value).toBe("");
  });
  it("makes singleton boundary actions unavailable without dirtying the gallery", () => {
    render(<ProductGallery {...props} gallery={{ ...mockGallery, images: [mockGallery.images[0]] }} />);
    for (const direction of ["earlier", "later"]) {
      const button = screen.getByTestId(`gallery-move-${direction}-pim_1`);
      expect(button.getAttribute("aria-disabled")).toBe("true"); fireEvent.click(button);
    }
    expect(screen.queryByTestId("gallery-dirty-badge")).toBeNull();
  });
});

it("announces moved identity and a fresh sequence even for repeated destinations", () => {
  render(<ProductGallery productId="prd_123" gallery={mockGallery} loading={false} error={null} onRetry={() => {}} />);
  fireEvent.click(screen.getByTestId("gallery-move-earlier-pim_2"));
  const first = screen.getByTestId("gallery-move-status").textContent!;
  fireEvent.click(screen.getByTestId("gallery-move-earlier-pim_1"));
  const second = screen.getByTestId("gallery-move-status").textContent!;
  fireEvent.click(screen.getByTestId("gallery-move-earlier-pim_2"));
  const third = screen.getByTestId("gallery-move-status").textContent!;
  expect(first).toContain("pim_2"); expect(second).toContain("pim_1");
  expect(first).toMatch(/1:/); expect(second).toMatch(/2:/); expect(third).toMatch(/3:/);
  expect(new Set([first,second,third]).size).toBe(3);
});

describe("ProductGallery image removal UI", () => {
  it("renders remove button on each image card and opens accessible confirmation dialog", () => {
    render(<ProductGallery productId="prd_123" gallery={mockGallery} loading={false} error={null} onRetry={() => {}} />);
    const removeBtn1 = screen.getByTestId("gallery-remove-pim_1");
    const removeBtn2 = screen.getByTestId("gallery-remove-pim_2");
    expect(removeBtn1).toBeTruthy();
    expect(removeBtn2).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(removeBtn1);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("gallery-remove-dialog-title");
    expect(screen.getByText("تأكيد إزالة الصورة")).toBeTruthy();
    expect(screen.getByText(/فك ارتباط الصورة من أي متغيرات مرتبطة بها/)).toBeTruthy();
    expect(screen.getByText(/لن يتم حذف ملف الصورة الأصلي/)).toBeTruthy();
  });

  it("cancels removal when clicking 'إلغاء' without sending request and restores focus", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ProductGallery productId="prd_123" gallery={mockGallery} loading={false} error={null} onRetry={() => {}} />);

    const removeBtn = screen.getByTestId("gallery-remove-pim_1");
    removeBtn.focus();
    fireEvent.click(removeBtn);

    expect(screen.getByRole("dialog")).toBeTruthy();

    const cancelBtn = screen.getByTestId("gallery-remove-cancel");
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(removeBtn);
  });

  it("warns about unsaved edits in confirmation dialog when gallery is dirty", () => {
    render(<ProductGallery productId="prd_123" gallery={mockGallery} loading={false} error={null} onRetry={() => {}} />);

    const altInput = screen.getByTestId("gallery-alt-input-pim_1");
    fireEvent.change(altInput, { target: { value: "Dirty alt edit" } });

    fireEvent.click(screen.getByTestId("gallery-remove-pim_2"));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/لديك تعديلات غير محفوظة في المعرض/)).toBeTruthy();
  });

  it("sends DELETE request with expectedRevision and CSRF token upon confirmation", async () => {
    const onGalleryUpdate = vi.fn();
    const updatedGallery: GalleryDto = {
      ...mockGallery,
      revision: "2",
      primaryImageId: "pim_2",
      images: [mockGallery.images[1]],
      variantImages: [],
      publicationIssues: [],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, gallery: updatedGallery }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
        csrf="csrf_token_del"
        onGalleryUpdate={onGalleryUpdate}
      />
    );

    fireEvent.click(screen.getByTestId("gallery-remove-pim_1"));
    const confirmBtn = screen.getByTestId("gallery-remove-confirm");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/v1/admin/catalog/products/prd_123/images/pim_1");
    expect(init?.method).toBe("DELETE");
    expect((init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf_token_del");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ expectedRevision: "1" });

    await waitFor(() => {
      expect(onGalleryUpdate).toHaveBeenCalledWith(updatedGallery);
      expect(document.activeElement).toBe(screen.getByTestId("gallery-remove-pim_2"));
    });

    // Check announcement
    expect(screen.getByTestId("gallery-move-status").textContent).toContain("تمت إزالة الصورة");
  });

  it("dismisses removal confirmation dialog and restores focus when Escape key is pressed", () => {
    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    const removeBtn = screen.getByTestId("gallery-remove-pim_1");
    fireEvent.click(removeBtn);
    const dialog = screen.getByTestId("gallery-remove-dialog");
    expect(dialog).toBeTruthy();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByTestId("gallery-remove-dialog")).toBeNull();
    expect(document.activeElement).toBe(removeBtn);
  });

  it("displays empty gallery state and focuses upload input when the last image is removed", async () => {
    const singleImageGallery: GalleryDto = {
      ...mockGallery,
      images: [mockGallery.images[0]],
      primaryImageId: "pim_1",
    };
    const emptyGallery: GalleryDto = {
      ...mockGallery,
      revision: "2",
      images: [],
      primaryImageId: null,
      variantImages: [],
      publicationIssues: [],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, gallery: emptyGallery }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(
      <ProductGallery
        productId="prd_123"
        gallery={singleImageGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    fireEvent.click(screen.getByTestId("gallery-remove-pim_1"));
    fireEvent.click(screen.getByTestId("gallery-remove-confirm"));

    await waitFor(() => {
      expect(screen.getByText("لا توجد صور بعد.")).toBeTruthy();
    });

    const uploadInput = screen.getByTestId("gallery-upload-input");
    expect(document.activeElement).toBe(uploadInput);
  });

  it("preserves dirty local edits and displays conflict alert when removal fails with 409 STALE_GALLERY", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: "STALE_GALLERY", message: "Stale revision" } }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      )
    );

    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    const altInput = screen.getByTestId("gallery-alt-input-pim_1") as HTMLInputElement;
    fireEvent.change(altInput, { target: { value: "Dirty uncommitted alt" } });

    fireEvent.click(screen.getByTestId("gallery-remove-pim_2"));
    fireEvent.click(screen.getByTestId("gallery-remove-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("gallery-save-error")).toBeTruthy();
    });

    expect(screen.getByTestId("gallery-reload-button")).toBeTruthy();
    // Local dirty edits preserved
    expect(altInput.value).toBe("Dirty uncommitted alt");
    expect(screen.getByTestId("gallery-dirty-badge")).toBeTruthy();
  });

  it("coordinates busy state and disables controls while removal request is pending", async () => {
    const onBusyChange = vi.fn();
    let resolveDelete!: (res: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      () => new Promise((resolve) => { resolveDelete = resolve; })
    );

    render(
      <ProductGallery
        productId="prd_123"
        gallery={mockGallery}
        loading={false}
        error={null}
        onRetry={() => {}}
        onBusyChange={onBusyChange}
      />
    );

    fireEvent.click(screen.getByTestId("gallery-remove-pim_1"));
    fireEvent.click(screen.getByTestId("gallery-remove-confirm"));

    // In-flight
    expect(onBusyChange).toHaveBeenCalledWith(true);

    const uploadInput = screen.getByTestId("gallery-upload-input") as HTMLInputElement;
    expect(uploadInput.disabled).toBe(true);

    resolveDelete(
      new Response(JSON.stringify({ success: true, gallery: { ...mockGallery, revision: "2" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await waitFor(() => {
      expect(onBusyChange).toHaveBeenLastCalledWith(false);
    });
  });
});

