import { describe, it, expect } from 'vitest';
import { requirePermission, requireOwnership, redactFields, PolicyContext } from './policy';
import { ApiError } from '../api/errors';

describe('policy evaluation', () => {
  describe('requirePermission', () => {
    it('throws unauthorized if no user', () => {
      const ctx: PolicyContext = {};
      expect(() => requirePermission(ctx, 'read:reports')).toThrowError(
        expect.objectContaining({ statusCode: 401 })
      );
    });

    it('throws forbidden if user lacks permission', () => {
      const ctx: PolicyContext = {
        user: { id: 'u1', roles: ['staff'], permissions: ['read:orders'] }
      };
      expect(() => requirePermission(ctx, 'write:orders')).toThrowError(
        expect.objectContaining({ statusCode: 403, code: 'FORBIDDEN' })
      );
    });

    it('passes if user has permission', () => {
      const ctx: PolicyContext = {
        user: { id: 'u1', roles: ['staff'], permissions: ['write:orders'] }
      };
      expect(() => requirePermission(ctx, 'write:orders')).not.toThrow();
    });
  });

  describe('requireOwnership', () => {
    it('throws forbidden if no user', () => {
      const ctx: PolicyContext = {};
      expect(() => requireOwnership(ctx, 'u1')).toThrowError(
        expect.objectContaining({ statusCode: 403 })
      );
    });

    it('throws forbidden if user id does not match resource owner', () => {
      const ctx: PolicyContext = {
        user: { id: 'u2', roles: [] }
      };
      expect(() => requireOwnership(ctx, 'u1')).toThrowError(
        expect.objectContaining({ statusCode: 403 })
      );
    });

    it('passes if user id matches resource owner', () => {
      const ctx: PolicyContext = {
        user: { id: 'u1', roles: [] }
      };
      expect(() => requireOwnership(ctx, 'u1')).not.toThrow();
    });
  });

  describe('redactFields', () => {
    it('redacts unallowed fields from object', () => {
      const obj = { id: 1, secret: 'hide', public: 'show' };
      const redacted = redactFields(obj, ['id', 'public']);
      expect(redacted).toEqual({ id: 1, public: 'show' });
    });
  });
});

