import { randomUUID } from "node:crypto";
import { ApiError } from "../../../../../shared/api/errors";
import { validateRequest } from "../../../../../shared/api/validation";
import { registerRequestSchema } from "../../../../../modules/identity/contracts/registration";
import { composeRegistration } from "../../../../../modules/identity/infrastructure/registration";
import { identityConfig } from "../../../../../modules/identity/infrastructure/config";
import { registrationSource, throttleRegistration } from "../../../../../modules/identity/infrastructure/rate-limit";

export const runtime = "nodejs";

import { boundedJson } from '../../../../../shared/api/bounded-json';

export async function POST(req: Request) {
  const requestId = randomUUID();
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Request-Id": requestId };
  try {
    let config: ReturnType<typeof identityConfig>;
    try { config = identityConfig(); }
    catch { throw new ApiError(503, "SERVICE_UNAVAILABLE", "Registration unavailable"); }
    const origin = req.headers.get("origin");
    if (origin && origin !== config.origin) throw ApiError.forbidden("Origin not allowed");
    const dto = validateRequest(registerRequestSchema, await boundedJson(req));
    // Defer the database import until runtime; build never needs a live database.
    const { db } = await import("../../../../../db");
    const retry = await throttleRegistration(db, registrationSource(req, config.trustedHeader), dto.email);
    if (retry) {
      headers["Retry-After"] = String(retry);
      throw new ApiError(429, "TOO_MANY_REQUESTS", "Please try again later");
    }
    await composeRegistration(db, config.key)(dto);
    return Response.json({ data: { message: "Registration successful. Please check your email for the verification link." } }, { headers });
  } catch (error) {
    // Identity routes never log exception payloads, including database errors.
    const safe = error instanceof ApiError ? error : ApiError.internal();
    return Response.json(safe.toResponse(requestId), { status: safe.statusCode, headers });
  }
}
