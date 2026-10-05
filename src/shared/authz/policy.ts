import { ApiError } from '../api/errors';

export type UserContext = {
  id: string;
  roles: string[];
  permissions?: string[]; // Added for F00-04 tests until E02 matrix
};

export type PolicyContext = {
  user?: UserContext;
};

/**
 * Ensures the user has a specific permission.
 * Denies by default. E02 will implement the DB role->permission matrix.
 */
export function requirePermission(context: PolicyContext, permission: string): void {
  if (!context.user) {
    throw ApiError.unauthorized('Authentication required');
  }
  
  if (!context.user.permissions?.includes(permission)) {
    throw ApiError.forbidden(`Missing permission: ${permission}`);
  }
}

/**
 * Ensures the user owns the specified resource.
 */
export function requireOwnership(context: PolicyContext, resourceOwnerId: string): void {
  if (!context.user || context.user.id !== resourceOwnerId) {
    throw ApiError.forbidden('You do not own this resource');
  }
}

/**
 * Field-level redaction helper.
 * Redacts fields from an object based on allowed fields.
 */
export function redactFields<T extends Record<string, unknown>>(
  obj: T,
  allowedFields: (keyof T)[]
): Partial<T> {
  const result: Partial<T> = {};
  for (const field of allowedFields) {
    if (field in obj) {
      result[field] = obj[field];
    }
  }
  return result;
}
