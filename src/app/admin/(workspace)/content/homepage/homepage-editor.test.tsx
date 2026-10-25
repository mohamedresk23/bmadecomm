/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { HomepageEditor } from "./homepage-editor";
import { ApiClient, ClientApiError } from "../../../../../shared/api/client";

const mockInitialDraft = {
  success: true,
  draft: {
    revision: 2,
    updatedAt: "2026-10-22T10:00:00Z",
    updatedBy: "staff_1",
    sections: [
      {
        id: "sec-hero-1",
        type: "hero" as const,
        enabled: true,
        position: 0,
        productIds: ["prd_1"],
        categoryIds: ["cat_1"],
      },
      {
        id: "sec-best-1",
        type: "best_sellers" as const,
        enabled: true,
        position: 1,
        limit: 8,
      },
    ],
  },
  latestPublication: {
    version: 1,
    sourceDraftRevision: 1,
    publishedAt: "2026-10-22T08:00:00Z",
    publishedBy: "owner_1",
  },
  csrf: "mock_csrf_token_xyz",
};

describe("HomepageEditor Component (A-12)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads and displays draft revision and section cards", async () => {
    vi.spyOn(ApiClient, "fetch").mockResolvedValueOnce(mockInitialDraft);

    render(<HomepageEditor />);

    expect(screen.getByText(/جاري تحميل مسودة محتوى الصفحة الرئيسية/)).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText(/المراجعة الحالية: 2/)).toBeDefined();
      expect(screen.getByText(/منشور حالياً: الإصدار 1/)).toBeDefined();
      expect(screen.getByRole("heading", { name: "قسم البداية (Hero)" })).toBeDefined();
      expect(screen.getByRole("heading", { name: "الأكثر مبيعاً" })).toBeDefined();
    });
  });

  it("reorders sections using keyboard-accessible Move Down button without drag-and-drop", async () => {
    vi.spyOn(ApiClient, "fetch").mockResolvedValueOnce(mockInitialDraft);

    render(<HomepageEditor />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "قسم البداية (Hero)" })).toBeDefined();
    });

    // Before move: card 0 is hero, card 1 is best sellers
    const card0Before = screen.getByTestId("section-card-0");
    const card1Before = screen.getByTestId("section-card-1");
    expect(card0Before.textContent).toContain("قسم البداية (Hero)");
    expect(card1Before.textContent).toContain("الأكثر مبيعاً");

    // Click Move Down on the first section
    const moveDownButtons = screen.getAllByRole("button", { name: /تحريك.*لأسفل/ });
    fireEvent.click(moveDownButtons[0]);

    // After move: card 0 is best sellers, card 1 is hero
    const card0After = screen.getByTestId("section-card-0");
    const card1After = screen.getByTestId("section-card-1");
    expect(card0After.textContent).toContain("الأكثر مبيعاً");
    expect(card1After.textContent).toContain("قسم البداية (Hero)");
  });

  it("reorders sections using keyboard-accessible Move Up button", async () => {
    vi.spyOn(ApiClient, "fetch").mockResolvedValueOnce(mockInitialDraft);

    render(<HomepageEditor />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "الأكثر مبيعاً" })).toBeDefined();
    });

    // Click Move Up on the second section (using /تحريك قسم.*لأعلى/ to target section buttons specifically)
    const moveUpButtons = screen.getAllByRole("button", { name: /تحريك قسم.*لأعلى/ });
    fireEvent.click(moveUpButtons[1]);

    // After move: card 0 is best sellers
    const card0After = screen.getByTestId("section-card-0");
    expect(card0After.textContent).toContain("الأكثر مبيعاً");
  });

  it("toggles section enabled state", async () => {
    vi.spyOn(ApiClient, "fetch").mockResolvedValueOnce(mockInitialDraft);

    render(<HomepageEditor />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "قسم البداية (Hero)" })).toBeDefined();
    });

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(true);

    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0].checked).toBe(false);
  });

  it("adds a new approved section type", async () => {
    vi.spyOn(ApiClient, "fetch").mockResolvedValueOnce(mockInitialDraft);

    render(<HomepageEditor />);

    await waitFor(() => {
      expect(screen.getAllByTestId(/section-card-/)).toHaveLength(2);
    });

    // Select featured_categories and click Add
    const select = screen.getByLabelText(/إضافة قسم جديد:/);
    fireEvent.change(select, { target: { value: "featured_categories" } });

    const addButton = screen.getByRole("button", { name: /\+ إضافة القسم/ });
    fireEvent.click(addButton);

    expect(screen.getAllByTestId(/section-card-/)).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "تصنيفات مميزة" })).toBeDefined();
  });

  it("removes a section", async () => {
    vi.spyOn(ApiClient, "fetch").mockResolvedValueOnce(mockInitialDraft);

    render(<HomepageEditor />);

    await waitFor(() => {
      expect(screen.getAllByTestId(/section-card-/)).toHaveLength(2);
    });

    const deleteButtons = screen.getAllByRole("button", { name: /حذف قسم/ });
    fireEvent.click(deleteButtons[0]);

    expect(screen.getAllByTestId(/section-card-/)).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "قسم البداية (Hero)" })).toBeNull();
  });

  it("successfully saves draft and updates revision on 200 OK", async () => {
    const fetchSpy = vi.spyOn(ApiClient, "fetch")
      .mockResolvedValueOnce(mockInitialDraft)
      .mockResolvedValueOnce({
        success: true,
        draft: {
          ...mockInitialDraft.draft,
          revision: 3,
        },
        csrf: "new_csrf_token",
      });

    render(<HomepageEditor />);

    await waitFor(() => {
      expect(screen.getByText(/المراجعة الحالية: 2/)).toBeDefined();
    });

    const saveButton = screen.getByRole("button", { name: "حفظ المسودة" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("تم حفظ المسودة بنجاح (المراجعة 3)")).toBeDefined();
      expect(screen.getByText(/المراجعة الحالية: 3/)).toBeDefined();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/admin/content/homepage",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          "X-CSRF-Token": "mock_csrf_token_xyz",
        }),
      })
    );
  });

  it("displays conflict alert when concurrent update causes 409", async () => {
    vi.spyOn(ApiClient, "fetch")
      .mockResolvedValueOnce(mockInitialDraft)
      .mockRejectedValueOnce(
        new ClientApiError(409, {
          error: {
            code: "CONFLICT",
            message: "Draft has been modified by another user",
          },
        })
      );

    render(<HomepageEditor />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "حفظ المسودة" })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "تم تعديل المسودة بواسطة مستخدم آخر. يرجى تحديث الصفحة لجلب أحدث التغييرات."
        )
      ).toBeDefined();
    });
  });

  it("displays field error summaries when validation fails with 422", async () => {
    vi.spyOn(ApiClient, "fetch")
      .mockResolvedValueOnce(mockInitialDraft)
      .mockRejectedValueOnce(
        new ClientApiError(422, {
          error: {
            code: "UNPROCESSABLE_ENTITY",
            message: "Validation failed",
            details: [
              {
                field: "sections[0].productIds[0]",
                message: "Referenced product 'prd_fake' does not exist",
              },
            ],
          },
        })
      );

    render(<HomepageEditor />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "حفظ المسودة" })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "حفظ المسودة" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "تعذر الحفظ لوجود أخطاء في البيانات المدخلة. راجع الحقول المحددة أدناه."
        )
      ).toBeDefined();
      expect(
        screen.getAllByText(/Referenced product 'prd_fake' does not exist/).length
      ).toBeGreaterThanOrEqual(1);
    });
  });
});
