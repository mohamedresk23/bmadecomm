import { NextResponse } from 'next/server';
import { withErrorHandler } from '../../../shared/api/error-handler';
import { ApiError } from '../../../shared/api/errors';

async function getHandler(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  if (action === 'error') {
    throw ApiError.badRequest('Test error');
  }
  
  if (action === 'crash') {
    throw new Error('Unexpected crash');
  }

  const correlationId = req.headers.get('x-correlation-id') || 'missing';

  return NextResponse.json({ ok: true, correlationId }, {
    headers: { 'x-correlation-id': correlationId }
  });
}

export const GET = withErrorHandler(getHandler);
