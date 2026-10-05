import { z } from 'zod';

export const PagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20), // Max page size is 100
});

export type PagingParams = z.infer<typeof PagingSchema>;

export function getPagingParams(searchParams: URLSearchParams): PagingParams {
  const page = searchParams.get('page') || undefined;
  const page_size = searchParams.get('page_size') || undefined;
  
  return PagingSchema.parse({ page, page_size });
}
