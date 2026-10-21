import { eq } from "drizzle-orm";
import { products } from "../../../../db/schema";
import { type DbContext, withTransaction } from "../../../../db/tx";
import { ApiError } from "../../../../shared/api/errors";
import { writeAudit } from "../../../../shared/authz/audit";
import { getProductById } from "./product-service";
import { getPublicationReadiness } from "./publication-readiness-service";

export type PublicationTarget = "published" | "draft";

export async function transitionPublication(db: DbContext, id: string, target: PublicationTarget, actorId: string, requestId?: string) {
  return withTransaction(db, async tx => {
    // Acquire the aggregate lock before starting the readiness snapshot statement.
    const [before] = await tx.select().from(products).where(eq(products.id, id)).for("update");
    if (!before) throw ApiError.notFound("Product not found");
    if (before.status === "archived") throw ApiError.conflict("Archived products cannot change publication status");
    if (before.status === target) return getProductById(tx, id);
    if (target === "published") {
      const readiness = await getPublicationReadiness(tx, id);
      if (!readiness.isReady) throw new ApiError(422, "PUBLICATION_READINESS_FAILED", "Product does not meet the requirements for publication.", readiness.issues);
    }
    const now = new Date();
    const publishedAt = target === "published" ? before.publishedAt ?? now : before.publishedAt;
    await tx.update(products).set({ status: target, publishedAt, updatedAt: now }).where(eq(products.id, id));
    await writeAudit(tx, {
      actor: actorId.startsWith("staff:") ? actorId : `staff:${actorId}`,
      action: target === "published" ? "product.publish" : "product.unpublish",
      resource: `product:${id}`, requestId,
      diff: {
        before: { status: before.status, publishedAt: before.publishedAt?.toISOString() ?? null },
        after: { status: target, publishedAt: publishedAt?.toISOString() ?? null },
      },
    });
    return getProductById(tx, id);
  });
}

export const publishProduct = (db: DbContext, id: string, actorId: string, requestId?: string) => transitionPublication(db, id, "published", actorId, requestId);
export const unpublishProduct = (db: DbContext, id: string, actorId: string, requestId?: string) => transitionPublication(db, id, "draft", actorId, requestId);
