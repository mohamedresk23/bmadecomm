import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { setupTestDb } from "../../../../../../test-utils/db";
import { db } from "../../../../../../db";
import {
  roles,
  staffAccounts,
  userRoles,
  users,
  sessions,
  categories,
  auditEvents,
} from "../../../../../../db/schema";
import { issueStaffSession } from "../../../../../../modules/identity/infrastructure/staff-sessions";
import {
  staffConfig,
  STAFF_SESSION_POLICY,
} from "../../../../../../modules/identity/infrastructure/staff-config";
import {
  encryptStaffSecret,
  newStaffSeed,
  sessionCsrf,
} from "../../../../../../modules/identity/infrastructure/staff-crypto";
import { GET as getCategories, POST as postCategory, PATCH as patchCategories } from "./route";
import {
  GET as getCategory,
  PUT as putCategory,
  DELETE as deleteCategory,
} from "./[id]/route";
import { GET as getStoreCategories } from "../../../store/categories/route";

beforeAll(setupTestDb);

const createdUserIds: string[] = [];
const createdCategoryIds: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const id of createdUserIds) {
    await db.delete(sessions).where(eq(sessions.userId, id));
    await db.delete(userRoles).where(eq(userRoles.userId, id));
    await db.delete(staffAccounts).where(eq(staffAccounts.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
  createdUserIds.length = 0;

  if (createdCategoryIds.length > 0) {
    // Delete in reverse order to respect foreign key constraints
    for (const id of [...createdCategoryIds].reverse()) {
      await db.delete(categories).where(eq(categories.id, id));
    }
    createdCategoryIds.length = 0;
  }
});

function configureEnv() {
  const staffKey = randomBytes(32).toString("base64");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("STAFF_MFA_KEY", staffKey);
  vi.stubEnv("EMAIL_ADAPTER", "sandbox");
  return staffConfig();
}

async function createStaffUser(
  role: string = "owner"
): Promise<{ userId: string; token: string }> {
  const config = staffConfig();
  const userId = randomUUID();
  createdUserIds.push(userId);
  const email = `${userId}@example.test`;
  const seed = newStaffSeed();

  await db.insert(users).values({
    id: userId,
    email,
    role: "staff",
    name: "Test Staff",
    phone: "01000000000",
    passwordHash: "dummy_hash",
  });

  await db.insert(staffAccounts).values({
    userId,
    mfaEnrolledAt: new Date(),
    mfaSeed: encryptStaffSecret(seed, config.key, userId, "mfa"),
  });

  await db.insert(roles).values({ key: role }).onConflictDoNothing();
  await db.insert(userRoles).values({ userId, roleKey: role });

  const session = await issueStaffSession(db, userId, STAFF_SESSION_POLICY);
  if (!session) throw new Error("Failed to issue session");

  return { userId, token: session.token };
}

describe("Admin Category API Routes (E04-01)", () => {
  it("rejects unauthenticated requests with 401 Unauthorized", async () => {
    configureEnv();
    const req = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
      method: "GET",
    });

    const res = await getCategories(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects unauthorized staff roles with 403 Forbidden", async () => {
    configureEnv();
    const { token } = await createStaffUser("unauthorized_role");

    const req = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
      method: "GET",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
      },
    });

    const res = await getCategories(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("allows staff role to list categories and returns CSRF token", async () => {
    configureEnv();
    const { token } = await createStaffUser("staff");

    const req = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
      method: "GET",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
      },
    });

    const res = await getCategories(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.categories)).toBe(true);
    expect(body.csrf).toBeDefined();
  });

  it("creates root and child category with audit events (Matrix: Create root, Create child)", async () => {
    const config = configureEnv();
    const { token } = await createStaffUser("owner");
    const validCsrf = sessionCsrf(token, config.key);

    // 1. Create root "Men"
    const rootReq = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
      method: "POST",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        name: "Men",
        slug: "men",
        description: "Men catalog",
      }),
    });

    const rootRes = await postCategory(rootReq);
    expect(rootRes.status).toBe(201);
    const rootBody = await rootRes.json();
    expect(rootBody.success).toBe(true);
    expect(rootBody.category.name).toBe("Men");
    expect(rootBody.category.slug).toBe("men");
    expect(rootBody.category.parentId).toBeNull();

    const rootId = rootBody.category.id;
    createdCategoryIds.push(rootId);

    // 2. Create child "Shoes" under "Men"
    const childReq = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
      method: "POST",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        name: "Shoes",
        slug: "shoes",
        parentId: rootId,
      }),
    });

    const childRes = await postCategory(childReq);
    expect(childRes.status).toBe(201);
    const childBody = await childRes.json();
    expect(childBody.success).toBe(true);
    expect(childBody.category.name).toBe("Shoes");
    expect(childBody.category.parentId).toBe(rootId);

    const childId = childBody.category.id;
    createdCategoryIds.push(childId);

    // Verify audit events
    const audits = await db
      .select()
      .from(auditEvents)
      .where(inArray(auditEvents.resource, [`category:${rootId}`, `category:${childId}`]));
    expect(audits.length).toBe(2);
    expect(audits[0].action).toBe("category.created");
  });

  it("rejects duplicate slug with 409 Conflict and field error (Matrix: Duplicate slug)", async () => {
    const config = configureEnv();
    const { token } = await createStaffUser("owner");
    const validCsrf = sessionCsrf(token, config.key);

    // 1. Create first category "electronics"
    const req1 = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
      method: "POST",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        name: "Electronics",
        slug: "electronics",
      }),
    });

    const res1 = await postCategory(req1);
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    createdCategoryIds.push(body1.category.id);

    // 2. Attempt creating another category with slug "electronics"
    const req2 = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
      method: "POST",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        name: "New Electronics",
        slug: "electronics",
      }),
    });

    const res2 = await postCategory(req2);
    expect(res2.status).toBe(409);
    const body2 = await res2.json();
    expect(body2.error.code).toBe("CONFLICT");
    expect(body2.error.details?.[0]).toEqual({
      field: "slug",
      message: "Slug already in use",
    });
  });

  it("rejects self-parenting with 422 Unprocessable Entity (Matrix: Self-parenting)", async () => {
    const config = configureEnv();
    const { token } = await createStaffUser("owner");
    const validCsrf = sessionCsrf(token, config.key);

    const createReq = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
      method: "POST",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        name: "Clothing",
        slug: "clothing",
      }),
    });

    const createRes = await postCategory(createReq);
    const cat = (await createRes.json()).category;
    createdCategoryIds.push(cat.id);

    // Update with parentId == id
    const updateReq = new Request(`http://localhost:3000/api/v1/admin/catalog/categories/${cat.id}`, {
      method: "PUT",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        parentId: cat.id,
      }),
    });

    const updateRes = await putCategory(updateReq, { params: Promise.resolve({ id: cat.id }) });
    expect(updateRes.status).toBe(422);
    const updateBody = await updateRes.json();
    expect(updateBody.error.details?.[0]).toEqual({
      field: "parentId",
      message: "Category cannot be its own parent",
    });
  });

  it("rejects circular dependency with 422 Unprocessable Entity (Matrix: Circular dependency)", async () => {
    const config = configureEnv();
    const { token } = await createStaffUser("owner");
    const validCsrf = sessionCsrf(token, config.key);

    // Create A
    const resA = await postCategory(
      new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "POST",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": validCsrf,
          Origin: config.origin,
        },
        body: JSON.stringify({ name: "A", slug: "cat-node-a" }),
      })
    );
    const catA = (await resA.json()).category;
    createdCategoryIds.push(catA.id);

    // Create B under A
    const resB = await postCategory(
      new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "POST",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": validCsrf,
          Origin: config.origin,
        },
        body: JSON.stringify({ name: "B", slug: "cat-node-b", parentId: catA.id }),
      })
    );
    const catB = (await resB.json()).category;
    createdCategoryIds.push(catB.id);

    // Update A setting parent to B
    const updateReq = new Request(`http://localhost:3000/api/v1/admin/catalog/categories/${catA.id}`, {
      method: "PUT",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        parentId: catB.id,
      }),
    });

    const updateRes = await putCategory(updateReq, { params: Promise.resolve({ id: catA.id }) });
    expect(updateRes.status).toBe(422);
    const updateBody = await updateRes.json();
    expect(updateBody.error.details?.[0]).toEqual({
      field: "parentId",
      message: "Circular parent category relationship detected",
    });
  });

  it("rejects deleting category with children, safely deletes leaf (Matrix: Delete with children, Delete leaf)", async () => {
    const config = configureEnv();
    const { token } = await createStaffUser("owner");
    const validCsrf = sessionCsrf(token, config.key);

    // Create parent and child
    const resP = await postCategory(
      new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "POST",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": validCsrf,
          Origin: config.origin,
        },
        body: JSON.stringify({ name: "Parent Node", slug: "parent-node" }),
      })
    );
    const catP = (await resP.json()).category;
    createdCategoryIds.push(catP.id);

    const resC = await postCategory(
      new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "POST",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": validCsrf,
          Origin: config.origin,
        },
        body: JSON.stringify({ name: "Child Node", slug: "child-node", parentId: catP.id }),
      })
    );
    const catC = (await resC.json()).category;
    createdCategoryIds.push(catC.id);

    // Attempt deleting parent -> 409 Conflict
    const delParentReq = new Request(`http://localhost:3000/api/v1/admin/catalog/categories/${catP.id}`, {
      method: "DELETE",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
    });

    const delParentRes = await deleteCategory(delParentReq, { params: Promise.resolve({ id: catP.id }) });
    expect(delParentRes.status).toBe(409);
    const delParentBody = await delParentRes.json();
    expect(delParentBody.error.message).toBe("Cannot delete category with subcategories");

    // Delete child (leaf) -> 200 OK
    const delChildReq = new Request(`http://localhost:3000/api/v1/admin/catalog/categories/${catC.id}`, {
      method: "DELETE",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
    });

    const delChildRes = await deleteCategory(delChildReq, { params: Promise.resolve({ id: catC.id }) });
    expect(delChildRes.status).toBe(200);
    const delChildBody = await delChildRes.json();
    expect(delChildBody.success).toBe(true);

    // Now parent is leaf -> 200 OK
    const delParentAgainRes = await deleteCategory(delParentReq, { params: Promise.resolve({ id: catP.id }) });
    expect(delParentAgainRes.status).toBe(200);
  });

  it("public storefront GET /api/v1/store/categories returns only active categories unauthenticated", async () => {
    const config = configureEnv();
    const { token } = await createStaffUser("owner");
    const validCsrf = sessionCsrf(token, config.key);

    // Create 1 active category and 1 inactive category
    const activeRes = await postCategory(
      new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "POST",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": validCsrf,
          Origin: config.origin,
        },
        body: JSON.stringify({ name: "Public Active", slug: "public-active", isActive: true }),
      })
    );
    const activeCat = (await activeRes.json()).category;
    createdCategoryIds.push(activeCat.id);

    const inactiveRes = await postCategory(
      new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "POST",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": validCsrf,
          Origin: config.origin,
        },
        body: JSON.stringify({ name: "Private Inactive", slug: "private-inactive", isActive: false }),
      })
    );
    const inactiveCat = (await inactiveRes.json()).category;
    createdCategoryIds.push(inactiveCat.id);

    // Call storefront endpoint without auth
    const storeRes = await getStoreCategories(
      new Request("http://localhost:3000/api/v1/store/categories")
    );
    expect(storeRes.status).toBe(200);
    const storeBody = await storeRes.json();
    expect(storeBody.success).toBe(true);
    expect(Array.isArray(storeBody.categories)).toBe(true);

    const slugs = storeBody.categories.map((c: { slug: string }) => c.slug);
    expect(slugs).toContain("public-active");
    expect(slugs).not.toContain("private-inactive");
  });

  it("batch reorders categories with PATCH (200, sort persistence) and rejects invalid payloads (422)", async () => {
    const config = configureEnv();
    const { token } = await createStaffUser("owner");
    const validCsrf = sessionCsrf(token, config.key);

    const res1 = await postCategory(
      new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "POST",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": validCsrf,
          Origin: config.origin,
        },
        body: JSON.stringify({ name: "Reorder 1", slug: "reorder-1", sortOrder: 0 }),
      })
    );
    const cat1 = (await res1.json()).category;
    createdCategoryIds.push(cat1.id);

    const res2 = await postCategory(
      new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "POST",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": validCsrf,
          Origin: config.origin,
        },
        body: JSON.stringify({ name: "Reorder 2", slug: "reorder-2", sortOrder: 1 }),
      })
    );
    const cat2 = (await res2.json()).category;
    createdCategoryIds.push(cat2.id);

    // Invalid payload: items is empty -> 422
    const invalidPatchReq = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
      method: "PATCH",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({ items: [] }),
    });
    const invalidPatchRes = await patchCategories(invalidPatchReq);
    expect(invalidPatchRes.status).toBe(422);

    // Valid reorder -> 200 OK
    const validPatchReq = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
      method: "PATCH",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        items: [
          { id: cat1.id, sortOrder: 20 },
          { id: cat2.id, sortOrder: 10 },
        ],
      }),
    });
    const validPatchRes = await patchCategories(validPatchReq);
    expect(validPatchRes.status).toBe(200);
    const validPatchBody = await validPatchRes.json();
    expect(validPatchBody.success).toBe(true);

    const [dbCat1] = await db.select().from(categories).where(eq(categories.id, cat1.id));
    const [dbCat2] = await db.select().from(categories).where(eq(categories.id, cat2.id));
    expect(dbCat1.sortOrder).toBe(20);
    expect(dbCat2.sortOrder).toBe(10);
  });

  it("fetches single category by ID with GET [id] (200 DTO) and returns 404 for unknown category", async () => {
    const config = configureEnv();
    const { token } = await createStaffUser("owner");
    const validCsrf = sessionCsrf(token, config.key);

    const postRes = await postCategory(
      new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "POST",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": validCsrf,
          Origin: config.origin,
        },
        body: JSON.stringify({ name: "Single Cat", slug: "single-cat", description: "Details" }),
      })
    );
    const cat = (await postRes.json()).category;
    createdCategoryIds.push(cat.id);

    // Existing category -> 200
    const getReq = new Request(`http://localhost:3000/api/v1/admin/catalog/categories/${cat.id}`, {
      method: "GET",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
      },
    });
    const getRes = await getCategory(getReq, { params: Promise.resolve({ id: cat.id }) });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.success).toBe(true);
    expect(getBody.category.id).toBe(cat.id);
    expect(getBody.category.name).toBe("Single Cat");
    expect(getBody.category.slug).toBe("single-cat");
    expect(getBody.category.description).toBe("Details");

    // Unknown category -> 404
    const unknownId = randomUUID();
    const unknownReq = new Request(`http://localhost:3000/api/v1/admin/catalog/categories/${unknownId}`, {
      method: "GET",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
      },
    });
    const unknownRes = await getCategory(unknownReq, { params: Promise.resolve({ id: unknownId }) });
    expect(unknownRes.status).toBe(404);
    const unknownBody = await unknownRes.json();
    expect(unknownBody.error.code).toBe("NOT_FOUND");
  });

  it("updates category via PUT [id] with 200 OK and updated fields", async () => {
    const config = configureEnv();
    const { token } = await createStaffUser("owner");
    const validCsrf = sessionCsrf(token, config.key);

    const postRes = await postCategory(
      new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "POST",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": validCsrf,
          Origin: config.origin,
        },
        body: JSON.stringify({ name: "Original Cat", slug: "orig-cat", description: "Old desc", sortOrder: 1, isActive: true }),
      })
    );
    const cat = (await postRes.json()).category;
    createdCategoryIds.push(cat.id);

    const updateReq = new Request(`http://localhost:3000/api/v1/admin/catalog/categories/${cat.id}`, {
      method: "PUT",
      headers: {
        Cookie: `__Host-staff-session=${token}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": validCsrf,
        Origin: config.origin,
      },
      body: JSON.stringify({
        name: "Updated Cat",
        slug: "updated-cat",
        description: "New desc",
        sortOrder: 5,
        isActive: false,
      }),
    });

    const updateRes = await putCategory(updateReq, { params: Promise.resolve({ id: cat.id }) });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.success).toBe(true);
    expect(updateBody.category.id).toBe(cat.id);
    expect(updateBody.category.name).toBe("Updated Cat");
    expect(updateBody.category.slug).toBe("updated-cat");
    expect(updateBody.category.description).toBe("New desc");
    expect(updateBody.category.sortOrder).toBe(5);
    expect(updateBody.category.isActive).toBe(false);
  });

  describe("CSRF and Origin Protection on Mutation Routes", () => {
    it("rejects POST requests lacking valid CSRF token or with mismatched Origin with 403 Forbidden", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      // Missing CSRF
      const reqMissingCsrf = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "POST",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          Origin: config.origin,
        },
        body: JSON.stringify({ name: "Test", slug: "test-slug" }),
      });
      const resMissingCsrf = await postCategory(reqMissingCsrf);
      expect(resMissingCsrf.status).toBe(403);

      // Mismatched Origin
      const reqWrongOrigin = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "POST",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": validCsrf,
          Origin: "http://malicious.com",
        },
        body: JSON.stringify({ name: "Test", slug: "test-slug" }),
      });
      const resWrongOrigin = await postCategory(reqWrongOrigin);
      expect(resWrongOrigin.status).toBe(403);
    });

    it("rejects PUT requests lacking valid CSRF token or with mismatched Origin with 403 Forbidden", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      const createRes = await postCategory(
        new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
          method: "POST",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({ name: "To Put", slug: "to-put" }),
        })
      );
      const cat = (await createRes.json()).category;
      createdCategoryIds.push(cat.id);

      // Missing CSRF
      const reqMissingCsrf = new Request(`http://localhost:3000/api/v1/admin/catalog/categories/${cat.id}`, {
        method: "PUT",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          Origin: config.origin,
        },
        body: JSON.stringify({ name: "New Name" }),
      });
      const resMissingCsrf = await putCategory(reqMissingCsrf, { params: Promise.resolve({ id: cat.id }) });
      expect(resMissingCsrf.status).toBe(403);

      // Mismatched Origin
      const reqWrongOrigin = new Request(`http://localhost:3000/api/v1/admin/catalog/categories/${cat.id}`, {
        method: "PUT",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": validCsrf,
          Origin: "http://malicious.com",
        },
        body: JSON.stringify({ name: "New Name" }),
      });
      const resWrongOrigin = await putCategory(reqWrongOrigin, { params: Promise.resolve({ id: cat.id }) });
      expect(resWrongOrigin.status).toBe(403);
    });

    it("rejects DELETE requests lacking valid CSRF token or with mismatched Origin with 403 Forbidden", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      const createRes = await postCategory(
        new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
          method: "POST",
          headers: {
            Cookie: `__Host-staff-session=${token}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": validCsrf,
            Origin: config.origin,
          },
          body: JSON.stringify({ name: "To Delete", slug: "to-del" }),
        })
      );
      const cat = (await createRes.json()).category;
      createdCategoryIds.push(cat.id);

      // Missing CSRF
      const reqMissingCsrf = new Request(`http://localhost:3000/api/v1/admin/catalog/categories/${cat.id}`, {
        method: "DELETE",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          Origin: config.origin,
        },
      });
      const resMissingCsrf = await deleteCategory(reqMissingCsrf, { params: Promise.resolve({ id: cat.id }) });
      expect(resMissingCsrf.status).toBe(403);

      // Mismatched Origin
      const reqWrongOrigin = new Request(`http://localhost:3000/api/v1/admin/catalog/categories/${cat.id}`, {
        method: "DELETE",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "X-CSRF-Token": validCsrf,
          Origin: "http://malicious.com",
        },
      });
      const resWrongOrigin = await deleteCategory(reqWrongOrigin, { params: Promise.resolve({ id: cat.id }) });
      expect(resWrongOrigin.status).toBe(403);
    });

    it("rejects PATCH requests lacking valid CSRF token or with mismatched Origin with 403 Forbidden", async () => {
      const config = configureEnv();
      const { token } = await createStaffUser("owner");
      const validCsrf = sessionCsrf(token, config.key);

      // Missing CSRF
      const reqMissingCsrf = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "PATCH",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          Origin: config.origin,
        },
        body: JSON.stringify({ items: [{ id: "cat-1", sortOrder: 1 }] }),
      });
      const resMissingCsrf = await patchCategories(reqMissingCsrf);
      expect(resMissingCsrf.status).toBe(403);

      // Mismatched Origin
      const reqWrongOrigin = new Request("http://localhost:3000/api/v1/admin/catalog/categories", {
        method: "PATCH",
        headers: {
          Cookie: `__Host-staff-session=${token}`,
          "Content-Type": "application/json",
          "X-CSRF-Token": validCsrf,
          Origin: "http://malicious.com",
        },
        body: JSON.stringify({ items: [{ id: "cat-1", sortOrder: 1 }] }),
      });
      const resWrongOrigin = await patchCategories(reqWrongOrigin);
      expect(resWrongOrigin.status).toBe(403);
    });
  });
});

