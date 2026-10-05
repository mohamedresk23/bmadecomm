import { describe, it, expect } from 'vitest';
import { ApiError } from './errors';
import { validateRequest } from './validation';
import { z } from 'zod';

describe('ApiError', () => {
  it('creates bad request correctly', () => {
    const err = ApiError.badRequest('Invalid', [{ field: 'name', message: 'Required' }]);
    expect(err.statusCode).toBe(400);
    expect(err.toResponse('req-123')).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid',
        details: [{ field: 'name', message: 'Required' }],
        request_id: 'req-123'
      }
    });
  });

  it('creates internal error without leaking details', () => {
    const err = ApiError.internal('Something went wrong');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_SERVER_ERROR');
  });
});

describe('validateRequest', () => {
  const schema = z.object({
    email: z.string().email(),
    age: z.number().min(18)
  });

  it('returns valid data', () => {
    const data = { email: 'test@example.com', age: 20 };
    expect(validateRequest(schema, data)).toEqual(data);
  });

  it('throws ApiError on invalid data', () => {
    const data = { email: 'invalid', age: 15 };
    try {
      validateRequest(schema, data);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.statusCode).toBe(400);
      expect(err.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'email' }),
          expect.objectContaining({ field: 'age' })
        ])
      );
    }
  });
});
