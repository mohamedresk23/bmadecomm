import { describe, it, expect } from 'vitest';
import { getPagingParams } from './paging';

describe('Paging Params Validation', () => {
  it('uses default values when no params provided', () => {
    const searchParams = new URLSearchParams('');
    const params = getPagingParams(searchParams);
    expect(params).toEqual({ page: 1, page_size: 20 });
  });

  it('parses valid string values', () => {
    const searchParams = new URLSearchParams('page=2&page_size=50');
    const params = getPagingParams(searchParams);
    expect(params).toEqual({ page: 2, page_size: 50 });
  });

  it('clamps page_size to max 100', () => {
    const searchParams = new URLSearchParams('page=1&page_size=200');
    try {
      getPagingParams(searchParams);
      expect.fail('Should fail Zod parsing on max');
    } catch(e: unknown) {
      const err = e as { issues: { message: string }[] };
      expect(err.issues[0].message).toContain('expected number to be <=100');
    }
  });
});
