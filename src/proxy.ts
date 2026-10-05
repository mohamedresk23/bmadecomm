import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();

  // We set the correlation id on the request headers so it can be read in the API routes
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-correlation-id', correlationId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Always return the correlation id in the response headers
  response.headers.set('x-correlation-id', correlationId);

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
