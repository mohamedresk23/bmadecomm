import { z } from 'zod';
import { ApiError } from './errors';

export function validateRequest<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map(err => ({
      field: err.path.join('.'),
      message: err.message,
    }));
    throw ApiError.badRequest('Validation failed', details);
  }
  return result.data;
}
