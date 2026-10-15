import { z } from "zod";

const wellFormedUnicode = (value: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const noControls = (value: string) => wellFormedUnicode(value) && !/[\u0000-\u001f\u007f]/.test(value);
const identifier = z.string().min(1).max(80).refine(noControls, "Invalid identifier");

export const galleryImageSchema = z.object({
  id: identifier,
  mediaId: identifier,
  position: z.number().int().nonnegative(),
  altText: z.string().max(500).refine(value => wellFormedUnicode(value) && !value.includes("\u0000"), "Invalid alt text"),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  previewUrl: z.string().min(1),
}).strict();

export const variantImageAssignmentSchema = z.object({
  variantId: identifier,
  imageId: identifier,
}).strict();

export const publicationIssueSchema = z.object({
  field: z.string().min(1),
  message: z.string().min(1),
}).strict();

export const gallerySchema = z.object({
  productId: identifier,
  revision: z.string().regex(/^(0|[1-9][0-9]*)$/, "Revision must be an integer string"),
  primaryImageId: identifier.nullable(),
  images: z.array(galleryImageSchema),
  variantImages: z.array(variantImageAssignmentSchema),
  publicationIssues: z.array(publicationIssueSchema),
}).strict();

export const galleryResponseSchema = z.object({
  success: z.literal(true),
  gallery: gallerySchema,
}).strict();

export const uploadImageResponseSchema = z.object({
  success: z.literal(true),
  image: galleryImageSchema,
  gallery: gallerySchema,
}).strict();

export type GalleryImageDto = z.infer<typeof galleryImageSchema>;
export type GalleryDto = z.infer<typeof gallerySchema>;
export type GalleryResponse = z.infer<typeof galleryResponseSchema>;
export type UploadImageResponse = z.infer<typeof uploadImageResponseSchema>;

export const MAX_ACTIVE_IMAGES = 10;
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5,242,880 bytes
export const MULTIPART_OVERHEAD = 64 * 1024;   // 65,536 bytes
export const MAX_REQUEST_BODY = MAX_FILE_SIZE + MULTIPART_OVERHEAD; // 5,308,416 bytes
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

