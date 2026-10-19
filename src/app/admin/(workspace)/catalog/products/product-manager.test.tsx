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
import { GET as galleryGet } from "../../../../api/v1/admin/catalog/products/[id]/images/route";
import { GET as publicList } from "../../../../api/v1/store/products/route";
import { GET as publicDetail } from "../../../../api/v1/store/products/[id]/route";
import { getProductById } from "../../../../../modules/catalog/products/application/product-service";

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
    const id = url.split("/")[6];
    const context = { params: Promise.resolve({ id }) };
    if (url.endsWith("/images")) {
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
  it("saves a generated matrix, reloads, edits, reloads again, and isolates public reads", async () => {
    await connect();
    const view = render(<ProductManager />); await ready();
    expect(screen.getByText("لا توجد مسودات بعد.")).toBeDefined();
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
