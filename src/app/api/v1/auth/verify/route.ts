import { randomUUID } from "node:crypto";
import { ApiError } from "../../../../../shared/api/errors";
import { boundedJson } from "../../../../../shared/api/bounded-json";
import { verifyRequestSchema, INVALID_VERIFICATION } from "../../../../../modules/identity/contracts/verification";
import { composeVerification } from "../../../../../modules/identity/infrastructure/verification";
import { identityConfig } from "../../../../../modules/identity/infrastructure/config";
import { registrationSource, throttleVerification } from "../../../../../modules/identity/infrastructure/rate-limit";

export const runtime = "nodejs";
export async function POST(req: Request) {
  const requestId = randomUUID();
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Request-Id": requestId };
  try {
    let config: ReturnType<typeof identityConfig>;
    try { config = identityConfig(); }
    catch { throw new ApiError(503, "SERVICE_UNAVAILABLE", "Verification unavailable"); }
    const origin = req.headers.get("origin");
    if (origin && origin !== config.origin) throw ApiError.forbidden("Origin not allowed");
    const body = await boundedJson(req);
    const { db } = await import("../../../../../db");
    const retry = await throttleVerification(db, registrationSource(req, config.trustedHeader));
    if (retry) {
      headers["Retry-After"] = String(retry);
      throw new ApiError(429, "TOO_MANY_REQUESTS", "Please try again later");
    }
    const input = verifyRequestSchema.safeParse(body);
    if (!input.success || !await composeVerification(db)(input.data)) throw ApiError.badRequest(INVALID_VERIFICATION);
    return Response.json({ data: { message: "Email verified." } }, { headers });
  } catch (error) {
    const safe = error instanceof ApiError ? error : ApiError.internal();
    return Response.json(safe.toResponse(requestId), { status: safe.statusCode, headers });
  }
}
