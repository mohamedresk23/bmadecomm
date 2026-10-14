import { describe, expect, it } from "vitest";
import { combinationKey, createProductSchema, updateProductSchema, decimalToMinor, minorToDecimal, generateVariantMatrix } from "./product";
const valid = { name: "Shirt", categoryIds: ["cat-1"], variants: [{ sku: " shirt-1 ", priceMinor: "1995", attributes: {} }] };
describe("product contracts", () => {
  it("normalizes SKUs and rejects untrusted lifecycle, stock and currency claims", () => {
    expect(createProductSchema.parse(valid).variants[0].sku).toBe("SHIRT-1");
    expect(createProductSchema.parse({ ...valid, variants: [{ sku: "SIMPLE", priceMinor: "0" }] }).variants[0].attributes).toEqual({});
    for (const key of ["status", "currency", "currencyScale", "stock", "cost", "slug"]) expect(createProductSchema.safeParse({ ...valid, [key]: "draft" }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...valid, variants: [{ ...valid.variants[0], id: "forged" }] }).success).toBe(false);
    expect(updateProductSchema.safeParse({ ...valid, variants: [{ ...valid.variants[0], id: "retained" }] }).success).toBe(true);
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
