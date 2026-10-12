import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, withIsolatedTx } from "../../../../test-utils/db";
import { auditEvents } from "../../../../db/schema";
import { ApiError } from "../../../../shared/api/errors";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  getCategoryById,
  getCategoryTree,
  reorderCategories,
} from "./category-service";

beforeAll(setupTestDb);

describe("Category Service", () => {
  it("creates root category and child category with audit events", async () => {
    await withIsolatedTx(async (tx) => {
      // 1. Create root category "Men"
      const root = await createCategory(
        tx,
        {
          name: "Men",
          slug: "men",
          description: "Men clothing and footwear",
        },
        "user_owner",
        "req_001"
      );

      expect(root.id).toBeDefined();
      expect(root.name).toBe("Men");
      expect(root.slug).toBe("men");
      expect(root.parentId).toBeNull();
      expect(root.isActive).toBe(true);

      // Verify audit event
      const audits = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.resource, `category:${root.id}`));
      expect(audits.length).toBe(1);
      expect(audits[0].action).toBe("category.created");
      expect(audits[0].actor).toBe("staff:user_owner");

      // 2. Create child category "Shoes" under "Men"
      const child = await createCategory(
        tx,
        {
          name: "Shoes",
          slug: "shoes",
          parentId: root.id,
        },
        "user_owner",
        "req_002"
      );

      expect(child.id).toBeDefined();
      expect(child.name).toBe("Shoes");
      expect(child.slug).toBe("shoes");
      expect(child.parentId).toBe(root.id);

      const childAudits = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.resource, `category:${child.id}`));
      expect(childAudits.length).toBe(1);
      expect(childAudits[0].action).toBe("category.created");
    });
  });

  it("rejects duplicate slug on creation with 409 Conflict", async () => {
    await withIsolatedTx(async (tx) => {
      await createCategory(
        tx,
        {
          name: "Electronics",
          slug: "electronics",
        },
        "user_owner"
      );

      let err: ApiError | null = null;
      try {
        await createCategory(
          tx,
          {
            name: "Other Electronics",
            slug: "electronics",
          },
          "user_owner"
        );
      } catch (e) {
        err = e as ApiError;
      }

      expect(err).toBeInstanceOf(ApiError);
      expect(err?.statusCode).toBe(409);
      expect(err?.details?.[0]).toEqual({
        field: "slug",
        message: "Slug already in use",
      });
    });
  });

  it("normalizes slug to lowercase kebab-case", async () => {
    await withIsolatedTx(async (tx) => {
      const cat = await createCategory(
        tx,
        {
          name: "Men T-Shirts & Tops",
          slug: "Men  T-Shirts & Tops!",
        },
        "user_owner"
      );

      expect(cat.slug).toBe("men-t-shirts-tops");
    });
  });

  it("builds hierarchical category tree and respects active filtering", async () => {
    await withIsolatedTx(async (tx) => {
      const root1 = await createCategory(tx, { name: "Fashion", slug: "fashion", sortOrder: 1 }, "user_owner");
      const root2 = await createCategory(tx, { name: "Electronics", slug: "electronics", sortOrder: 2, isActive: false }, "user_owner");

      const child1 = await createCategory(tx, { name: "Shirts", slug: "shirts", parentId: root1.id, sortOrder: 1 }, "user_owner");
      const child2 = await createCategory(tx, { name: "T-Shirts", slug: "t-shirts", parentId: child1.id, sortOrder: 1 }, "user_owner");
      await createCategory(tx, { name: "Phones", slug: "phones", parentId: root2.id, sortOrder: 1 }, "user_owner");

      // Full tree (admin view)
      const fullTree = await getCategoryTree(tx);
      expect(fullTree.length).toBe(2);

      const fashionNode = fullTree.find((n) => n.id === root1.id);
      expect(fashionNode).toBeDefined();
      expect(fashionNode?.children.length).toBe(1);
      expect(fashionNode?.children[0].id).toBe(child1.id);
      expect(fashionNode?.children[0].children[0].id).toBe(child2.id);

      const electronicsNode = fullTree.find((n) => n.id === root2.id);
      expect(electronicsNode).toBeDefined();
      expect(electronicsNode?.isActive).toBe(false);
      expect(electronicsNode?.children.length).toBe(1);

      // Storefront tree (only active, and parent must be active)
      const publicTree = await getCategoryTree(tx, { onlyActive: true });
      expect(publicTree.length).toBe(1);
      expect(publicTree[0].id).toBe(root1.id);
      expect(publicTree.find((n) => n.id === root2.id)).toBeUndefined();
    });
  });

  it("updates category and rejects duplicate slug on update", async () => {
    await withIsolatedTx(async (tx) => {
      const cat1 = await createCategory(tx, { name: "Books", slug: "books" }, "user_owner");
      const cat2 = await createCategory(tx, { name: "Novels", slug: "novels" }, "user_owner");

      const updated = await updateCategory(
        tx,
        cat1.id,
        {
          name: "All Books",
          description: "All categories of books",
        },
        "user_owner"
      );

      expect(updated.name).toBe("All Books");
      expect(updated.description).toBe("All categories of books");

      // Rejects setting cat2's slug to cat1's slug
      let err: ApiError | null = null;
      try {
        await updateCategory(tx, cat2.id, { slug: "books" }, "user_owner");
      } catch (e) {
        err = e as ApiError;
      }

      expect(err).toBeInstanceOf(ApiError);
      expect(err?.statusCode).toBe(409);
      expect(err?.details?.[0]?.field).toBe("slug");
    });
  });

  it("rejects self-parenting with 422 Unprocessable Entity", async () => {
    await withIsolatedTx(async (tx) => {
      const cat = await createCategory(tx, { name: "Sports", slug: "sports" }, "user_owner");

      let err: ApiError | null = null;
      try {
        await updateCategory(tx, cat.id, { parentId: cat.id }, "user_owner");
      } catch (e) {
        err = e as ApiError;
      }

      expect(err).toBeInstanceOf(ApiError);
      expect(err?.statusCode).toBe(422);
      expect(err?.details?.[0]).toEqual({
        field: "parentId",
        message: "Category cannot be its own parent",
      });
    });
  });

  it("rejects circular dependency A -> B -> A with 422 Unprocessable Entity", async () => {
    await withIsolatedTx(async (tx) => {
      const catA = await createCategory(tx, { name: "Category A", slug: "cat-a" }, "user_owner");
      const catB = await createCategory(tx, { name: "Category B", slug: "cat-b", parentId: catA.id }, "user_owner");

      // Attempt setting A's parent to B
      let err: ApiError | null = null;
      try {
        await updateCategory(tx, catA.id, { parentId: catB.id }, "user_owner");
      } catch (e) {
        err = e as ApiError;
      }

      expect(err).toBeInstanceOf(ApiError);
      expect(err?.statusCode).toBe(422);
      expect(err?.details?.[0]).toEqual({
        field: "parentId",
        message: "Circular parent category relationship detected",
      });
    });
  });

  it("rejects deep circular dependency A -> B -> C -> A with 422 Unprocessable Entity", async () => {
    await withIsolatedTx(async (tx) => {
      const catA = await createCategory(tx, { name: "A", slug: "a" }, "user_owner");
      const catB = await createCategory(tx, { name: "B", slug: "b", parentId: catA.id }, "user_owner");
      const catC = await createCategory(tx, { name: "C", slug: "c", parentId: catB.id }, "user_owner");

      // Attempt setting A's parent to C
      let err: ApiError | null = null;
      try {
        await updateCategory(tx, catA.id, { parentId: catC.id }, "user_owner");
      } catch (e) {
        err = e as ApiError;
      }

      expect(err).toBeInstanceOf(ApiError);
      expect(err?.statusCode).toBe(422);
      expect(err?.details?.[0]).toEqual({
        field: "parentId",
        message: "Circular parent category relationship detected",
      });
    });
  });

  it("rejects deletion of category with children, allows leaf deletion", async () => {
    await withIsolatedTx(async (tx) => {
      const parent = await createCategory(tx, { name: "Parent", slug: "parent" }, "user_owner");
      const child = await createCategory(tx, { name: "Child", slug: "child", parentId: parent.id }, "user_owner");

      // Reject deleting parent
      let err: ApiError | null = null;
      try {
        await deleteCategory(tx, parent.id, "user_owner");
      } catch (e) {
        err = e as ApiError;
      }

      expect(err).toBeInstanceOf(ApiError);
      expect(err?.statusCode).toBe(409);
      expect(err?.message).toBe("Cannot delete category with subcategories");

      // Delete child (leaf) succeeds
      await deleteCategory(tx, child.id, "user_owner");

      // Now parent is leaf, deleting parent succeeds
      await deleteCategory(tx, parent.id, "user_owner");

      // Verify audit events for both deletions
      const audits = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "category.deleted"));
      expect(audits.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("reorders categories and logs audit event", async () => {
    await withIsolatedTx(async (tx) => {
      const cat1 = await createCategory(tx, { name: "Cat 1", slug: "cat-1", sortOrder: 0 }, "user_owner");
      const cat2 = await createCategory(tx, { name: "Cat 2", slug: "cat-2", sortOrder: 1 }, "user_owner");

      await reorderCategories(
        tx,
        [
          { id: cat1.id, sortOrder: 10 },
          { id: cat2.id, sortOrder: 5 },
        ],
        "user_owner"
      );

      const updated1 = await getCategoryById(tx, cat1.id);
      const updated2 = await getCategoryById(tx, cat2.id);

      expect(updated1.sortOrder).toBe(10);
      expect(updated2.sortOrder).toBe(5);

      const audits = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "category.reordered"));
      expect(audits.length).toBe(1);
    });
  });

  it("generates fallback slug for Arabic or non-ASCII category name when slug is omitted", async () => {
    await withIsolatedTx(async (tx) => {
      const cat = await createCategory(
        tx,
        {
          name: "ملابس وأزياء رجالية",
        },
        "user_owner"
      );

      expect(cat.id).toBeDefined();
      expect(cat.name).toBe("ملابس وأزياء رجالية");
      expect(cat.slug).toMatch(/^cat-[a-z0-9_-]+$/);
    });
  });

  it("throws 404 when reorderCategories is called with non-existent category ID", async () => {
    await withIsolatedTx(async (tx) => {
      const cat1 = await createCategory(tx, { name: "Valid Cat", slug: "valid-cat" }, "user_owner");

      let err: ApiError | null = null;
      try {
        await reorderCategories(
          tx,
          [
            { id: cat1.id, sortOrder: 1 },
            { id: "non-existent-id", sortOrder: 2 },
          ],
          "user_owner"
        );
      } catch (e) {
        err = e as ApiError;
      }

      expect(err).toBeInstanceOf(ApiError);
      expect(err?.statusCode).toBe(404);
      expect(err?.message).toMatch(/not found/i);
    });
  });
});

