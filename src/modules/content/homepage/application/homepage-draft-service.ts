import { desc, eq, inArray } from "drizzle-orm";
import type { DbContext } from "../../../../db/tx";
import { withTransaction } from "../../../../db/tx";
import {
  categories,
  homepageDrafts,
  homepagePublications,
  products,
} from "../../../../db/schema";
import { ApiError } from "../../../../shared/api/errors";
import { writeAudit } from "../../../../shared/authz/audit";
import type {
  HomepageSectionConfig,
  UpdateHomepageDraftInput,
} from "../contracts/section-schema";

export interface HomepageDraftDto {
  key: string;
  sections: HomepageSectionConfig[];
  revision: number;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface LatestPublicationDto {
  version: number;
  sourceDraftRevision: number;
  publishedAt: Date;
  publishedBy: string;
}

export async function getHomepageDraft(db: DbContext): Promise<HomepageDraftDto> {
  let [row] = await db
    .select()
    .from(homepageDrafts)
    .where(eq(homepageDrafts.key, "default"));

  if (!row) {
    const [seeded] = await db
      .insert(homepageDrafts)
      .values({
        key: "default",
        sections: [],
        revision: 1,
      })
      .onConflictDoNothing()
      .returning();

    row =
      seeded ??
      (
        await db
          .select()
          .from(homepageDrafts)
          .where(eq(homepageDrafts.key, "default"))
      )[0];
  }

  return {
    key: row.key,
    sections: row.sections,
    revision: row.revision,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

export async function getLatestPublication(
  db: DbContext
): Promise<LatestPublicationDto | null> {
  const [pub] = await db
    .select({
      version: homepagePublications.version,
      sourceDraftRevision: homepagePublications.sourceDraftRevision,
      publishedAt: homepagePublications.publishedAt,
      publishedBy: homepagePublications.publishedBy,
    })
    .from(homepagePublications)
    .orderBy(desc(homepagePublications.version))
    .limit(1);

  return pub ?? null;
}

export async function validateCatalogReferences(
  db: DbContext,
  sections: HomepageSectionConfig[]
): Promise<{ success: boolean; issues: { field: string; message: string }[] }> {
  const productRefs: { id: string; field: string }[] = [];
  const categoryRefs: { id: string; field: string }[] = [];

  sections.forEach((sec, sIdx) => {
    switch (sec.type) {
      case "hero":
        sec.productIds.forEach((pid, pIdx) => {
          productRefs.push({ id: pid, field: `sections[${sIdx}].productIds[${pIdx}]` });
        });
        sec.categoryIds.forEach((cid, cIdx) => {
          categoryRefs.push({ id: cid, field: `sections[${sIdx}].categoryIds[${cIdx}]` });
        });
        break;
      case "featured_categories":
        sec.categoryIds.forEach((cid, cIdx) => {
          categoryRefs.push({ id: cid, field: `sections[${sIdx}].categoryIds[${cIdx}]` });
        });
        break;
      case "featured_products":
        sec.productIds.forEach((pid, pIdx) => {
          productRefs.push({ id: pid, field: `sections[${sIdx}].productIds[${pIdx}]` });
        });
        break;
      case "promotions":
        sec.productIds.forEach((pid, pIdx) => {
          productRefs.push({ id: pid, field: `sections[${sIdx}].productIds[${pIdx}]` });
        });
        break;
      case "best_sellers":
      case "new_arrivals":
        // dynamic queries, no catalog IDs to validate
        break;
    }
  });

  const issues: { field: string; message: string }[] = [];

  if (productRefs.length > 0) {
    const uniquePids = Array.from(new Set(productRefs.map((r) => r.id)));
    const existingProducts = await db
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.id, uniquePids));
    const existingSet = new Set(existingProducts.map((p) => p.id));

    productRefs.forEach((ref) => {
      if (!existingSet.has(ref.id)) {
        issues.push({
          field: ref.field,
          message: `Referenced product '${ref.id}' does not exist`,
        });
      }
    });
  }

  if (categoryRefs.length > 0) {
    const uniqueCids = Array.from(new Set(categoryRefs.map((r) => r.id)));
    const existingCategories = await db
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, uniqueCids));
    const existingSet = new Set(existingCategories.map((c) => c.id));

    categoryRefs.forEach((ref) => {
      if (!existingSet.has(ref.id)) {
        issues.push({
          field: ref.field,
          message: `Referenced category '${ref.id}' does not exist`,
        });
      }
    });
  }

  return {
    success: issues.length === 0,
    issues,
  };
}

export async function updateHomepageDraft(
  db: DbContext,
  input: UpdateHomepageDraftInput,
  actor: string,
  requestId?: string
): Promise<HomepageDraftDto> {
  return withTransaction(db, async (tx) => {
    // 1. Reference validation
    const refResult = await validateCatalogReferences(tx, input.sections);
    if (!refResult.success) {
      throw ApiError.unprocessableEntity("Validation failed", refResult.issues);
    }

    // 2. Lock current draft row
    let [current] = await tx
      .select()
      .from(homepageDrafts)
      .where(eq(homepageDrafts.key, "default"))
      .for("update");

    if (!current) {
      const [seeded] = await tx
        .insert(homepageDrafts)
        .values({ key: "default", sections: [], revision: 1 })
        .onConflictDoNothing()
        .returning();
      current =
        seeded ??
        (
          await tx
            .select()
            .from(homepageDrafts)
            .where(eq(homepageDrafts.key, "default"))
            .for("update")
        )[0];
    }

    // 3. Optimistic concurrency check
    if (current.revision !== input.expectedRevision) {
      throw ApiError.conflict("Draft has been modified by another user");
    }

    // 4. Update draft
    const nextRevision = current.revision + 1;
    const now = new Date();
    const [updated] = await tx
      .update(homepageDrafts)
      .set({
        sections: input.sections,
        revision: nextRevision,
        updatedBy: actor,
        updatedAt: now,
      })
      .where(eq(homepageDrafts.key, "default"))
      .returning();

    // 5. Audit event in same transaction
    await writeAudit(tx, {
      actor: actor.startsWith("staff:") ? actor : `staff:${actor}`,
      action: "content.homepage.draft.save",
      resource: "homepage_draft:default",
      requestId,
      diff: {
        before: {
          revision: current.revision,
          sections: current.sections,
        },
        after: {
          revision: nextRevision,
          sections: input.sections,
        },
      },
    });

    return {
      key: updated.key,
      sections: updated.sections,
      revision: updated.revision,
      updatedBy: updated.updatedBy,
      updatedAt: updated.updatedAt,
    };
  });
}

