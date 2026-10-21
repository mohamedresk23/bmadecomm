/** Stable issue codes and ID-based paths for publication consumers. */
export type PublicationReadinessCode =
  | "MISSING_NAME" | "MISSING_DESCRIPTION" | "INVALID_SLUG" | "SLUG_CONFLICT"
  | "MISSING_VARIANTS" | "MISSING_SKU" | "INVALID_PRICE"
  | "MISSING_IMAGES" | "MISSING_ALT_TEXT" | "MISSING_CATEGORIES";

export interface PublicationReadinessIssue {
  /** name, description, slug, variants[.<id>.sku|priceMinor], gallery[.<id>.altText], categoryIds */
  field: string;
  code: PublicationReadinessCode;
  message: string;
}

export interface PublicationReadinessDto {
  isReady: boolean;
  issues: PublicationReadinessIssue[];
}
