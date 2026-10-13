/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { CategoryManager } from "./category-manager";
import type { CategoryTreeNode } from "../../../../modules/catalog/categories/contracts/category";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mockCategories: CategoryTreeNode[] = [
  {
    id: "cat-1",
    name: "ملابس رجالية",
    slug: "men",
    description: "أزياء وملابس رجالية",
    parentId: null,
    sortOrder: 0,
    isActive: true,
    createdAt: "2026-10-11T12:00:00Z",
    updatedAt: "2026-10-11T12:00:00Z",
    children: [
      {
        id: "cat-2",
        name: "أحذية",
        slug: "shoes",
        description: null,
        parentId: "cat-1",
        sortOrder: 1,
        isActive: true,
        createdAt: "2026-10-11T12:00:00Z",
        updatedAt: "2026-10-11T12:00:00Z",
        children: [],
      },
    ],
  },
  {
    id: "cat-3",
    name: "إلكترونيات",
    slug: "electronics",
    description: "أجهزة وهواتف",
    parentId: null,
    sortOrder: 2,
    isActive: false,
    createdAt: "2026-10-11T12:00:00Z",
    updatedAt: "2026-10-11T12:00:00Z",
    children: [],
  },
];

describe("CategoryManager Component", () => {
  it("renders category hierarchy correctly after fetching", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        categories: mockCategories,
        csrf: "mock_csrf_123",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CategoryManager />);

    expect(screen.getByText(/جاري تحميل شجرة التصنيفات/i)).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("ملابس رجالية")).toBeDefined();
      expect(screen.getByText("/men")).toBeDefined();
      expect(screen.getByText("أحذية")).toBeDefined();
      expect(screen.getByText("/shoes")).toBeDefined();
      expect(screen.getByText("إلكترونيات")).toBeDefined();
      expect(screen.getByText("/electronics")).toBeDefined();
      expect(screen.getByText("معطل")).toBeDefined();
    });
  });

  it("renders empty state when no categories exist", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        categories: [],
        csrf: "mock_csrf_123",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CategoryManager />);

    await waitFor(() => {
      expect(screen.getByText(/لا توجد تصنيفات بعد/i)).toBeDefined();
      expect(screen.getByText("إضافة أول تصنيف")).toBeDefined();
    });
  });

  it("opens create modal and submits new category", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, categories: mockCategories, csrf: "mock_csrf_123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          success: true,
          category: {
            id: "cat-new",
            name: "ساعات",
            slug: "watches",
            parentId: null,
            sortOrder: 0,
            isActive: true,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, categories: mockCategories, csrf: "mock_csrf_123" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<CategoryManager />);

    await waitFor(() => {
      expect(screen.getByText("ملابس رجالية")).toBeDefined();
    });

    fireEvent.click(screen.getByText("إضافة تصنيف رئيسي"));

    expect(screen.getByText("إضافة تصنيف جديد")).toBeDefined();

    const nameInput = screen.getByLabelText(/اسم التصنيف/i);
    const slugInput = screen.getByLabelText(/الرابط الدائم/i);

    fireEvent.change(nameInput, { target: { value: "ساعات" } });
    fireEvent.change(slugInput, { target: { value: "watches" } });

    fireEvent.click(screen.getByText("إضافة التصنيف"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/catalog/categories",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-CSRF-Token": "mock_csrf_123",
          }),
        })
      );
    });
  });

  it("displays server field errors on conflict or validation error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, categories: mockCategories, csrf: "mock_csrf_123" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: "CONFLICT",
            message: "Slug already in use",
            details: [{ field: "slug", message: "Slug already in use" }],
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<CategoryManager />);

    await waitFor(() => {
      expect(screen.getByText("ملابس رجالية")).toBeDefined();
    });

    fireEvent.click(screen.getByText("إضافة تصنيف رئيسي"));

    const nameInput = screen.getByLabelText(/اسم التصنيف/i);
    const slugInput = screen.getByLabelText(/الرابط الدائم/i);

    fireEvent.change(nameInput, { target: { value: "Duplicate Men" } });
    fireEvent.change(slugInput, { target: { value: "men" } });

    fireEvent.click(screen.getByText("إضافة التصنيف"));

    await waitFor(() => {
      expect(screen.getByText("Slug already in use")).toBeDefined();
    });
  });

  it("opens delete confirmation modal and confirms deletion", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, categories: mockCategories, csrf: "mock_csrf_123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, categories: [], csrf: "mock_csrf_123" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<CategoryManager />);

    await waitFor(() => {
      expect(screen.getByText("إلكترونيات")).toBeDefined();
    });

    const deleteButtons = screen.getAllByText("حذف");
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);

    expect(screen.getByText("تأكيد حذف التصنيف")).toBeDefined();
    expect(screen.getAllByText(/إلكترونيات/).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByText("تأكيد الحذف"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/catalog/categories/cat-3",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  it("opens edit modal with pre-filled data and submits PUT request", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, categories: mockCategories, csrf: "mock_csrf_123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          category: {
            id: "cat-1",
            name: "ملابس رجالية معدلة",
            slug: "men-updated",
            description: "أزياء وملابس رجالية",
            parentId: null,
            sortOrder: 0,
            isActive: true,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, categories: mockCategories, csrf: "mock_csrf_123" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<CategoryManager />);

    await waitFor(() => {
      expect(screen.getByText("ملابس رجالية")).toBeDefined();
    });

    const editButtons = screen.getAllByText("تعديل");
    fireEvent.click(editButtons[0]);

    expect(screen.getByText("تعديل بيانات التصنيف")).toBeDefined();

    const nameInput = screen.getByLabelText(/اسم التصنيف/i) as HTMLInputElement;
    const slugInput = screen.getByLabelText(/الرابط الدائم/i) as HTMLInputElement;

    expect(nameInput.value).toBe("ملابس رجالية");
    expect(slugInput.value).toBe("men");

    fireEvent.change(nameInput, { target: { value: "ملابس رجالية معدلة" } });
    fireEvent.change(slugInput, { target: { value: "men-updated" } });

    fireEvent.click(screen.getByText("حفظ التغييرات"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/catalog/categories/cat-1",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-CSRF-Token": "mock_csrf_123",
          }),
          body: JSON.stringify({
            name: "ملابس رجالية معدلة",
            slug: "men-updated",
            description: "أزياء وملابس رجالية",
            parentId: null,
            sortOrder: 0,
            isActive: true,
          }),
        })
      );
    });
  });
});
