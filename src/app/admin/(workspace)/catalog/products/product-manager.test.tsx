/** @vitest-environment jsdom */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { ProductManager } from "./product-manager";
import { setupTestDb } from "../../../../../test-utils/db";
import { catalogFixture } from "../../../../../test-utils/catalog";
import { db } from "../../../../../db";
import { auditEvents, media, productMedia, sessions, storeSettings } from "../../../../../db/schema";
import { GET, POST } from "../../../../api/v1/admin/catalog/products/route";
import { GET as detail, PUT } from "../../../../api/v1/admin/catalog/products/[id]/route";
import { GET as galleryGet, PUT as galleryPut } from "../../../../api/v1/admin/catalog/products/[id]/images/route";
import { GET as publicList } from "../../../../api/v1/store/products/route";
import { GET as publicDetail } from "../../../../api/v1/store/products/[id]/route";
import { getProductById } from "../../../../../modules/catalog/products/application/product-service";
import { GET as readinessGet } from "../../../../api/catalog/products/[id]/readiness/route";
import { POST as publish } from "../../../../api/catalog/products/[id]/publish/route";
import { POST as unpublish } from "../../../../api/catalog/products/[id]/unpublish/route";
import { GET as bySlug } from "../../../../api/public/products/by-slug/[slug]/route";

it("focuses persisted corrections, refreshes gallery readiness and completes the published metadata lifecycle", async () => {
  const transport = await connect();
  const created = await POST(fixture.request("POST", { name: "Lifecycle", description: "", slug: "lifecycle-original", categoryIds: [fixture.categoryId], variants: [{ sku: "LIFECYCLE", priceMinor: "0", attributes: {} }] }, undefined, { "Idempotency-Key": crypto.randomUUID() }));
  const product = (await created.json()).product;
  fixture.productIds.push(product.id);
  const mediaId = crypto.randomUUID(), imageId = crypto.randomUUID();
  await db.insert(media).values({ id: mediaId, filename: "lifecycle.png", mimeType: "image/png", size: 10, status: "pending" });
  await db.insert(productMedia).values({ id: imageId, productId: product.id, mediaId, sortOrder: 0, altText: "" });
  const resolve = (slug: string) => bySlug(new Request(`http://localhost:3000/api/public/products/by-slug/${slug}`), { params: Promise.resolve({ slug }) });
  async function reopen() {
    cleanup(); render(<ProductManager />);
    await screen.findByRole("button", { name: "تعديل Lifecycle" });
    fireEvent.click(screen.getByRole("button", { name: "تعديل Lifecycle" }));
    await screen.findByText("تعديل المنتج المنشور");
    await waitFor(() => expect((screen.getByRole("button", { name: "إلغاء النشر" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("gallery-readonly-notice")).toBeTruthy();
    expect((screen.getByTestId(`gallery-alt-input-${imageId}`) as HTMLInputElement).disabled).toBe(true);
  }
  try {
    render(<ProductManager />); await screen.findByRole("button", { name: "تعديل Lifecycle" });
    fireEvent.click(screen.getByRole("button", { name: "تعديل Lifecycle" }));
    await screen.findByTestId(`gallery-alt-input-${imageId}`);
    fireEvent.click(await screen.findByText("أدخل وصف المنتج")); expect(document.activeElement).toBe(screen.getByLabelText("الوصف"));
    fireEvent.click(screen.getByText("أدخل سعراً موجباً")); expect(document.activeElement).toBe(screen.getByLabelText("السعر 1"));
    fireEvent.click(screen.getByText("أدخل النص البديل للصورة")); expect(document.activeElement).toBe(screen.getByTestId(`gallery-alt-input-${imageId}`));
    expect((await resolve(product.slug)).status).toBe(404);
    change("الوصف", "Lifecycle description"); change("السعر 1", "2.00");
    fireEvent.submit(screen.getByLabelText("SKU 1").closest("form")!); await screen.findByText("تم حفظ المسودة بنجاح.");
    const before = transport.mock.calls.filter(([url]) => url.endsWith("/readiness")).length;
    fireEvent.change(screen.getByTestId(`gallery-alt-input-${imageId}`), { target: { value: "Accessible image" } });
    fireEvent.click(screen.getByTestId("gallery-save-button")); await screen.findByTestId("gallery-save-success");
    await screen.findByText("المنتج جاهز للنشر.");
    expect(transport.mock.calls.filter(([url]) => url.endsWith("/readiness")).length).toBeGreaterThan(before);
    await waitFor(() => expect((screen.getByRole("button", { name: "نشر المنتج" }) as HTMLButtonElement).disabled).toBe(false));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "نشر المنتج" })); await screen.findByText("حالة المنتج: منشور");
    await waitFor(() => expect((screen.getByRole("button", { name: "إلغاء النشر" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("gallery-readonly-notice").textContent).toContain("ألغِ النشر أولًا");
    const publishedControls = ["gallery-upload-input", "gallery-upload-button", "gallery-save-button", `gallery-alt-input-${imageId}`, `gallery-remove-${imageId}`, `gallery-move-earlier-${imageId}`, `gallery-move-later-${imageId}`];
    for (const testId of publishedControls) expect((screen.getByTestId(testId) as HTMLInputElement | HTMLButtonElement).disabled).toBe(true);
    const variantSelect = screen.getByTestId(`variant-image-${product.variants[0].id}`);
    expect((variantSelect.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    expect((variantSelect as HTMLSelectElement).value).toBe("");
    const galleryWrites = () => transport.mock.calls.filter(([url, options]) => url.includes("/images") && ["POST", "PUT", "DELETE"].includes(options?.method ?? "GET")).length;
    const writesBeforePublishedInteractions = galleryWrites();
    fireEvent.change(screen.getByTestId(`gallery-alt-input-${imageId}`), { target: { value: "Must not become dirty" } });
    fireEvent.change(variantSelect, { target: { value: imageId } });
    expect((variantSelect as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByTestId("gallery-upload-input"), { target: { files: [new File(["fixture"], "fixture.png", { type: "image/png" })] } });
    for (const testId of publishedControls.filter(value => !value.includes("input"))) fireEvent.click(screen.getByTestId(testId));
    fireEvent.submit(screen.getByTestId("gallery-upload-input").closest("form")!);
    expect(galleryWrites()).toBe(writesBeforePublishedInteractions);
    expect(screen.queryByTestId("gallery-dirty-badge")).toBeNull();
    expect(screen.queryByTestId("gallery-remove-dialog")).toBeNull();
    expect((screen.getByTestId(`gallery-alt-input-${imageId}`) as HTMLInputElement).value).toBe("Accessible image");
    expect((screen.getByRole("button", { name: "إلغاء النشر" }) as HTMLButtonElement).disabled).toBe(false);
    expect((await resolve(product.slug)).status).toBe(200);
    expect((await publicDetail(new Request(`http://localhost:3000/api/v1/store/products/${product.id}`), { params: Promise.resolve({ id: product.id }) })).status).toBe(200);
    await reopen();
    change("الرابط (Slug)", "lifecycle-updated"); change("عنوان محركات البحث", "Persisted SEO"); change("وصف محركات البحث", "Persisted description");
    fireEvent.submit(screen.getByLabelText("SKU 1").closest("form")!); await screen.findByText("تم حفظ المسودة بنجاح.");
    const redirect = await resolve(product.slug);
    expect(redirect.status).toBe(301); expect(redirect.headers.get("Location")).toBe("/products/lifecycle-updated");
    expect((await resolve("lifecycle-updated")).status).toBe(200);
    await reopen();
    expect((screen.getByLabelText("عنوان محركات البحث") as HTMLInputElement).value).toBe("Persisted SEO");
    expect((screen.getByLabelText("وصف محركات البحث") as HTMLInputElement).value).toBe("Persisted description");
    change("عنوان محركات البحث", ""); change("وصف محركات البحث", "");
    fireEvent.submit(screen.getByLabelText("SKU 1").closest("form")!); await screen.findByText("تم حفظ المسودة بنجاح.");
    await reopen();
    expect((screen.getByLabelText("عنوان محركات البحث") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("وصف محركات البحث") as HTMLInputElement).value).toBe("");
    expect(await getProductById(db, product.id)).toMatchObject({ metaTitle: null, metaDescription: null });
    const normalTransport = transport.getMockImplementation()!;
    transport.mockImplementation(async (url, options) => url.endsWith("/unpublish") ? Response.json({ error: { code: "INTERNAL_SERVER_ERROR", message: "Unavailable" } }, { status: 503 }) : normalTransport(url, options));
    const writesBeforeFailedUnpublish = galleryWrites();
    fireEvent.click(screen.getByRole("button", { name: "إلغاء النشر" }));
    await screen.findByText("تعذر تغيير حالة النشر. راجع المتطلبات ثم أعد المحاولة؛ بياناتك محفوظة.");
    await waitFor(() => expect((screen.getByRole("button", { name: "إلغاء النشر" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("gallery-readonly-notice")).toBeTruthy();
    expect((screen.getByTestId(`gallery-alt-input-${imageId}`) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId(`gallery-alt-input-${imageId}`), { target: { value: "Still locked" } });
    fireEvent.submit(screen.getByTestId("gallery-upload-input").closest("form")!);
    expect(galleryWrites()).toBe(writesBeforeFailedUnpublish);
    expect(screen.queryByTestId("gallery-dirty-badge")).toBeNull();
    transport.mockImplementation(normalTransport);
    fireEvent.click(screen.getByRole("button", { name: "إلغاء النشر" })); await screen.findByText("حالة المنتج: مسودة");
    await waitFor(() => expect((screen.getByTestId(`gallery-alt-input-${imageId}`) as HTMLInputElement).disabled).toBe(false));
    expect(screen.queryByTestId("gallery-readonly-notice")).toBeNull();
    fireEvent.change(screen.getByTestId(`gallery-alt-input-${imageId}`), { target: { value: "Edited after unpublish" } });
    fireEvent.click(screen.getByTestId("gallery-save-button")); await screen.findByTestId("gallery-save-success");
    expect((await db.select().from(productMedia).where(eq(productMedia.id, imageId)))[0].altText).toBe("Edited after unpublish");
    expect((await resolve("lifecycle-updated")).status).toBe(404); expect((await resolve(product.slug)).status).toBe(404);
    expect((await publicDetail(new Request(`http://localhost:3000/api/v1/store/products/${product.id}`), { params: Promise.resolve({ id: product.id }) })).status).toBe(404);
  } finally {
    cleanup(); await db.delete(productMedia).where(eq(productMedia.id, imageId)); await db.delete(media).where(eq(media.id, mediaId));
  }
});

beforeAll(setupTestDb);
let fixture: Awaited<ReturnType<typeof catalogFixture>>;
afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (fixture) await fixture.cleanup(); });
async function connect() {
  fixture = await catalogFixture();
  const transport = vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
    const headers = new Headers(options?.headers);
    headers.set("Cookie", `__Host-staff-session=${fixture.token}`);
    headers.set("Origin", "http://localhost:3000");
    const req = new Request(new URL(url, "http://localhost:3000"), { ...options, headers });
    if (url.startsWith("/api/catalog/products/") && url.endsWith("/readiness")) return readinessGet(req, { params: Promise.resolve({ id: url.split("/")[4] }) });
    if (url.endsWith("/publish")) return publish(req, { params: Promise.resolve({ id: url.split("/")[4] }) });
    if (url.endsWith("/unpublish")) return unpublish(req, { params: Promise.resolve({ id: url.split("/")[4] }) });
    const id = url.split("/")[6];
    const context = { params: Promise.resolve({ id }) };
    if (url.endsWith("/images")) {
      if (options?.method === "PUT") return galleryPut(req,context);
      if (options?.method === "POST") return Response.json({success:true,gallery:{productId:id,revision:"1",primaryImageId:null,images:[],variantImages:[],publicationIssues:[]}}, {status:201});
      return galleryGet(req,context);
    }
    const response = options?.method === "POST" ? await POST(req) : options?.method === "PUT" ? await PUT(req, context) : id ? await detail(req, context) : await GET(req);
    if (options?.method === "POST" && response.status === 201) fixture.productIds.push((await response.clone().json()).product.id);
    return response;
  });
  vi.stubGlobal("fetch", transport);
  return transport;
}
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
async function ready() { await screen.findByText("إنشاء مسودة"); }
function enterSimple(sku = "UI-ONE") {
  change("اسم المنتج", "قميص"); change("الوصف", "قطن"); fireEvent.click(screen.getByLabelText("ملابس"));
  change("SKU 1", sku); change("السعر 1", "0.29"); change("سعر المقارنة 1", "1.00");
}
it("loads gallery after first save, passes CSRF to upload, applies gallery callback, and preserves form edits",async()=>{
  const transport=await connect();render(<ProductManager/>);await ready();enterSimple("FIRST-UPLOAD");
  fireEvent.submit(screen.getByLabelText("SKU 1").closest("form")!);
  await waitFor(()=>expect((screen.getByTestId("gallery-upload-input") as HTMLInputElement).disabled).toBe(false));
  const name=screen.getByLabelText("\u0627\u0633\u0645 \u0627\u0644\u0645\u0646\u062a\u062c") as HTMLInputElement;fireEvent.change(name,{target:{value:"Local unsaved edit"}});
  fireEvent.change(screen.getByTestId("gallery-upload-input"),{target:{files:[new File(["x"],"x.png",{type:"image/png"})]}});fireEvent.click(screen.getByTestId("gallery-upload-button"));
  await waitFor(()=>expect(transport.mock.calls.some(([url,options])=>url.endsWith("/images")&&options?.method==="POST")).toBe(true));
  const upload=transport.mock.calls.find(([url,options])=>url.endsWith("/images")&&options?.method==="POST")!;
  expect(new Headers(upload[1]?.headers).get("X-CSRF-Token")).toBeTruthy();
  await waitFor(()=>expect(screen.getByText(/1 \(0/)).toBeTruthy());expect(name.value).toBe("Local unsaved edit");
});

describe("ProductManager with real API handlers and migrated database", () => {
  it("clears the previous product gallery on a failed switch and adopts a successful retry without dirty state", async () => {
    const transport = await connect();
    const secondResponse = await POST(fixture.request("POST", { name: "Second", categoryIds: [fixture.categoryId], variants: [{ sku: "SECOND", priceMinor: "1", attributes: {} }] }, undefined, { "Idempotency-Key": crypto.randomUUID() }));
    const secondId = (await secondResponse.json()).product.id;
    fixture.productIds.push(secondId);
    render(<ProductManager />); await ready(); enterSimple("FIRST-SWITCH");
    fireEvent.submit(screen.getByLabelText("SKU 1").closest("form")!);
    await waitFor(() => expect((screen.getByTestId("gallery-upload-input") as HTMLInputElement).disabled).toBe(false));
    const firstId = fixture.productIds[1];
    for (const [productId, id] of [[firstId, "switch-first"], [secondId, "switch-second"]]) {
      await db.insert(media).values({ id, filename: `${id}.png`, mimeType: "image/png", size: 10, status: "pending" });
      await db.insert(productMedia).values({ id, productId, mediaId: id, sortOrder: 0, altText: id });
    }
    try {
      fireEvent.click(screen.getByRole("button", { name: "تعديل قميص" }));
      await screen.findByTestId("gallery-image-switch-first");
      const normal = transport.getMockImplementation()!;
      let fail = true;
      transport.mockImplementation((url, options) => url === `/api/v1/admin/catalog/products/${secondId}/images` && fail ? Promise.reject(new Error("Switch failed")) : normal(url, options));
      fireEvent.click(screen.getByRole("button", { name: "تعديل Second" }));
      await screen.findByText("تعذر تحميل صور المنتج. أعد المحاولة.");
      expect(screen.queryByTestId("gallery-image-switch-first")).toBeNull();
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.queryByTestId("gallery-dirty-badge")).toBeNull();
      fail = false;
      fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
      await screen.findByTestId("gallery-image-switch-second");
      expect(screen.queryByTestId("gallery-image-switch-first")).toBeNull();
      expect(screen.queryByTestId("gallery-dirty-badge")).toBeNull();
      expect((screen.getByRole("combobox").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
    } finally {
      for (const id of ["switch-first", "switch-second"]) {
        await db.delete(productMedia).where(eq(productMedia.id, id));
        await db.delete(media).where(eq(media.id, id));
      }
    }
  });
  it.each([["PUT", true], ["PUT", false], ["POST", true], ["POST", false]] as const)("blocks product actions during deferred gallery %s (success=%s) and restores them", async (method, success) => {
    const transport = await connect(); render(<ProductManager />); await ready(); enterSimple(`BUSY-${method}-${success}`);
    const form = screen.getByLabelText("SKU 1").closest("form")!;
    fireEvent.submit(form);
    await waitFor(() => expect((screen.getByTestId("gallery-upload-input") as HTMLInputElement).disabled).toBe(false));
    const productId = fixture.productIds[0], imageId = `busy-${method}-${success}`;
    await db.insert(media).values({ id: imageId, filename: `${imageId}.png`, mimeType: "image/png", size: 10, status: "pending" });
    await db.insert(productMedia).values({ id: imageId, productId, mediaId: imageId, sortOrder: 0, altText: "Saved" });
    try {
      fireEvent.click(screen.getByRole("button", { name: "تعديل قميص" }));
      await screen.findByTestId(`gallery-alt-input-${imageId}`);
      const normal = transport.getMockImplementation()!;
      const snapshot = await (await normal(`/api/v1/admin/catalog/products/${productId}/images`)).json();
      let complete!: (response: Response) => void;
      const pending = new Promise<Response>(resolve => { complete = resolve; });
      transport.mockImplementation((url, options) => url.endsWith("/images") && options?.method === method ? pending : normal(url, options));
      if (method === "PUT") {
        fireEvent.change(screen.getByTestId(`gallery-alt-input-${imageId}`), { target: { value: "Pending" } });
        fireEvent.click(screen.getByTestId("gallery-save-button"));
      } else {
        fireEvent.change(screen.getByTestId("gallery-upload-input"), { target: { files: [new File(["image"], "image.png", { type: "image/png" })] } });
        fireEvent.click(screen.getByTestId("gallery-upload-button"));
      }
      const productActions = () => [screen.getByRole("button", { name: "حفظ المسودة" }), screen.getByRole("button", { name: "منتج جديد" }), screen.getByRole("button", { name: "تعديل قميص" })] as HTMLButtonElement[];
      await waitFor(() => expect(productActions().every(button => button.disabled)).toBe(true));
      const productWrites = () => transport.mock.calls.filter(([url, options]) => !url.endsWith("/images") && ["PUT", "POST"].includes(options?.method ?? "")).length;
      const before = productWrites();
      fireEvent.submit(form);
      expect(productWrites()).toBe(before);
      complete(Response.json(success ? snapshot : { error: { message: "Gallery failed" } }, { status: success ? 200 : 503 }));
      await waitFor(() => expect(productActions().every(button => !button.disabled)).toBe(true));
      expect(productWrites()).toBe(before);
    } finally {
      await db.delete(productMedia).where(eq(productMedia.id, imageId));
      await db.delete(media).where(eq(media.id, imageId));
    }
  });
  it("retains local gallery order and descriptions when saving unrelated product fields", async () => {
    const transport = await connect(); render(<ProductManager />); await ready(); enterSimple("GALLERY-PRODUCT-SAVE");
    fireEvent.submit(screen.getByLabelText("SKU 1").closest("form")!);
    await waitFor(() => expect((screen.getByTestId("gallery-upload-input") as HTMLInputElement).disabled).toBe(false));
    const productId = fixture.productIds[0];
    const ids = ["product-save-gallery-a", "product-save-gallery-b"];
    for (const [index, id] of ids.entries()) {
      await db.insert(media).values({ id, filename: `${id}.png`, mimeType: "image/png", size: 10, status: "pending" });
      await db.insert(productMedia).values({ id, productId, mediaId: id, sortOrder: index, altText: `Saved ${id}` });
    }
    try {
      fireEvent.click(screen.getByRole("button", { name: "تعديل قميص" }));
      await screen.findByTestId(`gallery-alt-input-${ids[0]}`);
      fireEvent.click(screen.getByTestId(`gallery-move-earlier-${ids[1]}`));
      fireEvent.change(screen.getByTestId(`gallery-alt-input-${ids[0]}`), { target: { value: "Unsaved gallery description" } });
      change("الوصف", "Saved unrelated description");
      const before = transport.mock.calls.filter(([url]) => url.endsWith("/images")).length;
      fireEvent.submit(screen.getByLabelText("SKU 1").closest("form")!);
      await waitFor(() => expect((screen.getByRole("button", { name: "حفظ المسودة" }) as HTMLButtonElement).disabled).toBe(false));
      expect((await getProductById(db, productId)).description).toBe("Saved unrelated description");
      expect(transport.mock.calls.filter(([url]) => url.endsWith("/images"))).toHaveLength(before + 1);
      expect(screen.getAllByTestId(/^gallery-image-/).map(node => node.getAttribute("data-testid"))).toEqual([`gallery-image-${ids[1]}`, `gallery-image-${ids[0]}`]);
      expect((screen.getByTestId(`gallery-alt-input-${ids[0]}`) as HTMLInputElement).value).toBe("Unsaved gallery description");
      expect(screen.getByTestId("gallery-dirty-badge")).toBeTruthy();
    } finally {
      for (const id of ids) {
        await db.delete(productMedia).where(eq(productMedia.id, id));
        await db.delete(media).where(eq(media.id, id));
      }
    }
  });
  it("saves a generated matrix, reloads, edits, reloads again, and isolates public reads", async () => {
    await connect();
    const view = render(<ProductManager />); await ready();
    expect(screen.getByText("لا توجد منتجات بعد.")).toBeDefined();
    change("اسم المنتج", "قميص"); change("الوصف", "قطن"); fireEvent.click(screen.getByLabelText("ملابس"));
    change("أبعاد المتغيرات", "Color: Red, Blue\nSize: M"); fireEvent.click(screen.getByRole("button", { name: "توليد المتغيرات" }));
    change("SKU 1", "UI-RED"); change("السعر 1", "0.29"); change("سعر المقارنة 1", "1.00");
    change("SKU 2", "UI-BLUE"); change("السعر 2", "19.99");
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" }));
    await screen.findByText("تم حفظ المسودة بنجاح.");
    const productId = fixture.productIds[0];
    const persisted = await getProductById(db, productId);
    expect(persisted).toMatchObject({ name: "قميص", description: "قطن", status: "draft", categoryIds: [fixture.categoryId], variants: [
      { sku: "UI-RED", priceMinor: "29", comparePriceMinor: "100", attributes: { color: "red", size: "m" } },
      { sku: "UI-BLUE", priceMinor: "1999", attributes: { color: "blue", size: "m" } },
    ] });
    view.unmount(); render(<ProductManager />);
    await screen.findByRole("button", { name: "تعديل قميص" }); fireEvent.click(screen.getByRole("button", { name: "تعديل قميص" }));
    await waitFor(() => expect((screen.getByLabelText("السعر 1") as HTMLInputElement).value).toBe("0.29"));
    expect((screen.getByLabelText("الوصف") as HTMLTextAreaElement).value).toBe("قطن");
    expect((screen.getByLabelText("ملابس") as HTMLInputElement).checked).toBe(true);
    change("اسم المنتج", "قميص معدل"); change("السعر 2", "20.01"); fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" }));
    await screen.findByText("تم حفظ المسودة بنجاح.");
    cleanup(); render(<ProductManager />); await screen.findByRole("button", { name: "تعديل قميص معدل" });
    fireEvent.click(screen.getByRole("button", { name: "تعديل قميص معدل" }));
    await waitFor(() => expect((screen.getByLabelText("السعر 2") as HTMLInputElement).value).toBe("20.01"));
    const edited = await getProductById(db, productId); expect(edited.variants.map(variant => variant.id)).toEqual(persisted.variants.map(variant => variant.id));
    expect(await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${productId}`))).toHaveLength(2);
    const publicResponse = await publicList(new Request("http://localhost:3000/api/v1/store/products"));
    expect((await publicResponse.json()).products.some((product: { id: string }) => product.id === productId)).toBe(false);
    expect((await publicDetail(new Request(`http://localhost:3000/api/v1/store/products/${productId}`), { params: Promise.resolve({ id: productId }) })).status).toBe(404);
  });
  it("keeps entered values on decimal errors, SKU conflicts and network failure, then permits retry", async () => {
    const transport = await connect(); render(<ProductManager />); await ready(); enterSimple();
    change("السعر 1", "0.001"); fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" }));
    await screen.findByText("صحح الأسعار المشار إليها."); expect((screen.getByLabelText("SKU 1") as HTMLInputElement).value).toBe("UI-ONE");
    expect(fixture.productIds).toHaveLength(0);
    change("السعر 1", "0.29"); transport.mockRejectedValueOnce(new Error("Network unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("Network unavailable");
    expect((screen.getByLabelText("اسم المنتج") as HTMLInputElement).value).toBe("قميص");
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
    fireEvent.click(screen.getByRole("button", { name: "منتج جديد" })); enterSimple(" ui-one ");
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByLabelText("SKU 1").getAttribute("aria-invalid")).toBe("true"));
    expect((screen.getByLabelText("اسم المنتج") as HTMLInputElement).value).toBe("قميص"); expect(fixture.productIds).toHaveLength(1);
    change("SKU 1", "UI-TWO"); fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح."); expect(fixture.productIds).toHaveLength(2);
  });
  it("prevents duplicate submission and preserves the form on expired session", async () => {
    const transport = await connect(); render(<ProductManager />); await ready(); enterSimple();
    await db.update(sessions).set({ idleExpiresAt: new Date(0) }).where(eq(sessions.id, fixture.sessionId));
    const callsBefore = transport.mock.calls.length;
    const form = screen.getByRole("button", { name: "حفظ المسودة" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    await screen.findByText(/انتهت الجلسة/);
    expect(transport.mock.calls.length).toBe(callsBefore + 1);
    expect((screen.getByLabelText("السعر 1") as HTMLInputElement).value).toBe("0.29");
    expect(screen.getByRole("link", { name: "تسجيل الدخول" })).toBeDefined(); expect(fixture.productIds).toHaveLength(0);
    await db.update(sessions).set({ idleExpiresAt: new Date(Date.now() + 60000) }).where(eq(sessions.id, fixture.sessionId));
    fireEvent.click(screen.getByRole("button", { name: "إعادة تحميل البيانات" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect((screen.getByLabelText("السعر 1") as HTMLInputElement).value).toBe("0.29");
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
  });
  it("recovers a response lost after commit with the same create key and one audit", async () => {
    const transport = await connect(); render(<ProductManager />); await ready(); enterSimple("LOST-RESPONSE");
    const normal = transport.getMockImplementation()!;
    transport.mockImplementationOnce(async (url, options) => { await normal(url, options); throw new Error("Response lost after commit"); });
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("Response lost after commit");
    expect(fixture.productIds).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
    expect(new Set(fixture.productIds).size).toBe(1);
    const posts = transport.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(new Headers(posts[0][1]?.headers).get("Idempotency-Key")).toBe(new Headers(posts[1][1]?.headers).get("Idempotency-Key"));
    expect(await db.select().from(auditEvents).where(eq(auditEvents.resource, `product:${fixture.productIds[0]}`))).toHaveLength(1);
  });
  it("blocks unapplied dimensions, cancels destructive regeneration and retains populated matching rows and IDs", async () => {
    await connect(); render(<ProductManager />); await ready(); enterSimple("RETAINED");
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
    const original = await getProductById(db, fixture.productIds[0]);
    change("أبعاد المتغيرات", "Color: Red");
    expect((screen.getByRole("button", { name: "حفظ المسودة" }) as HTMLButtonElement).disabled).toBe(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "توليد المتغيرات" }));
    expect((screen.getByLabelText("SKU 1") as HTMLInputElement).value).toBe("RETAINED");
    expect((screen.getByLabelText("السعر 1") as HTMLInputElement).value).toBe("0.29");
    expect((screen.getByLabelText("سعر المقارنة 1") as HTMLInputElement).value).toBe("1.00");
    change("أبعاد المتغيرات", ""); fireEvent.click(screen.getByRole("button", { name: "توليد المتغيرات" }));
    change("اسم المنتج", "Retained after regenerate"); fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
    expect((await getProductById(db, original.id)).variants).toEqual(original.variants);
    change("أبعاد المتغيرات", "Color: Red"); confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "توليد المتغيرات" }));
    change("SKU 1", "RED"); change("السعر 1", "1.23"); change("سعر المقارنة 1", "2.00");
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
    const matrix = await getProductById(db, original.id);
    change("أبعاد المتغيرات", "color: red, blue"); fireEvent.click(screen.getByRole("button", { name: "توليد المتغيرات" }));
    expect((screen.getByLabelText("SKU 1") as HTMLInputElement).value).toBe("RED");
    expect((screen.getByLabelText("السعر 1") as HTMLInputElement).value).toBe("1.23");
    expect((screen.getByLabelText("سعر المقارنة 1") as HTMLInputElement).value).toBe("2.00");
    change("SKU 2", "BLUE"); change("السعر 2", "2.34"); fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
    expect((await getProductById(db, original.id)).variants[0].id).toBe(matrix.variants[0].id);
  });
  it("preserves unsaved form when New or Edit replacement is cancelled", async () => {
    await connect(); render(<ProductManager />); await ready(); enterSimple("CANCEL");
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
    change("اسم المنتج", "Unsaved name"); vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "منتج جديد" }));
    expect((screen.getByLabelText("اسم المنتج") as HTMLInputElement).value).toBe("Unsaved name");
    fireEvent.click(screen.getByRole("button", { name: "تعديل قميص" }));
    expect((screen.getByLabelText("اسم المنتج") as HTMLInputElement).value).toBe("Unsaved name");
    expect((screen.getByLabelText("SKU 1") as HTMLInputElement).value).toBe("CANCEL");
  });
  it("prompts confirmation and preserves state when dirty gallery edits alone are cancelled on New Product or Edit", async () => {
    await connect(); render(<ProductManager />); await ready(); enterSimple("GALLERY-DIRTY");
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
    const productId = fixture.productIds[0];
    const mediaId = "med_dirty_1";
    const pimId = "pim_dirty_1";
    await db.insert(media).values({ id: mediaId, filename: "dirty.png", mimeType: "image/png", size: 1024, status: "pending" });
    await db.insert(productMedia).values({ id: pimId, productId, mediaId, sortOrder: 0, altText: "Saved Alt" });
    try {
      fireEvent.click(screen.getByRole("button", { name: "تعديل قميص" }));
      await screen.findByTestId(`gallery-alt-input-${pimId}`);
      const altInput = screen.getByTestId(`gallery-alt-input-${pimId}`) as HTMLInputElement;
      expect(altInput.value).toBe("Saved Alt");
      fireEvent.change(altInput, { target: { value: "Dirty Unsaved Alt Text" } });
      expect(screen.getByTestId("gallery-dirty-badge")).toBeTruthy();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      fireEvent.click(screen.getByRole("button", { name: "منتج جديد" }));
      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(altInput.value).toBe("Dirty Unsaved Alt Text");
      expect((screen.getByLabelText("اسم المنتج") as HTMLInputElement).value).toBe("قميص");
      fireEvent.click(screen.getByRole("button", { name: "تعديل قميص" }));
      expect(confirmSpy).toHaveBeenCalledTimes(2);
      expect(altInput.value).toBe("Dirty Unsaved Alt Text");
      expect((screen.getByLabelText("اسم المنتج") as HTMLInputElement).value).toBe("قميص");
    } finally {
      await db.delete(productMedia).where(eq(productMedia.id, pimId));
      await db.delete(media).where(eq(media.id, mediaId));
    }
  });
  it("preserves prices on metadata refresh and requires explicit currency review", async () => {
    await connect(); render(<ProductManager />); await ready(); enterSimple("CURRENCY-UI");
    await db.update(storeSettings).set({ currency: "KWD", currencyExponent: 3 }).where(eq(storeSettings.id, "default"));
    try {
      fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByRole("alert");
      fireEvent.click(screen.getByRole("button", { name: "إعادة تحميل البيانات" }));
      await screen.findByText(/تغير سياق الأسعار من EGP/);
      expect((screen.getByLabelText("السعر 1") as HTMLInputElement).value).toBe("0.29");
      expect((screen.getByRole("button", { name: "حفظ المسودة" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "راجعت الأسعار وأوافق على العملة الجديدة" }));
      fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
      expect((await getProductById(db, fixture.productIds[0])).variants[0]).toMatchObject({ priceMinor: "290", currency: "KWD", currencyScale: 3 });
    } finally { await db.update(storeSettings).set({ currency: "EGP", currencyExponent: 2 }).where(eq(storeSettings.id, "default")); }
  });
  it("shows persisted old currency when loading a draft and requires review before resaving", async () => {
    await connect(); render(<ProductManager />); await ready(); enterSimple("LOADED-CURRENCY");
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
    cleanup();
    await db.update(storeSettings).set({ currency: "KWD", currencyExponent: 3 }).where(eq(storeSettings.id, "default"));
    try {
      render(<ProductManager />); await screen.findByRole("button", { name: "تعديل قميص" });
      fireEvent.click(screen.getByRole("button", { name: "تعديل قميص" })); await screen.findByText(/تغير سياق الأسعار من EGP/);
      expect((screen.getByLabelText("السعر 1") as HTMLInputElement).value).toBe("0.29");
      expect((screen.getByRole("button", { name: "حفظ المسودة" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "راجعت الأسعار وأوافق على العملة الجديدة" }));
      fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
      expect((await getProductById(db, fixture.productIds[0])).variants[0]).toMatchObject({ priceMinor: "290", currency: "KWD", currencyScale: 3 });
    } finally { await db.update(storeSettings).set({ currency: "EGP", currencyExponent: 2 }).where(eq(storeSettings.id, "default")); }
  });
  it("summarizes nested errors accessibly and rotates create keys after payload changes", async () => {
    const transport = await connect(); render(<ProductManager />); await ready(); enterSimple("ERROR-SUMMARY");
    transport.mockResolvedValueOnce(Response.json({ error: { code: "UNPROCESSABLE_ENTITY", message: "Validation failed", details: [{ field: "variants.0.attributes.color", message: "Choose a valid color" }] } }, { status: 422 }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText(/Choose a valid color/);
    expect(screen.getByRole("list", { name: "تفاصيل أخطاء الحفظ" }).textContent).toContain("متغير 1 — الأبعاد");
    expect(screen.getByRole("alert").textContent).not.toContain("variants.0.attributes.color");
    change("SKU 1", "CHANGED-PAYLOAD");
    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
    const posts = transport.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(new Headers(posts[0][1]?.headers).get("Idempotency-Key")).not.toBe(new Headers(posts[1][1]?.headers).get("Idempotency-Key"));
  });
  it("recovers when currency changes and then reverts, with Arabic known validation messages", async () => {
    await connect(); render(<ProductManager />); await ready(); enterSimple("REVERTED-CURRENCY");
    change("السعر 1", "0.001"); fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" }));
    await screen.findByText("أدخل سعراً غير سالب لا يتجاوز 2 منازل عشرية.");
    expect(screen.getByRole("alert").textContent).not.toContain("Enter a nonnegative");
    change("السعر 1", "0.29");
    await db.update(storeSettings).set({ currency: "KWD", currencyExponent: 3 }).where(eq(storeSettings.id, "default"));
    try {
      fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByRole("alert");
      expect(screen.getByRole("alert").textContent).toContain("تغيرت عملة المتجر");
      fireEvent.click(screen.getByRole("button", { name: "إعادة تحميل البيانات" })); await screen.findByText(/تغير سياق الأسعار من EGP/);
      await db.update(storeSettings).set({ currency: "EGP", currencyExponent: 2 }).where(eq(storeSettings.id, "default"));
      // The review alert offers refresh even after the prior error has cleared.
      fireEvent.click(screen.getByRole("button", { name: "إعادة تحميل البيانات" }));
      await waitFor(() => expect(screen.queryByText(/تغير سياق الأسعار من EGP/)).toBeNull());
      expect((screen.getByLabelText("السعر 1") as HTMLInputElement).value).toBe("0.29");
      expect((screen.getByRole("button", { name: "حفظ المسودة" }) as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" })); await screen.findByText("تم حفظ المسودة بنجاح.");
    } finally { await db.update(storeSettings).set({ currency: "EGP", currencyExponent: 2 }).where(eq(storeSettings.id, "default")); }
  });
});
it("validates and persists slug/SEO through product writer, clears overrides, and guards metadata replacements", async () => {
  const transport = await connect(); render(<ProductManager />); await ready(); enterSimple("SEO-UI");
  change("الرابط (Slug)", "x".repeat(256)); change("عنوان محركات البحث", "x".repeat(71)); change("وصف محركات البحث", "x".repeat(161));
  fireEvent.submit(screen.getByLabelText("SKU 1").closest("form")!);
  await screen.findByText("صحح بيانات الرابط ومحركات البحث.");
  expect((screen.getByLabelText("عنوان محركات البحث") as HTMLInputElement).value).toHaveLength(71);
  expect(transport.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  change("الرابط (Slug)", "  Custom-Slug  "); change("عنوان محركات البحث", "عنوان مخصص"); change("وصف محركات البحث", "x".repeat(160));
  fireEvent.submit(screen.getByLabelText("SKU 1").closest("form")!); await screen.findByText("تم حفظ المسودة بنجاح.");
  const created = transport.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(JSON.parse(created[1]!.body as string)).toMatchObject({ slug: "custom-slug", metaTitle: "عنوان مخصص", metaDescription: "x".repeat(160) });
  await screen.findByText("أضف صورة للمنتج");
  change("عنوان محركات البحث", ""); change("وصف محركات البحث", "");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false); fireEvent.click(screen.getByRole("button", { name: "منتج جديد" }));
  expect(confirm).toHaveBeenCalled(); expect((screen.getByLabelText("الرابط (Slug)") as HTMLInputElement).value).toBe("custom-slug");
  fireEvent.submit(screen.getByLabelText("SKU 1").closest("form")!);
  await waitFor(() => expect(transport.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(true));
  const updated = transport.mock.calls.find(([, options]) => options?.method === "PUT")!;
  expect(JSON.parse(updated[1]!.body as string)).toMatchObject({metaTitle:null,metaDescription:null});
});
it("locks selection, product saving and gallery while publication is pending and updates server status",async()=>{
  const transport=await connect();const original=transport.getMockImplementation()!;
  let finish!: (response:Response)=>void;
  transport.mockImplementation(async(url,options)=>{
    if(url.endsWith("/readiness"))return Response.json({isReady:true,issues:[]});
    if(url.endsWith("/publish"))return new Promise(resolve=>{finish=resolve;});
    return original(url,options);
  });
  vi.spyOn(window,"confirm").mockReturnValue(true);
  render(<ProductManager/>);await ready();enterSimple("PUBLISH-LOCK");fireEvent.submit(screen.getByLabelText("SKU 1").closest("form")!);
  await screen.findByText("المنتج جاهز للنشر.");await waitFor(()=>expect((screen.getByRole("button",{name:"نشر المنتج"}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button",{name:"نشر المنتج"}));
  expect((screen.getByRole("button",{name:"منتج جديد"}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button",{name:"تعديل قميص"}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("اسم المنتج") as HTMLInputElement).disabled || screen.getByLabelText("اسم المنتج").closest("fieldset")?.disabled).toBe(true);
  expect((screen.getByTestId("gallery-upload-input") as HTMLInputElement).disabled).toBe(true);
  await waitFor(()=>expect(finish).toBeTypeOf("function"));
  const saved=await getProductById(db,fixture.productIds[0]);finish(Response.json({product:{...saved,status:"published",name:"Concurrent name",description:"Concurrent description",slug:"concurrent-slug",metaTitle:"Concurrent SEO",variants:saved.variants.map(row=>({...row,sku:"CONCURRENT-SKU"}))},csrf:"rotated"}));
  await screen.findByText("حالة المنتج: منشور");expect(screen.getByText("منشور")).toBeTruthy();
  expect((screen.getByLabelText("اسم المنتج") as HTMLInputElement).value).toBe("Concurrent name");
  expect((screen.getByLabelText("الوصف") as HTMLInputElement).value).toBe("Concurrent description");
  expect((screen.getByLabelText("الرابط (Slug)") as HTMLInputElement).value).toBe("concurrent-slug");
  expect((screen.getByLabelText("عنوان محركات البحث") as HTMLInputElement).value).toBe("Concurrent SEO");
  expect((screen.getByLabelText("SKU 1") as HTMLInputElement).value).toBe("CONCURRENT-SKU");
  expect(screen.queryByText("احفظ تغييرات المنتج والصور قبل تغيير حالة النشر.")).toBeNull();
  expect((screen.getByRole("button",{name:"منتج جديد"}) as HTMLButtonElement).disabled).toBe(false);
});
