export type PublicVariantDto = {
  id: string;
  sku: string;
  priceMinor: string;
  comparePriceMinor: string | null;
  currency: string;
  currencyScale: number;
  attributes: Record<string, string>;
};

export type PublicImageDto = { id: string; position: number; altText: string };

export type PublicProductDto = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  variants: PublicVariantDto[];
  images: PublicImageDto[];
  metaTitle: string;
  metaDescription: string;
};

export type PublicProductResolution =
  | { kind: "product"; product: PublicProductDto }
  | { kind: "redirect"; location: string }
  | { kind: "not-found" };
