import { describe, expect, it } from "vitest";
import { deleteGalleryImageSchema, updateGallerySchema } from "./gallery";

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

describe("delete gallery image request contract", () => {
  it.each(["0", "1", "42", "9223372036854775807"])("accepts valid bounded expectedRevision: %s", (expectedRevision) => {
    expect(deleteGalleryImageSchema.parse({ expectedRevision })).toEqual({ expectedRevision });
  });

  it.each([
    { expectedRevision: "-1" },
    { expectedRevision: "abc" },
    { expectedRevision: "1.5" },
    { expectedRevision: "9223372036854775808" }, // 64-bit overflow
    { expectedRevision: "0", extraField: "not_allowed" }, // strict rejection
    {},
  ])("rejects invalid expectedRevision and unknown fields: %j", (value) => {
    expect(deleteGalleryImageSchema.safeParse(value).success).toBe(false);
  });
});

