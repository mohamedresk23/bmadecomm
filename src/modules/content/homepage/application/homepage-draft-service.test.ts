import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, withIsolatedTx } from "../../../../test-utils/db";
import {
  auditEvents,
  categories,
  homepageDrafts,
  homepagePublications,
  products,
  users,
} from "../../../../db/schema";
import {
  getHomepageDraft,
  getLatestPublication,
  updateHomepageDraft,
  validateCatalogReferences,
} from "./homepage-draft-service";
import {
  validateUpdateHomepageDraft,
  type HomepageSectionConfig,
} from "../contracts/section-schema";

beforeAll(setupTestDb);

describe("Homepage Draft Service & Schema Validation", () => {
  describe("validateUpdateHomepageDraft", () => {
    it("validates a valid draft payload with all approved section types", () => {
      const payload = {
        expectedRevision: 1,
        sections: [
          {
            id: "sec-hero",
            type: "hero",
            enabled: true,
            position: 0,
            productIds: ["p-1"],
            categoryIds: ["c-1"],
          },
          {
            id: "sec-cats",
            type: "featured_categories",
            enabled: true,
            position: 1,
            categoryIds: ["c-1", "c-2"],
          },
          {
            id: "sec-prods",
            type: "featured_products",
            enabled: true,
            position: 2,
            productIds: ["p-1", "p-2"],
          },
          {
            id: "sec-best",
            type: "best_sellers",
            enabled: true,
            position: 3,
            limit: 8,
          },
          {
            id: "sec-new",
            type: "new_arrivals",
            enabled: true,
            position: 4,
            limit: 12,
          },
          {
            id: "sec-promo",
            type: "promotions",
            enabled: true,
            position: 5,
            productIds: ["p-3"],
          },
        ],
      };

      const result = validateUpdateHomepageDraft(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.expectedRevision).toBe(1);
        expect(result.data.sections).toHaveLength(6);
      }
    });

    it("rejects an unapproved section type with issue field sections[0].type", () => {
      const payload = {
        expectedRevision: 1,
        sections: [
          {
            id: "sec-custom",
            type: "custom_banner",
            enabled: true,
            position: 0,
          },
        ],
      };

      const result = validateUpdateHomepageDraft(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: "sections[0].type" }),
          ])
        );
      }
    });

    it("rejects expectedRevision < 1 or non-integer", () => {
      const payload = {
        expectedRevision: 0,
        sections: [],
      };

      const result = validateUpdateHomepageDraft(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues.some((i) => i.field === "expectedRevision")).toBe(true);
      }
    });

    it("rejects duplicate section IDs with issue field pointing to the duplicate index", () => {
      const payload = {
        expectedRevision: 1,
        sections: [
          {
            id: "duplicate-id",
            type: "best_sellers",
            enabled: true,
            position: 0,
            limit: 8,
          },
          {
            id: "duplicate-id",
            type: "new_arrivals",
            enabled: true,
            position: 1,
            limit: 8,
          },
        ],
      };

      const result = validateUpdateHomepageDraft(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: "sections[1].id" }),
          ])
        );
      }
    });

    it("rejects non-contiguous or mismatched section positions", () => {
      const payload = {
        expectedRevision: 1,
        sections: [
          {
            id: "sec-0",
            type: "best_sellers",
            enabled: true,
            position: 0,
            limit: 8,
          },
          {
            id: "sec-1",
            type: "new_arrivals",
            enabled: true,
            position: 5, // should be 1
            limit: 8,
          },
        ],
      };

      const result = validateUpdateHomepageDraft(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: "sections[1].position" }),
          ])
        );
      }
    });

    it("rejects drafts with more than 12 sections", () => {
      const sections: HomepageSectionConfig[] = Array.from({ length: 13 }, (_, i) => ({
        id: `sec-${i}`,
        type: "best_sellers" as const,
        enabled: false,
        position: i,
        limit: 8,
      }));

      const result = validateUpdateHomepageDraft({ expectedRevision: 1, sections });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: "sections" }),
          ])
        );
      }
    });

    it("rejects enabled featured_categories with 0 categories", () => {
      const payload = {
        expectedRevision: 1,
        sections: [
          {
            id: "sec-cats",
            type: "featured_categories",
            enabled: true,
            position: 0,
            categoryIds: [],
          },
        ],
      };

      const result = validateUpdateHomepageDraft(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: "sections[0].categoryIds" }),
          ])
        );
      }
    });

    it("rejects duplicate category IDs in featured_categories", () => {
      const payload = {
        expectedRevision: 1,
        sections: [
          {
            id: "sec-cats",
            type: "featured_categories",
            enabled: true,
            position: 0,
            categoryIds: ["cat-1", "cat-1"],
          },
        ],
      };

      const result = validateUpdateHomepageDraft(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: "sections[0].categoryIds[1]" }),
          ])
        );
      }
    });

    it("rejects enabled featured_products with 0 products", () => {
      const payload = {
        expectedRevision: 1,
        sections: [
          {
            id: "sec-prods",
            type: "featured_products",
            enabled: true,
            position: 0,
            productIds: [],
          },
        ],
      };

      const result = validateUpdateHomepageDraft(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: "sections[0].productIds" }),
          ])
        );
      }
    });

    it("rejects duplicate product IDs in featured_products", () => {
      const payload = {
        expectedRevision: 1,
        sections: [
          {
            id: "sec-prods",
            type: "featured_products",
            enabled: true,
            position: 0,
            productIds: ["prod-1", "prod-1"],
          },
        ],
      };

      const result = validateUpdateHomepageDraft(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ field: "sections[0].productIds[1]" }),
          ])
        );
      }
    });

    it("rejects best_sellers or new_arrivals limits outside 1..24", () => {
      const resultTooLow = validateUpdateHomepageDraft({
        expectedRevision: 1,
        sections: [{ id: "b1", type: "best_sellers", enabled: true, position: 0, limit: 0 }],
      });
      expect(resultTooLow.success).toBe(false);

      const resultTooHigh = validateUpdateHomepageDraft({
        expectedRevision: 1,
        sections: [{ id: "b2", type: "new_arrivals", enabled: true, position: 0, limit: 25 }],
      });
      expect(resultTooHigh.success).toBe(false);
    });
  });

  describe("getHomepageDraft & getLatestPublication", () => {
    it("returns default initialized draft with empty sections and revision 1", async () => {
      await withIsolatedTx(async (tx) => {
        // Clear any existing draft row in the isolated tx
        await tx.delete(homepageDrafts);

        const draft = await getHomepageDraft(tx);
        expect(draft).toMatchObject({
          key: "default",
          sections: [],
          revision: 1,
        });

        // Calling again returns the existing row
        const draftAgain = await getHomepageDraft(tx);
        expect(draftAgain.revision).toBe(1);
      });
    });

    it("returns null when no homepage publications exist", async () => {
      await withIsolatedTx(async (tx) => {
        await tx.delete(homepagePublications);
        const latest = await getLatestPublication(tx);
        expect(latest).toBeNull();
      });
    });
  });

  describe("validateCatalogReferences", () => {
    it("returns success: true when all referenced catalog items exist", async () => {
      await withIsolatedTx(async (tx) => {
        await tx.insert(categories).values([
          { id: "cat-ok-1", name: "تصنيف 1", slug: "cat-ok-1" },
          { id: "cat-ok-2", name: "تصنيف 2", slug: "cat-ok-2" },
        ]);
        await tx.insert(products).values([
          { id: "prod-ok-1", name: "منتج 1", slug: "prod-ok-1" },
          { id: "prod-ok-2", name: "منتج 2", slug: "prod-ok-2" },
        ]);

        const sections: HomepageSectionConfig[] = [
          {
            id: "hero-1",
            type: "hero",
            enabled: true,
            position: 0,
            productIds: ["prod-ok-1"],
            categoryIds: ["cat-ok-1"],
          },
          {
            id: "featured-1",
            type: "featured_products",
            enabled: true,
            position: 1,
            productIds: ["prod-ok-2"],
          },
          {
            id: "cats-1",
            type: "featured_categories",
            enabled: true,
            position: 2,
            categoryIds: ["cat-ok-2"],
          },
        ];

        const result = await validateCatalogReferences(tx, sections);
        expect(result.success).toBe(true);
        expect(result.issues).toHaveLength(0);
      });
    });

    it("returns structured field path when a product ID does not exist", async () => {
      await withIsolatedTx(async (tx) => {
        const sections: HomepageSectionConfig[] = [
          {
            id: "feat-prods",
            type: "featured_products",
            enabled: true,
            position: 0,
            productIds: ["non-existent-prod-id"],
          },
        ];

        const result = await validateCatalogReferences(tx, sections);
        expect(result.success).toBe(false);
        expect(result.issues).toEqual([
          {
            field: "sections[0].productIds[0]",
            message: "Referenced product 'non-existent-prod-id' does not exist",
          },
        ]);
      });
    });

    it("returns structured field path when a category ID does not exist", async () => {
      await withIsolatedTx(async (tx) => {
        const sections: HomepageSectionConfig[] = [
          {
            id: "feat-cats",
            type: "featured_categories",
            enabled: true,
            position: 0,
            categoryIds: ["non-existent-cat-id"],
          },
        ];

        const result = await validateCatalogReferences(tx, sections);
        expect(result.success).toBe(false);
        expect(result.issues).toEqual([
          {
            field: "sections[0].categoryIds[0]",
            message: "Referenced category 'non-existent-cat-id' does not exist",
          },
        ]);
      });
    });
  });

  describe("updateHomepageDraft", () => {
    it("updates draft with valid sections, increments revision, and records audit event", async () => {
      await withIsolatedTx(async (tx) => {
        await tx.insert(users).values({
          id: "staff-user-123",
          name: "Staff Test",
          email: "staff123@example.test",
          phone: "01011112222",
          passwordHash: "hash",
          role: "staff",
        });
        await tx.insert(products).values([
          { id: "p-valid-1", name: "منتج تجريبي", slug: "p-valid-1" },
        ]);

        const initialDraft = await getHomepageDraft(tx);
        const nextSections: HomepageSectionConfig[] = [
          {
            id: "sec-fp",
            type: "featured_products",
            enabled: true,
            position: 0,
            productIds: ["p-valid-1"],
          },
        ];

        const updated = await updateHomepageDraft(
          tx,
          { expectedRevision: initialDraft.revision, sections: nextSections },
          "staff-user-123",
          "req-test-1"
        );

        expect(updated.revision).toBe(initialDraft.revision + 1);
        expect(updated.sections).toEqual(nextSections);

        // Verify draft row in DB
        const [persisted] = await tx
          .select()
          .from(homepageDrafts)
          .where(eq(homepageDrafts.key, "default"));
        expect(persisted.revision).toBe(initialDraft.revision + 1);
        expect(persisted.sections).toEqual(nextSections);

        // Verify audit event
        const audits = await tx
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.action, "content.homepage.draft.save"));
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          actor: "staff:staff-user-123",
          resource: "homepage_draft:default",
          requestId: "req-test-1",
        });
      });
    });

    it("rejects update with 409 Conflict when expectedRevision does not match current DB revision", async () => {
      await withIsolatedTx(async (tx) => {
        const initialDraft = await getHomepageDraft(tx);

        // Try to update with stale expectedRevision
        await expect(
          updateHomepageDraft(
            tx,
            { expectedRevision: initialDraft.revision + 5, sections: [] },
            "staff-user-123"
          )
        ).rejects.toMatchObject({
          statusCode: 409,
          message: "Draft has been modified by another user",
        });

        // Verify no audit event was created
        const audits = await tx
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.action, "content.homepage.draft.save"));
        expect(audits).toHaveLength(0);
      });
    });

    it("rejects update with 422 when referencing non-existent catalog items and leaves DB unchanged", async () => {
      await withIsolatedTx(async (tx) => {
        const initialDraft = await getHomepageDraft(tx);

        const invalidSections: HomepageSectionConfig[] = [
          {
            id: "sec-fp",
            type: "featured_products",
            enabled: true,
            position: 0,
            productIds: ["does-not-exist"],
          },
        ];

        await expect(
          updateHomepageDraft(
            tx,
            { expectedRevision: initialDraft.revision, sections: invalidSections },
            "staff-user-123"
          )
        ).rejects.toMatchObject({
          statusCode: 422,
          details: [
            {
              field: "sections[0].productIds[0]",
              message: "Referenced product 'does-not-exist' does not exist",
            },
          ],
        });

        // DB draft remains at initial revision
        const current = await getHomepageDraft(tx);
        expect(current.revision).toBe(initialDraft.revision);
      });
    });
  });
});
