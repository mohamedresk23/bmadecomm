import { describe, expect, it } from "vitest";
import { combinationKey, createProductSchema, updateProductSchema, decimalToMinor, minorToDecimal, generateVariantMatrix, normalizeSlug, SLUG_REGEX } from "./product";

const valid = { name: "Shirt", categoryIds: ["cat-1"], variants: [{ sku: " shirt-1 ", priceMinor: "1995", attributes: {} }] };

describe("product contracts", () => {
  it("normalizes SKUs and rejects untrusted lifecycle, stock and currency claims", () => {
    expect(createProductSchema.parse(valid).variants[0].sku).toBe("SHIRT-1");
    expect(createProductSchema.parse({ ...valid, variants: [{ sku: "SIMPLE", priceMinor: "0" }] }).variants[0].attributes).toEqual({});
    for (const key of ["status", "currency", "currencyScale", "stock", "cost", "publishedAt"]) expect(createProductSchema.safeParse({ ...valid, [key]: "draft" }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, variants: [{ ...valid.variants[0], id: "forged" }] }).success).toBe(false);
    expect(updateProductSchema.safeParse({ ...valid, variants: [{ ...valid.variants[0], id: "retained" }] }).success).toBe(true);
  });

  it("validates and normalizes slug format, rejecting invalid formats and length violations", () => {
    // Normalization & valid slugs
    const parsed1 = createProductSchema.parse({ ...valid, slug: "  Summer-Linen-Shirt  " });
    expect(parsed1.slug).toBe("summer-linen-shirt");

    const parsed2 = createProductSchema.parse({ ...valid, slug: "custom-linen-top" });
    expect(parsed2.slug).toBe("custom-linen-top");

    expect(createProductSchema.parse({ ...valid, slug: "product-1" }).slug).toBe("product-1");
    expect(createProductSchema.parse({ ...valid, slug: "a" }).slug).toBe("a");

    // Slug length bounds: 255 characters allowed
    const maxSlug = "a".repeat(255);
    expect(createProductSchema.parse({ ...valid, slug: maxSlug }).slug).toBe(maxSlug);

    // Slug length bounds: > 255 rejected
    const tooLongSlug = "a".repeat(256);
    const tooLongRes = createProductSchema.safeParse({ ...valid, slug: tooLongSlug });
    expect(tooLongRes.success).toBe(false);
    if (!tooLongRes.success) {
      expect(tooLongRes.error.issues.some(issue => issue.path.includes("slug"))).toBe(true);
    }

    // Invalid format regex: ^[a-z0-9]+(-[a-z0-9]+)*$
    const invalidSlugs = [
      "Bad_Slug!",      // underscore and exclamation
      "-leading",       // leading hyphen
      "trailing-",      // trailing hyphen
      "double--hyphen", // consecutive hyphens
      "with space",     // internal space
      "invalid@char",   // symbol
      "",               // empty string
      "   ",            // whitespace-only
    ];

    for (const badSlug of invalidSlugs) {
      const res = createProductSchema.safeParse({ ...valid, slug: badSlug });
      expect(res.success, `Expected slug "${badSlug}" to be rejected`).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some(issue => issue.path.includes("slug"))).toBe(true);
      }
    }

    // Slug is optional on create and update
    expect(createProductSchema.safeParse(valid).success).toBe(true);
    expect(updateProductSchema.safeParse(valid).success).toBe(true);
    expect(updateProductSchema.safeParse({ ...valid, slug: "updated-slug" }).success).toBe(true);
    expect(updateProductSchema.safeParse({ ...valid, slug: "Bad_Slug!" }).success).toBe(false);
  });

  it("validates SEO metaTitle and metaDescription lengths and content", () => {
    // Valid title & description
    const withSeo = createProductSchema.parse({
      ...valid,
      metaTitle: "  Summer Shirt - Best Quality  ",
      metaDescription: "  Buy our 100% linen summer shirt with premium quality.  ",
    });
    expect(withSeo.metaTitle).toBe("Summer Shirt - Best Quality");
    expect(withSeo.metaDescription).toBe("Buy our 100% linen summer shirt with premium quality.");

    // Nullable and optional
    expect(createProductSchema.parse({ ...valid, metaTitle: null, metaDescription: null }).metaTitle).toBeNull();
    expect(createProductSchema.parse({ ...valid, metaTitle: undefined, metaDescription: undefined }).metaTitle).toBeUndefined();

    // Meta title max 70 chars
    expect(createProductSchema.safeParse({ ...valid, metaTitle: "a".repeat(70) }).success).toBe(true);
    const badTitle = createProductSchema.safeParse({ ...valid, metaTitle: "a".repeat(71) });
    expect(badTitle.success).toBe(false);
    if (!badTitle.success) expect(badTitle.error.issues.some(i => i.path.includes("metaTitle"))).toBe(true);

    // Meta description max 160 chars
    expect(createProductSchema.safeParse({ ...valid, metaDescription: "a".repeat(160) }).success).toBe(true);
    const badDesc = createProductSchema.safeParse({ ...valid, metaDescription: "a".repeat(161) });
    expect(badDesc.success).toBe(false);
    if (!badDesc.success) expect(badDesc.error.issues.some(i => i.path.includes("metaDescription"))).toBe(true);

    // Controls rejected
    expect(createProductSchema.safeParse({ ...valid, metaTitle: "bad\u0000title" }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, metaDescription: "bad\u0000desc" }).success).toBe(false);
  });

  it.each(["-1", "1.5", "x", "", "01", "1e2", "9223372036854775808"])("rejects malformed or overflowing money %s without throwing", priceMinor => {
    expect(createProductSchema.safeParse({ ...valid, variants: [{ ...valid.variants[0], priceMinor, comparePriceMinor: "1" }] }).success).toBe(false);
  });
  it("requires categories, name, variants and compare-price ordering", () => {
    for (const change of [{ name: " " }, { categoryIds: [] }, { variants: [] }, { variants: [{ ...valid.variants[0], comparePriceMinor: "1994" }] }]) expect(createProductSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
  it("rejects control characters before they reach PostgreSQL text parameters", () => {
    expect(createProductSchema.safeParse({ ...valid, name: "bad\u0000name" }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, categoryIds: ["bad\u0000id"] }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, variants: [{ ...valid.variants[0], attributes: { "bad\u0000name": "x" } }] }).success).toBe(false);
  });
  it("detects equivalent unordered combinations and inconsistent dimensions", () => {
    expect(combinationKey({ Color: " Red ", Size: "M" })).toBe(combinationKey({ size: "m", color: "red" }));
    const variants = [{ sku: "a", priceMinor: "0", attributes: { Color: "Red", Size: "M" } }, { sku: "b", priceMinor: "0", attributes: { size: "m", color: " red " } }];
    expect(createProductSchema.safeParse({ ...valid, variants }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, variants: [variants[0], { ...variants[1], attributes: { color: "blue" } }] }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, variants: [{ ...valid.variants[0], attributes: { Color: "red", " color ": "blue" } }] }).success).toBe(false);
  });
  it("parses decimals exactly at supported scales and bigint boundaries", () => {
    expect(decimalToMinor("0.29", 2)).toBe("29");
    expect(decimalToMinor("90071992547409.93", 2)).toBe("9007199254740993");
    expect(decimalToMinor("92233720368547758.07", 2)).toBe("9223372036854775807");
    expect(minorToDecimal("29", 2)).toBe("0.29");
    expect(decimalToMinor("12", 0)).toBe("12");
    expect(decimalToMinor("1.234", 3)).toBe("1234");
    for (const value of ["0.001", "-1", "1e2", "NaN", "1,20", "92233720368547758.08"]) expect(() => decimalToMinor(value, 2)).toThrow();
  });
  it("builds a bounded matrix and a default simple variant", () => {
    expect(generateVariantMatrix([])).toEqual([{}]);
    expect(generateVariantMatrix([{ name: "Color", values: ["red", "blue"] }, { name: "Size", values: ["s", "m"] }])).toHaveLength(4);
    expect(() => generateVariantMatrix([{ name: "color", values: ["Red", " red "] }])).toThrow();
    expect(() => generateVariantMatrix([{ name: "color", values: ["red"] }, { name: " Color ", values: ["blue"] }])).toThrow();
    expect(() => generateVariantMatrix([{ name: "size", values: Array.from({ length: 101 }, (_, index) => String(index)) }])).toThrow();
  });
  it("rejects malformed Unicode and dimension delimiters at parsing and generation", () => {
    const invalidAttributes: Record<string, string>[] = [{ "bad:name": "x" }, { color: "red,blue" }, { "\ud800": "red" }, { color: "\udfff" }, JSON.parse('{"__proto__":"x"}'), { " __PROTO__ ": "x" }];
    for (const attributes of invalidAttributes) {
      const parsed = createProductSchema.safeParse({ ...valid, variants: [{ ...valid.variants[0], attributes }] });
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.some(issue => issue.path.slice(0, 3).join(".") === "variants.0.attributes")).toBe(true);
      for (const [name, value] of Object.entries(attributes)) expect(() => generateVariantMatrix([{ name, values: [value] }])).toThrow();
    }
    for (const change of [{ name: "bad\ud800" }, { description: "bad\udfff" }, { categoryIds: ["bad\ud800"] }]) expect(createProductSchema.safeParse({ ...valid, ...change }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, name: "قميص 😀", variants: [{ ...valid.variants[0], attributes: { "اللون": "أحمر 😀" } }] }).success).toBe(true);
  });
});
