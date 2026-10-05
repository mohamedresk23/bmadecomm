import { describe, it, expect } from 'vitest';
import { GET } from '../../app/api/correlation-test/route';

describe('Correlation ID & Error Handler', () => {
  it('returns correlation id from headers on success', async () => {
    const req = new Request('http://localhost:3000/api/correlation-test?action=success', {
      headers: { 'x-correlation-id': 'test-123' }
    });
    const res = await GET(req);
    const data = await res.json();
    
    expect(res.status).toBe(200);
    expect(res.headers.get('x-correlation-id')).toBe('test-123');
    expect(data.correlationId).toBe('test-123');
  });

  it('formats handled ApiError and returns correlation id', async () => {
    const req = new Request('http://localhost:3000/api/correlation-test?action=error', {
      headers: { 'x-correlation-id': 'test-123' }
    });
    const res = await GET(req);
    const data = await res.json();
    
    expect(res.status).toBe(400);
    expect(res.headers.get('x-correlation-id')).toBe('test-123');
    expect(data.error.code).toBe('BAD_REQUEST');
    expect(data.error.request_id).toBe('test-123');
  });

  it('formats unhandled error as 500 and returns correlation id', async () => {
    const req = new Request('http://localhost:3000/api/correlation-test?action=crash', {
      headers: { 'x-correlation-id': 'test-123' }
    });
    const res = await GET(req);
    const data = await res.json();
    
    expect(res.status).toBe(500);
    expect(res.headers.get('x-correlation-id')).toBe('test-123');
    expect(data.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(data.error.request_id).toBe('test-123');
  });
});
