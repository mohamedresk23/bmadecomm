import { NextResponse } from 'next/server';
import { ApiError } from './errors';

export function withErrorHandler(handler: (req: Request, ...args: unknown[]) => Promise<NextResponse>) {
  return async (req: Request, ...args: unknown[]) => {
    try {
      return await handler(req, ...args);
    } catch (error) {
      const correlationId = req.headers.get('x-correlation-id') || undefined;

      if (error instanceof ApiError) {
        return NextResponse.json(
          error.toResponse(correlationId),
          { status: error.statusCode, headers: { 'x-correlation-id': correlationId || '' } }
        );
      }

      // Unhandled generic error
      console.error(`[${correlationId}] Unhandled Error:`, error);
      const internalError = ApiError.internal('Internal Server Error', correlationId);
      return NextResponse.json(
        internalError.toResponse(correlationId),
        { status: 500, headers: { 'x-correlation-id': correlationId || '' } }
      );
    }
  };
}
