import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../shared/api/errors";

export function mediaHandler(handler: (request: Request) => Promise<NextResponse>) {
  return async (request: Request) => {
    const supplied = request.headers.get("x-correlation-id");
    const correlation = supplied && /^[a-zA-Z0-9_-]{1,128}$/.test(supplied) ? supplied : randomUUID();
    let response: NextResponse;
    try { response = await handler(request); }
    catch (error) {
      const safe = error instanceof ApiError ? error : ApiError.internal();
      if (safe.statusCode >= 500) console.error("Media operation failed", { correlation, code: safe.code });
      response = NextResponse.json(safe.toResponse(correlation), { status: safe.statusCode });
    }
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("x-correlation-id", correlation);
    return response;
  };
}
