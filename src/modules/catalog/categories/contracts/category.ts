import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";

export const CATEGORY_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Normalizes input string to lowercase kebab-case.
 */
export function normalizeSlug(input: string): string {
  if (!input) return "";
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Generates a valid slug from a category name, falling back to a cuid-based slug for non-ASCII names.
 */
export function generateCategorySlug(name: string, explicitSlug?: string): string {
  if (explicitSlug && explicitSlug.trim()) {
    return explicitSlug.trim();
  }
  const normalized = normalizeSlug(name);
  if (normalized) {
    return normalized;
  }
  return `cat-${createId()}`;
}

export const createCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must not exceed 100 characters"),
  slug: z
    .string()
    .trim()
    .min(1, "Slug cannot be empty")
    .max(100, "Slug must not exceed 100 characters")
    .optional(),
  description: z
    .string()
    .trim()
    .max(1000, "Description must not exceed 1000 characters")
    .nullable()
    .optional(),
  parentId: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .optional(),
  sortOrder: z
    .number()
    .int()
    .min(0, "Sort order must be non-negative")
    .default(0)
    .optional(),
  isActive: z
    .boolean()
    .default(true)
    .optional(),
});

export const updateCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name cannot be empty")
    .max(100, "Name must not exceed 100 characters")
    .optional(),
  slug: z
    .string()
    .trim()
    .min(1, "Slug cannot be empty")
    .max(100, "Slug must not exceed 100 characters")
    .optional(),
  description: z
    .string()
    .trim()
    .max(1000, "Description must not exceed 1000 characters")
    .nullable()
    .optional(),
  parentId: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .optional(),
  sortOrder: z
    .number()
    .int()
    .min(0, "Sort order must be non-negative")
    .optional(),
  isActive: z
    .boolean()
    .optional(),
});

export const reorderCategoryItemSchema = z.object({
  id: z.string().min(1, "Category ID is required"),
  sortOrder: z.number().int().min(0, "Sort order must be non-negative"),
  parentId: z.string().nullable().optional(),
});

export const reorderCategoriesSchema = z.object({
  items: z.array(reorderCategoryItemSchema).min(1, "At least one item is required to reorder"),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;

export type CategoryDto = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CategoryTreeNode = CategoryDto & {
  children: CategoryTreeNode[];
};
