import { eq, asc, sql, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { db as defaultDb } from "../../../../db";
import { DbContext } from "../../../../db/tx";
import { categories } from "../../../../db/schema";
import { ApiError } from "../../../../shared/api/errors";
import { writeAudit } from "../../../../shared/authz/audit";
import {
  CATEGORY_SLUG_REGEX,
  normalizeSlug,
  generateCategorySlug,
  CategoryDto,
  CategoryTreeNode,
  CreateCategoryInput,
  UpdateCategoryInput,
  ReorderCategoriesInput,
} from "../contracts/category";

function formatActor(actorId: string): string {
  if (!actorId) return "staff:unknown";
  return actorId.startsWith("staff:") ? actorId : `staff:${actorId}`;
}

function isUniqueViolation(err: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyErr = err as any;
  return (
    anyErr?.code === "23505" ||
    anyErr?.cause?.code === "23505" ||
    (typeof anyErr?.message === "string" &&
      (anyErr.message.includes("23505") || anyErr.message.includes("unique constraint")))
  );
}

function mapToDto(row: typeof categories.$inferSelect): CategoryDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    parentId: row.parentId ?? null,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

/**
 * Validates that setting `targetParentId` for category `categoryId` will not create a circular dependency.
 *
 * Algorithm:
 * 1. If targetParentId === categoryId, reject immediately (self-parenting).
 * 2. Starting from targetParentId, walk up ancestor links parent = parent.parentId.
 * 3. If at any step ancestorId === categoryId, reject with cycle error.
 * 4. Bound traversal to max 20 steps to safeguard against corrupted data loops.
 */
export async function validateParentCycle(
  tx: DbContext,
  categoryId: string,
  targetParentId: string | null
): Promise<void> {
  if (!targetParentId) {
    return;
  }

  if (targetParentId === categoryId) {
    throw ApiError.unprocessableEntity("Category cannot be its own parent", [
      { field: "parentId", message: "Category cannot be its own parent" },
    ]);
  }

  let currentParentId: string | null = targetParentId;
  let steps = 0;

  while (currentParentId && steps < 20) {
    if (currentParentId === categoryId) {
      throw ApiError.unprocessableEntity("Circular parent category relationship detected", [
        { field: "parentId", message: "Circular parent category relationship detected" },
      ]);
    }

    const [parentRecord] = await tx
      .select({ id: categories.id, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.id, currentParentId));

    if (!parentRecord) {
      throw ApiError.unprocessableEntity("Parent category does not exist", [
        { field: "parentId", message: "Parent category does not exist" },
      ]);
    }

    currentParentId = parentRecord.parentId;
    steps++;
  }

  if (steps >= 20 && currentParentId !== null) {
    throw ApiError.unprocessableEntity(
      "Category hierarchy depth exceeded maximum allowed depth",
      [{ field: "parentId", message: "Category hierarchy depth exceeded maximum allowed depth" }]
    );
  }
}

/**
 * Validates slug format and uniqueness across all categories.
 */
export async function validateSlugUnique(
  tx: DbContext,
  slug: string,
  excludeId?: string
): Promise<string> {
  const normalized = normalizeSlug(slug);

  if (!normalized || !CATEGORY_SLUG_REGEX.test(normalized)) {
    throw ApiError.unprocessableEntity("Slug must be lowercase kebab-case", [
      { field: "slug", message: "Slug must be lowercase kebab-case (e.g. men-shoes)" },
    ]);
  }

  const existing = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, normalized))
    .limit(1);

  if (existing.length > 0 && (!excludeId || existing[0].id !== excludeId)) {
    throw ApiError.conflict("Slug already in use", [
      { field: "slug", message: "Slug already in use" },
    ]);
  }

  return normalized;
}

/**
 * Builds a hierarchical category tree.
 */
export async function getCategoryTree(
  db: DbContext = defaultDb,
  options: { onlyActive?: boolean } = {}
): Promise<CategoryTreeNode[]> {
  const rows = await db
    .select()
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  const allDtos = rows.map(mapToDto);

  if (options.onlyActive) {
    // Only include categories that are active and whose all ancestors are active
    const activeMap = new Map<string, CategoryDto>();
    for (const cat of allDtos) {
      if (cat.isActive) {
        activeMap.set(cat.id, cat);
      }
    }

    // Verify all ancestors are also active
    const isFullyActive = (cat: CategoryDto): boolean => {
      let currentParentId = cat.parentId;
      let depth = 0;
      while (currentParentId && depth < 20) {
        const parent = activeMap.get(currentParentId);
        if (!parent || !parent.isActive) return false;
        currentParentId = parent.parentId;
        depth++;
      }
      return true;
    };

    const validActive = allDtos.filter((c) => c.isActive && isFullyActive(c));
    return buildTreeFromList(validActive);
  }

  return buildTreeFromList(allDtos);
}

function buildTreeFromList(items: CategoryDto[]): CategoryTreeNode[] {
  const nodeMap = new Map<string, CategoryTreeNode>();
  for (const item of items) {
    nodeMap.set(item.id, { ...item, children: [] });
  }

  const roots: CategoryTreeNode[] = [];

  for (const item of items) {
    const node = nodeMap.get(item.id)!;
    if (item.parentId && nodeMap.has(item.parentId)) {
      const parentNode = nodeMap.get(item.parentId)!;
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children by sortOrder ASC, then name ASC
  const sortNodes = (nodes: CategoryTreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    for (const n of nodes) {
      sortNodes(n.children);
    }
  };

  sortNodes(roots);
  return roots;
}

/**
 * Retrieves a single category by ID.
 */
export async function getCategoryById(
  db: DbContext = defaultDb,
  id: string
): Promise<CategoryDto> {
  const [row] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, id));

  if (!row) {
    throw ApiError.notFound("Category not found");
  }

  return mapToDto(row);
}

/**
 * Creates a new category with cycle check, slug collision check, and audit event.
 */
export async function createCategory(
  db: DbContext = defaultDb,
  input: CreateCategoryInput,
  actorId: string,
  requestId?: string
): Promise<CategoryDto> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runner = (db as any).transaction ? (cb: (tx: DbContext) => Promise<CategoryDto>) => (db as any).transaction(cb) : (cb: (tx: DbContext) => Promise<CategoryDto>) => cb(db);

  return runner(async (tx: DbContext) => {
    const rawSlug = generateCategorySlug(input.name, input.slug);
    const slug = await validateSlugUnique(tx, rawSlug);

    if (input.parentId) {
      const [parent] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, input.parentId));

      if (!parent) {
        throw ApiError.unprocessableEntity("Parent category does not exist", [
          { field: "parentId", message: "Parent category does not exist" },
        ]);
      }
    }

    const id = `cat_${createId()}`;

    let created;
    try {
      [created] = await tx
        .insert(categories)
        .values({
          id,
          name: input.name.trim(),
          slug,
          description: input.description?.trim() || null,
          parentId: input.parentId || null,
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw ApiError.conflict("Slug already in use", [
          { field: "slug", message: "Slug already in use" },
        ]);
      }
      throw err;
    }

    const dto = mapToDto(created);

    await writeAudit(tx, {
      actor: formatActor(actorId),
      action: "category.created",
      resource: `category:${dto.id}`,
      diff: {
        name: dto.name,
        slug: dto.slug,
        parentId: dto.parentId,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
      requestId,
    });

    return dto;
  });
}

/**
 * Updates an existing category with cycle prevention and audit logging.
 */
export async function updateCategory(
  db: DbContext = defaultDb,
  id: string,
  input: UpdateCategoryInput,
  actorId: string,
  requestId?: string
): Promise<CategoryDto> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runner = (db as any).transaction ? (cb: (tx: DbContext) => Promise<CategoryDto>) => (db as any).transaction(cb) : (cb: (tx: DbContext) => Promise<CategoryDto>) => cb(db);

  return runner(async (tx: DbContext) => {
    const [existing] = await tx
      .select()
      .from(categories)
      .where(eq(categories.id, id));

    if (!existing) {
      throw ApiError.notFound("Category not found");
    }

    let nextSlug = existing.slug;
    if (input.slug !== undefined) {
      nextSlug = await validateSlugUnique(tx, input.slug, id);
    }

    let nextParentId = existing.parentId;
    if (input.parentId !== undefined) {
      if (input.parentId !== null) {
        await validateParentCycle(tx, id, input.parentId);
      }
      nextParentId = input.parentId;
    }

    const nextName = input.name !== undefined ? input.name.trim() : existing.name;
    const nextDescription =
      input.description !== undefined ? (input.description?.trim() || null) : existing.description;
    const nextSortOrder = input.sortOrder !== undefined ? input.sortOrder : existing.sortOrder;
    const nextIsActive = input.isActive !== undefined ? input.isActive : existing.isActive;

    let updated;
    try {
      [updated] = await tx
        .update(categories)
        .set({
          name: nextName,
          slug: nextSlug,
          description: nextDescription,
          parentId: nextParentId,
          sortOrder: nextSortOrder,
          isActive: nextIsActive,
          updatedAt: sql`now()`,
        })
        .where(eq(categories.id, id))
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw ApiError.conflict("Slug already in use", [
          { field: "slug", message: "Slug already in use" },
        ]);
      }
      throw err;
    }

    const dto = mapToDto(updated);

    await writeAudit(tx, {
      actor: formatActor(actorId),
      action: "category.updated",
      resource: `category:${dto.id}`,
      diff: {
        before: {
          name: existing.name,
          slug: existing.slug,
          parentId: existing.parentId,
          sortOrder: existing.sortOrder,
          isActive: existing.isActive,
        },
        after: {
          name: dto.name,
          slug: dto.slug,
          parentId: dto.parentId,
          sortOrder: dto.sortOrder,
          isActive: dto.isActive,
        },
      },
      requestId,
    });

    return dto;
  });
}

/**
 * Safely deletes a leaf category. Rejects deletion if child subcategories exist.
 */
export async function deleteCategory(
  db: DbContext = defaultDb,
  id: string,
  actorId: string,
  requestId?: string
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runner = (db as any).transaction ? (cb: (tx: DbContext) => Promise<void>) => (db as any).transaction(cb) : (cb: (tx: DbContext) => Promise<void>) => cb(db);

  return runner(async (tx: DbContext) => {
    const [existing] = await tx
      .select()
      .from(categories)
      .where(eq(categories.id, id));

    if (!existing) {
      throw ApiError.notFound("Category not found");
    }

    // Check for child subcategories
    const subcategories = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.parentId, id))
      .limit(1);

    if (subcategories.length > 0) {
      throw ApiError.conflict("Cannot delete category with subcategories");
    }

    await tx.delete(categories).where(eq(categories.id, id));

    await writeAudit(tx, {
      actor: formatActor(actorId),
      action: "category.deleted",
      resource: `category:${id}`,
      diff: {
        deleted: {
          id: existing.id,
          name: existing.name,
          slug: existing.slug,
          parentId: existing.parentId,
        },
      },
      requestId,
    });
  });
}

/**
 * Reorders multiple categories with audit logging.
 */
export async function reorderCategories(
  db: DbContext = defaultDb,
  items: ReorderCategoriesInput["items"],
  actorId: string,
  requestId?: string
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runner = (db as any).transaction ? (cb: (tx: DbContext) => Promise<void>) => (db as any).transaction(cb) : (cb: (tx: DbContext) => Promise<void>) => cb(db);

  return runner(async (tx: DbContext) => {
    const itemIds = items.map((i) => i.id);
    const existingRows = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, itemIds));

    const existingIdSet = new Set(existingRows.map((r) => r.id));
    for (const item of items) {
      if (!existingIdSet.has(item.id)) {
        throw ApiError.notFound(`Category with ID ${item.id} not found`);
      }
    }

    for (const item of items) {
      if (item.parentId !== undefined && item.parentId !== null) {
        await validateParentCycle(tx, item.id, item.parentId);
      }

      await tx
        .update(categories)
        .set({
          sortOrder: item.sortOrder,
          ...(item.parentId !== undefined ? { parentId: item.parentId } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(categories.id, item.id));
    }

    await writeAudit(tx, {
      actor: formatActor(actorId),
      action: "category.reordered",
      resource: "category:collection",
      diff: {
        reorderedCount: items.length,
        items: items.map((i) => ({ id: i.id, sortOrder: i.sortOrder, parentId: i.parentId })),
      },
      requestId,
    });
  });
}

