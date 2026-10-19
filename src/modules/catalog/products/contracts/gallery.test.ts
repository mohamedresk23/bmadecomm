import { describe, expect, it } from "vitest";
import { updateGallerySchema } from "./gallery";

describe("variant mapping request contract", () => {
  const input = { expectedRevision: "0", images: [{ id: "i", altText: "Front" }], variantImages: [{ variantId: "v1", imageId: "i" }, { variantId: "v2", imageId: "i" }] };
  it("allows shared images and defaults omission to explicit clear", () => {
    expect(updateGallerySchema.parse(input).variantImages).toHaveLength(2);
    expect(updateGallerySchema.parse({ expectedRevision: "0", images: input.images }).variantImages).toEqual([]);
  });
  it.each([
    { ...input, variantImages: [input.variantImages[0], input.variantImages[0]] },
    { ...input, variantImages: [{ variantId: "v1", imageId: "foreign" }] },
    { ...input, variantImages: [{ variantId: "v1", imageId: "i", previewUrl: "https://example.test" }] },
    { ...input, images: [...input.images, ...input.images] },
  ])("rejects duplicate, foreign-membership and writable private URL input", value => {
    expect(updateGallerySchema.safeParse(value).success).toBe(false);
  });
});
