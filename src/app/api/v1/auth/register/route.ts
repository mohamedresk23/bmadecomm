import { randomUUID } from "node:crypto";
import { ApiError } from "../../../../../shared/api/errors";
import { validateRequest } from "../../../../../shared/api/validation";
import { registerRequestSchema } from "../../../../../modules/identity/contracts/registration";
import { composeRegistration } from "../../../../../modules/identity/infrastructure/registration";
import { identityConfig } from "../../../../../modules/identity/infrastructure/config";
import { registrationSource, throttleRegistration } from "../../../../../modules/identity/infrastructure/rate-limit";

export const runtime = "nodejs";

async function boundedJson(req: Request) {
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "JSON content type required");
  }
  const reader = req.body?.getReader();
  if (!reader) throw ApiError.badRequest("JSON body required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  let abortRead!: () => void;
  let timer!: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ApiError(408, "REQUEST_TIMEOUT", "Request body timed out")), 10000);
    abortRead = () => reject(new ApiError(400, "REQUEST_ABORTED", "Request aborted"));
  });
  req.signal?.addEventListener("abort", abortRead, { once: true });
  if (req.signal?.aborted) abortRead();
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      length += value.byteLength;
      if (length > 8192) {
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    // Cancellation callbacks can stall too; do not await cancellation before responding.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw ApiError.badRequest("Malformed JSON"); }
}

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
