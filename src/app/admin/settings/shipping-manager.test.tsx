/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ShippingSettingsManager } from "./shipping-manager";
import type { ShippingZoneDto } from "../../../modules/content/settings/contracts/shipping";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mockZones: ShippingZoneDto[] = [
  {
    id: "zone-1",
    name_ar: "القاهرة الكبرى",
    name_en: "Greater Cairo",
    country_code: "EG",
    governorates: ["cairo", "giza"],
    is_active: true,
    created_at: "2026-10-07T12:00:00Z",
    updated_at: "2026-10-07T12:00:00Z",
    methods: [
      {
        id: "method-1",
        zone_id: "zone-1",
        name_ar: "شحن عادي",
        name_en: "Standard Delivery",
        cost_minor: 4500,
        cost_formatted: "45.00 ج.م",
        estimated_days_min: 1,
        estimated_days_max: 3,
        is_active: true,
        created_at: "2026-10-07T12:00:00Z",
        updated_at: "2026-10-07T12:00:00Z",
      },
      {
        id: "method-2",
        zone_id: "zone-1",
        name_ar: "شحن سريع في نفس اليوم",
        name_en: "Same Day Express",
        cost_minor: 7500,
        cost_formatted: "75.00 ج.م",
        estimated_days_min: 0,
        estimated_days_max: 1,
        is_active: true,
        created_at: "2026-10-07T12:00:00Z",
        updated_at: "2026-10-07T12:00:00Z",
      },
    ],
  },
  {
    id: "zone-2",
    name_ar: "الإسكندرية والساحل",
    name_en: "Alexandria & North Coast",
    country_code: "EG",
    governorates: ["alexandria", "matrouh"],
    is_active: true,
    created_at: "2026-10-07T12:00:00Z",
    updated_at: "2026-10-07T12:00:00Z",
    methods: [],
  },
];

describe("ShippingSettingsManager Component", () => {
  it("renders zones and their methods correctly after fetching", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        zones: mockZones,
        csrf: "mock_csrf_token_shipping_123",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ShippingSettingsManager />);

    expect(screen.getByText(/جاري تحميل مناطق وطرق الشحن/i)).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("القاهرة الكبرى")).toBeDefined();
      expect(screen.getByText("الإسكندرية والساحل")).toBeDefined();
      expect(screen.getByText("شحن عادي")).toBeDefined();
      expect(screen.getByText("45.00 ج.م")).toBeDefined();
      expect(screen.getByText("شحن سريع في نفس اليوم")).toBeDefined();
      expect(screen.getByText("75.00 ج.م")).toBeDefined();
    });
  });

  it("renders empty state when no zones exist", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        zones: [],
        csrf: "mock_csrf_token_shipping_123",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ShippingSettingsManager />);

    await waitFor(() => {
      expect(screen.getByText(/لا توجد مناطق شحن مهيأة/i)).toBeDefined();
      expect(screen.getByText(/إضافة أول منطقة شحن/i)).toBeDefined();
    });
  });

  it("disables governorates in Add Zone modal that are already assigned to active zones (AC-E03-02-02)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        zones: mockZones,
        csrf: "mock_csrf_token_shipping_123",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ShippingSettingsManager />);

    await waitFor(() => {
      expect(screen.getByText("القاهرة الكبرى")).toBeDefined();
    });

    // Click Add Zone button
    fireEvent.click(screen.getByTestId("add-zone-button"));

    // Check that modal is open
    expect(screen.getByText("إضافة منطقة شحن جديدة")).toBeDefined();

    // Cairo and Giza are assigned to zone-1 -> must be disabled!
    const cairoCheckbox = screen.getByTestId("gov-checkbox-cairo") as HTMLInputElement;
    const gizaCheckbox = screen.getByTestId("gov-checkbox-giza") as HTMLInputElement;
    expect(cairoCheckbox.disabled).toBe(true);
    expect(gizaCheckbox.disabled).toBe(true);

    // Alexandria and Matrouh are assigned to zone-2 -> must be disabled!
    const alexCheckbox = screen.getByTestId("gov-checkbox-alexandria") as HTMLInputElement;
    expect(alexCheckbox.disabled).toBe(true);

    // Aswan is unassigned -> must be enabled!
    const aswanCheckbox = screen.getByTestId("gov-checkbox-aswan") as HTMLInputElement;
    expect(aswanCheckbox.disabled).toBe(false);
  });

  it("validates required fields before submitting zone", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        zones: mockZones,
        csrf: "mock_csrf_token_shipping_123",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ShippingSettingsManager />);

    await waitFor(() => {
      expect(screen.getByText("القاهرة الكبرى")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("add-zone-button"));

    // Submit without filling
    fireEvent.click(screen.getByTestId("submit-zone-button"));

    await waitFor(() => {
      expect(screen.getByText(/الاسم العربي مطلوب/i)).toBeDefined();
    });
  });

  it("submits new zone with CSRF token and closes modal on success", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            zone: {
              id: "zone-new",
              name_ar: "منطقة الصعيد",
              name_en: "Upper Egypt",
              country_code: "EG",
              governorates: ["aswan"],
              is_active: true,
              methods: [],
            },
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          zones: mockZones,
          csrf: "mock_csrf_token_shipping_123",
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ShippingSettingsManager />);

    await waitFor(() => {
      expect(screen.getByText("القاهرة الكبرى")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("add-zone-button"));

    fireEvent.change(screen.getByTestId("zone-name-ar-input"), {
      target: { value: "منطقة الصعيد" },
    });
    fireEvent.change(screen.getByTestId("zone-name-en-input"), {
      target: { value: "Upper Egypt" },
    });

    // Check Aswan governorate
    const aswanCheckbox = screen.getByTestId("gov-checkbox-aswan");
    fireEvent.click(aswanCheckbox);

    // Submit
    fireEvent.click(screen.getByTestId("submit-zone-button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/settings/shipping/zones",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-CSRF-Token": "mock_csrf_token_shipping_123",
          }),
          body: expect.stringContaining("منطقة الصعيد"),
        })
      );
      expect(screen.getByText(/تمت إضافة منطقة الشحن بنجاح/i)).toBeDefined();
    });
  });

  it("opens Add Method modal and converts pounds input to minor units", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            method: {
              id: "method-new",
              zone_id: "zone-1",
              name_ar: "توصيل اقتصادي",
              name_en: "Economy",
              cost_minor: 3000,
              cost_formatted: "30.00 ج.م",
              estimated_days_min: 3,
              estimated_days_max: 5,
              is_active: true,
            },
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          zones: mockZones,
          csrf: "mock_csrf_token_shipping_123",
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ShippingSettingsManager />);

    await waitFor(() => {
      expect(screen.getByText("القاهرة الكبرى")).toBeDefined();
    });

    // Click Add Method for zone-1
    fireEvent.click(screen.getByTestId("add-method-button-zone-1"));

    expect(screen.getByText("إضافة طريقة شحن جديدة")).toBeDefined();

    fireEvent.change(screen.getByTestId("method-name-ar-input"), {
      target: { value: "توصيل اقتصادي" },
    });
    fireEvent.change(screen.getByTestId("method-name-en-input"), {
      target: { value: "Economy" },
    });
    fireEvent.change(screen.getByTestId("method-cost-input"), {
      target: { value: "30.50" },
    });
    fireEvent.change(screen.getByTestId("method-days-min-input"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByTestId("method-days-max-input"), {
      target: { value: "5" },
    });

    fireEvent.click(screen.getByTestId("submit-method-button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/settings/shipping/methods",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-CSRF-Token": "mock_csrf_token_shipping_123",
          }),
          // 30.50 * 100 = 3050 minor units
          body: expect.stringContaining('"cost_minor":3050'),
        })
      );
      expect(screen.getByText(/تمت إضافة طريقة الشحن بنجاح/i)).toBeDefined();
    });
  });
});
