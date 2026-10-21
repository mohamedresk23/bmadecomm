/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProductPublication } from "./product-publication";
import { ApiClient, ClientApiError } from "../../../../../shared/api/client";
import { ProductDto } from "../../../../../modules/catalog/products/contracts/product";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const product = { id: "one", status: "draft" } as ProductDto;
const props = { product, csrf: "csrf", revision: 0, dirty: false, blocked: false, onBusyChange: vi.fn(), onTransition: vi.fn() };
it("explains saving before assessing a new product", () => {
  const fetch = vi.spyOn(ApiClient, "fetch"); render(<ProductPublication {...props} product={null} />);
  expect(screen.getByText(/احفظ المنتج أولاً/)).toBeTruthy(); expect(fetch).not.toHaveBeenCalled();
});
it("focuses persisted variant and image issue controls", async () => {
  vi.spyOn(ApiClient, "fetch").mockResolvedValue({ isReady: false, issues: [{ field: "variants.saved-id.sku", code: "MISSING_SKU" }, { field: "gallery.image-id.altText", code: "MISSING_ALT_TEXT" }] });
  render(<><input id="variant-saved-id-sku" /><input id="alt-text-image-id" /><ProductPublication {...props} /></>);
  fireEvent.click(await screen.findByText("أدخل رمز SKU")); expect(document.activeElement?.id).toBe("variant-saved-id-sku");
  fireEvent.click(screen.getByText("أدخل النص البديل للصورة")); expect(document.activeElement?.id).toBe("alt-text-image-id");
});
it("requires clean work and confirmation, posts empty JSON with CSRF, adopts server state", async () => {
  const next = { ...product, status: "published" }; const onTransition = vi.fn();
  const fetch = vi.spyOn(ApiClient, "fetch").mockResolvedValueOnce({ isReady: true, issues: [] }).mockResolvedValueOnce({ csrf: "current-session" }).mockResolvedValueOnce({ product: next, csrf: "next-csrf" });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const view = render(<ProductPublication {...props} dirty onTransition={onTransition} />);
  await screen.findByText("المنتج جاهز للنشر."); expect((screen.getByRole("button", {name:"نشر المنتج"}) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<ProductPublication {...props} onTransition={onTransition} />);
  fireEvent.click(screen.getByRole("button", {name:"نشر المنتج"})); expect(fetch).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true); fireEvent.click(screen.getByRole("button", {name:"نشر المنتج"}));
  await waitFor(() => expect(onTransition).toHaveBeenCalledWith(next, "next-csrf"));
  expect(fetch).toHaveBeenLastCalledWith("/api/catalog/products/one/publish", expect.objectContaining({ method: "POST", body: "{}", headers: expect.objectContaining({"X-CSRF-Token":"current-session"}) }));
});
it("ignores an out-of-order assessment for a different product", async () => {
  let finish!: (value: unknown) => void;
  vi.spyOn(ApiClient, "fetch").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({isReady:false,issues:[{field:"name",code:"MISSING_NAME"}]});
  const view = render(<ProductPublication {...props} />);
  expect(screen.getByRole("region", { name: "نشر المنتج" }).getAttribute("aria-busy")).toBe("true");
  view.rerender(<ProductPublication {...props} product={{...product,id:"two"}} />);
  await screen.findByText("أدخل اسم المنتج"); finish({isReady:true,issues:[]});
  expect(screen.getByRole("region", { name: "نشر المنتج" }).getAttribute("aria-busy")).toBe("false");
  await waitFor(() => expect(screen.queryByText("المنتج جاهز للنشر.")).toBeNull());
});
it("replaces advisory readiness with transaction blockers", async () => {
  vi.spyOn(window,"confirm").mockReturnValue(true);
  const err = new ClientApiError(422,{error:{code:"PUBLICATION_READINESS_FAILED",message:"blocked",details:[{field:"slug",message:"duplicate"}]}});
  vi.spyOn(ApiClient,"fetch").mockResolvedValueOnce({isReady:true,issues:[]}).mockResolvedValueOnce({csrf:"current"}).mockRejectedValueOnce(err);
  render(<ProductPublication {...props} />); await screen.findByText("المنتج جاهز للنشر."); fireEvent.click(screen.getByRole("button",{name:"نشر المنتج"}));
  await screen.findByText("duplicate"); expect((screen.getByRole("button",{name:"نشر المنتج"}) as HTMLButtonElement).disabled).toBe(true);
});
it("unpublishes with duplicate protection and retains retry after network or session failure", async () => {
  vi.spyOn(window,"confirm").mockReturnValue(true);
  let finish!: (value: unknown) => void;
  const onBusyChange=vi.fn(),onTransition=vi.fn();
  const fetch=vi.spyOn(ApiClient,"fetch").mockRejectedValueOnce(new ClientApiError(401,{error:{code:"UNAUTHORIZED",message:"expired"}})).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({csrf:"new-login-token"}).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  render(<ProductPublication {...props} product={{...product,status:"published"}} onBusyChange={onBusyChange} onTransition={onTransition}/>);
  fireEvent.click(screen.getByRole("button",{name:"إلغاء النشر"})); await screen.findByRole("link",{name:"سجل الدخول ثم أعد المحاولة"});
  fireEvent.click(screen.getByRole("button",{name:"إلغاء النشر"})); await waitFor(()=>expect(screen.queryByRole("link")).toBeNull());
  fireEvent.click(screen.getByRole("button",{name:"إلغاء النشر"})); expect((screen.getByRole("button",{name:"جارٍ التنفيذ…"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"جارٍ التنفيذ…"})); await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(4));
  expect(fetch).toHaveBeenNthCalledWith(3,"/api/v1/admin/catalog/products/one",{cache:"no-store"});
  expect(fetch).toHaveBeenLastCalledWith("/api/catalog/products/one/unpublish",expect.objectContaining({headers:expect.objectContaining({"X-CSRF-Token":"new-login-token"})}));
  finish({product,csrf:"next"}); await waitFor(()=>expect(onTransition).toHaveBeenCalledWith(product,"next"));
  expect(onBusyChange.mock.calls).toEqual([[true],[false],[true],[false],[true],[false]]);
});
it("disables publication during external mutations or unsaved gallery changes", async()=>{
  vi.spyOn(ApiClient,"fetch").mockResolvedValue({isReady:true,issues:[]});
  const view=render(<ProductPublication {...props} blocked/>);await screen.findByText("المنتج جاهز للنشر.");
  expect((screen.getByRole("button",{name:"نشر المنتج"}) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<ProductPublication {...props} dirty/>);expect((screen.getByRole("button",{name:"نشر المنتج"}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("احفظ تغييرات المنتج والصور قبل تغيير حالة النشر.")).toBeTruthy();
});
