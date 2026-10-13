import { describe, expect, it } from "vitest";
import { staffNavigation } from "./staff-navigation";

describe("staffNavigation", () => {
  it("returns an empty array when no roles are provided", () => {
    expect(staffNavigation([])).toEqual([]);
  });

  it("includes default admin navigation items for any non-empty role set", () => {
    const items = staffNavigation(["some_role"]);
    expect(items).toContainEqual({ href: "/admin", label: "Administration" });
    expect(items).toContainEqual({ href: "/admin/security", label: "Your security" });
  });

  it("includes /admin/settings only for owner role", () => {
    const ownerItems = staffNavigation(["owner"]);
    expect(ownerItems).toContainEqual({ href: "/admin/settings", label: "Store settings" });

    const staffItems = staffNavigation(["staff"]);
    expect(staffItems.find((i) => i.href === "/admin/settings")).toBeUndefined();
  });

  it.each([
    ["owner"],
    ["staff"],
    ["catalog_manager"],
    ["catalog"],
  ])("includes /admin/catalog/categories for authorized role %s", (role) => {
    const items = staffNavigation([role]);
    const categoryItem = items.find((i) => i.href === "/admin/catalog/categories");
    expect(categoryItem).toBeDefined();
    expect(categoryItem).toEqual({ href: "/admin/catalog/categories", label: "Categories" });
  });

  it.each([
    [["support"]],
    [["fulfillment"]],
    [["finance"]],
    [["customer"]],
  ])("excludes /admin/catalog/categories for unauthorized role set %j", (roles) => {
    const items = staffNavigation(roles);
    const categoryItem = items.find((i) => i.href === "/admin/catalog/categories");
    expect(categoryItem).toBeUndefined();
  });

  it("does not duplicate /admin/catalog/categories when multiple authorized roles are present", () => {
    const items = staffNavigation(["owner", "staff", "catalog_manager"]);
    const categoryItems = items.filter((i) => i.href === "/admin/catalog/categories");
    expect(categoryItems).toHaveLength(1);
  });
});

