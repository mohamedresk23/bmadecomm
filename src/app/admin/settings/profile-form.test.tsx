/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { StoreProfileForm } from "./profile-form";
import type { AdminStoreProfileResponse } from "../../../modules/content/settings/contracts/store-profile";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mockInitialData: AdminStoreProfileResponse = {
  profile: {
    store_name: "متجر بيميد",
    legal_name: "شركة التجارة الإلكترونية المصرية",
    support_email: "support@bmadecomm.eg",
    support_phone: "+201012345678",
    address: "الدقي، الجيزة",
    logo_media_id: "media_logo_1",
    logo_url: "/uploads/media_logo_1.png",
    default_language: "ar-EG",
    currency: "EGP",
    currency_symbol: "ج.م",
    currency_exponent: 2,
    timezone: "Africa/Cairo",
    date_format: "YYYY-MM-DD",
    order_prefix: "ORD-",
    updated_at: "2026-10-07T12:00:00Z",
    updated_by: "user_owner_01",
  },
  currency_locked: false,
  currency_locked_reason: null,
  csrf: "mock_csrf_token_1234567890",
};

describe("StoreProfileForm Component", () => {
  it("renders all form fields populated from initial data", () => {
    render(<StoreProfileForm initialData={mockInitialData} />);

    expect((screen.getByLabelText(/اسم المتجر/i) as HTMLInputElement).value).toBe(
      "متجر بيميد"
    );
    expect(
      (screen.getByLabelText(/الاسم القانوني/i) as HTMLInputElement).value
    ).toBe("شركة التجارة الإلكترونية المصرية");
    expect(
      (screen.getByLabelText(/البريد الإلكتروني/i) as HTMLInputElement).value
    ).toBe("support@bmadecomm.eg");
    expect((screen.getByLabelText(/هاتف الدعم/i) as HTMLInputElement).value).toBe(
      "+201012345678"
    );
    expect(
      (screen.getByLabelText(/عملة التشغيل/i) as HTMLSelectElement).value
    ).toBe("EGP");
    expect(
      (screen.getByLabelText(/بادئة أرقام الطلبات/i) as HTMLInputElement).value
    ).toBe("ORD-");

    // Currency should be enabled when unlocked
    expect(
      (screen.getByLabelText(/عملة التشغيل/i) as HTMLSelectElement).disabled
    ).toBe(false);
  });

  it("disables currency select and renders lock badge when currency_locked is true", () => {
    const lockedData: AdminStoreProfileResponse = {
      ...mockInitialData,
      currency_locked: true,
      currency_locked_reason:
        "Orders exist in the store database. Operating currency cannot be modified.",
    };

    render(<StoreProfileForm initialData={lockedData} />);

    const currencySelect = screen.getByLabelText(/عملة التشغيل/i) as HTMLSelectElement;
    expect(currencySelect.disabled).toBe(true);

    // Expect lock badge
    expect(screen.getByText(/🔒 مقفلة/i)).toBeDefined();

    // Expect lock explanation help text
    expect(
      screen.getByText(/Orders exist in the store database/i)
    ).toBeDefined();
  });

  it("validates fields on submit and displays inline errors", async () => {
    render(<StoreProfileForm initialData={mockInitialData} />);

    const nameInput = screen.getByLabelText(/اسم المتجر/i);
    fireEvent.change(nameInput, { target: { value: "" } });

    const phoneInput = screen.getByLabelText(/هاتف الدعم/i);
    fireEvent.change(phoneInput, { target: { value: "invalid_phone" } });

    fireEvent.click(screen.getByRole("button", { name: /حفظ التغييرات/i }));

    await waitFor(() => {
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
      expect(screen.getByText(/Invalid Egyptian phone number/i)).toBeDefined();
    });
  });

  it("submits updated values with CSRF token and displays success toast", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        profile: {
          ...mockInitialData.profile,
          store_name: "متجر بيميد الجديد",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StoreProfileForm initialData={mockInitialData} />);

    const nameInput = screen.getByLabelText(/اسم المتجر/i);
    fireEvent.change(nameInput, { target: { value: "متجر بيميد الجديد" } });

    fireEvent.click(screen.getByRole("button", { name: /حفظ التغييرات/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/settings/profile",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            "X-CSRF-Token": "mock_csrf_token_1234567890",
          }),
        })
      );
      expect(screen.getByText(/تم حفظ إعدادات المتجر بنجاح/i)).toBeDefined();
    });
  });

  it("handles logo file upload interaction", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "media_uploaded_99", status: "pending" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Mock URL.createObjectURL
    if (!window.URL.createObjectURL) {
      window.URL.createObjectURL = vi.fn(() => "blob:http://localhost/logo-preview");
    } else {
      vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:http://localhost/logo-preview");
    }

    render(<StoreProfileForm initialData={mockInitialData} />);

    const fileInput = screen.getByLabelText(/اختر ملف الشعار/i) as HTMLInputElement;
    const file = new File(["dummy"], "logo.png", { type: "image/png" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/media/upload",
        expect.objectContaining({
          method: "POST",
        })
      );
      expect(screen.getByText(/تم رفع الشعار بنجاح/i)).toBeDefined();
    });
  });
});
