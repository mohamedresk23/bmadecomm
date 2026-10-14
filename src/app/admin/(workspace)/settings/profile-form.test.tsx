/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { StoreProfileForm } from "./profile-form";
import type { AdminStoreProfileResponse } from "../../../../modules/content/settings/contracts/store-profile";
import { randomBytes, randomUUID } from "node:crypto";
import { File as NodeFile } from "node:buffer";
import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { roles, sessions, staffAccounts, userRoles, users } from "../../../../db/schema";
import { setupTestDb } from "../../../../test-utils/db";
import { issueStaffSession } from "../../../../modules/identity/infrastructure/staff-sessions";
import { STAFF_SESSION_POLICY, staffConfig } from "../../../../modules/identity/infrastructure/staff-config";
import { encryptStaffSecret, newStaffSeed } from "../../../../modules/identity/infrastructure/staff-crypto";
import { GET } from "../../../api/v1/admin/settings/profile/route";
import { POST } from "../../../api/media/upload/route";
import { processAndSaveMedia } from "../../../../lib/media/upload";

vi.mock("../../../../lib/media/upload", () => ({ processAndSaveMedia: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
  it.each(["missing-token", "denied"])("resets file selection after %s so the same file can be retried", async (scenario) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetchMock);
    render(<StoreProfileForm initialData={{ ...mockInitialData, csrf: scenario === "missing-token" ? "" : mockInitialData.csrf }} />);
    const input = screen.getByLabelText(/اختر ملف الشعار/i) as HTMLInputElement;
    const file = new File(["fixture"], "logo.png", { type: "image/png" });
    for (let attempt = 0; attempt < 2; attempt++) {
      // Model the browser's selected filename; jsdom forbids setting a real
      // file-input value through its native setter.
      Object.defineProperty(input, "value", { configurable: true, writable: true, value: "C:\\fakepath\\logo.png" });
      fireEvent.change(input, { target: { files: [file] } });
      await screen.findByRole("alert");
      expect(input.value).toBe("");
      expect(fetchMock).toHaveBeenCalledTimes(scenario === "missing-token" ? 0 : attempt + 1);
      expect(screen.getByRole("img").getAttribute("src")).toBe(mockInitialData.profile.logo_url);
    }
  });
  it.each([false, true])("links profile session metadata to actual upload handler (wrong token: %s)", async (wrongToken) => {
    await setupTestDb();
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("STAFF_MFA_KEY", randomBytes(32).toString("base64"));
    const userId = randomUUID();
    const config = staffConfig();
    await db.insert(users).values({ id: userId, email: `${userId}@example.test`, role: "staff", name: "Logo fixture", phone: "01000000000", passwordHash: "fixture" });
    try {
      await db.insert(staffAccounts).values({ userId, mfaEnrolledAt: new Date(), mfaSeed: encryptStaffSecret(newStaffSeed(), config.key, userId, "mfa") });
      await db.insert(roles).values({ key: "owner" }).onConflictDoNothing();
      await db.insert(userRoles).values({ userId, roleKey: "owner" });
      const issued = await issueStaffSession(db, userId, STAFF_SESSION_POLICY);
      if (!issued) throw new Error("Session issuance failed");
      const metadataResponse = await GET(new Request(`${config.origin}/api/v1/admin/settings/profile`, { headers: { Cookie: `__Host-staff-session=${issued.token}` } }));
      expect(metadataResponse.status).toBe(200);
      const metadata = await metadataResponse.json();
      vi.mocked(processAndSaveMedia).mockReset().mockResolvedValue({ id: "linked-logo", status: "pending" });
      const statuses: number[] = [];
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        expect(headers.get("X-CSRF-Token")).toBe(metadata.csrf);
        headers.set("Cookie", `__Host-staff-session=${issued.token}`);
        headers.set("Origin", config.origin);
        if (wrongToken) headers.set("X-CSRF-Token", "wrong-token");
        expect((init.body as FormData).get("file")).toBeInstanceOf(File);
        headers.set("Content-Type", "multipart/form-data; boundary=logo-fixture");
        const body = '--logo-fixture\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\nfixture\r\n--logo-fixture--\r\n';
        const req = new Request(`${config.origin}/api/media/upload`, { method: "POST", headers, body });
        // jsdom's browser File is used by the UI. Node's multipart parser
        // requires its own File brand while executing the real server route.
        const browserFile = globalThis.File;
        vi.stubGlobal("File", NodeFile);
        let response: Response;
        try { response = await POST(req); }
        finally { vi.stubGlobal("File", browserFile); }
        statuses.push(response.status);
        return response;
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:linked-logo");
      render(<StoreProfileForm initialData={{ ...mockInitialData, csrf: metadata.csrf }} />);
      fireEvent.change(screen.getByLabelText(/اسم المتجر/i), { target: { value: "Unsaved linked name" } });
      fireEvent.change(screen.getByLabelText(/اختر ملف الشعار/i), { target: { files: [new File(["fixture"], "logo.png", { type: "image/png" })] } });
      await waitFor(() => expect(statuses).toEqual([wrongToken ? 403 : 200]));
      await screen.findByRole(wrongToken ? "alert" : "status");
      expect((screen.getByLabelText(/اسم المتجر/i) as HTMLInputElement).value).toBe("Unsaved linked name");
      expect(screen.getByRole("img").getAttribute("src")).toBe(wrongToken ? mockInitialData.profile.logo_url : "blob:linked-logo");
      expect(processAndSaveMedia).toHaveBeenCalledTimes(wrongToken ? 0 : 1);
    } finally {
      await db.delete(sessions).where(eq(sessions.userId, userId));
      await db.delete(userRoles).where(eq(userRoles.userId, userId));
      await db.delete(staffAccounts).where(eq(staffAccounts.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
      vi.restoreAllMocks();
    }
  });
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
          headers: { "X-CSRF-Token": mockInitialData.csrf },
        })
      );
      expect(screen.getByText(/تم رفع الشعار بنجاح/i)).toBeDefined();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img").getAttribute("src")).toBe("blob:http://localhost/logo-preview");
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ profile: mockInitialData.profile }) });
    fireEvent.click(screen.getByRole("button", { name: /حفظ التغييرات/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).logo_media_id).toBe("media_uploaded_99");
  });

  it("uses current CSRF metadata loaded from the profile GET", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...mockInitialData, csrf: "loaded-session-csrf" }) })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    vi.stubGlobal("fetch", fetchMock);
    render(<StoreProfileForm />);
    const input = await screen.findByLabelText(/اختر ملف الشعار/i);
    fireEvent.change(input, { target: { files: [new File(["fixture"], "logo.png", { type: "image/png" })] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/media/upload", expect.objectContaining({
      headers: { "X-CSRF-Token": "loaded-session-csrf" },
    })));
    await screen.findByRole("alert");
  });

  it.each([401, 403])("preserves entered profile and prior logo after denied upload (%s)", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status });
    vi.stubGlobal("fetch", fetchMock);
    render(<StoreProfileForm initialData={mockInitialData} />);
    fireEvent.change(screen.getByLabelText(/اسم المتجر/i), { target: { value: "Unsaved name" } });
    fireEvent.change(screen.getByLabelText(/اختر ملف الشعار/i), {
      target: { files: [new File(["fixture"], "logo.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/أعد تحميل الصفحة أو سجل الدخول/));
    expect((screen.getByLabelText(/اسم المتجر/i) as HTMLInputElement).value).toBe("Unsaved name");
    expect(screen.getByRole("img").getAttribute("src")).toBe(mockInitialData.profile.logo_url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Saving after a denied upload must retain the existing media identifier.
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ profile: mockInitialData.profile }) });
    fireEvent.click(screen.getByRole("button", { name: /حفظ التغييرات/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).logo_media_id).toBe(mockInitialData.profile.logo_media_id);
  });

  it("blocks upload without CSRF metadata and preserves local state", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<StoreProfileForm initialData={{ ...mockInitialData, csrf: "" }} />);
    fireEvent.change(screen.getByLabelText(/اسم المتجر/i), { target: { value: "Unsaved name" } });
    fireEvent.change(screen.getByLabelText(/اختر ملف الشعار/i), {
      target: { files: [new File(["fixture"], "logo.png", { type: "image/png" })] },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/أعد تحميل الصفحة أو سجل الدخول/);
    expect((screen.getByLabelText(/اسم المتجر/i) as HTMLInputElement).value).toBe("Unsaved name");
    expect(screen.getByRole("img").getAttribute("src")).toBe(mockInitialData.profile.logo_url);
  });
});
