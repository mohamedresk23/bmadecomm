import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "../../../../db";
import { boundedJson } from "../../../../shared/api/bounded-json";
import { ApiError } from "../../../../shared/api/errors";
import { requireCatalogStaffSession } from "../../../content/settings/infrastructure/admin-auth";
import { publicationRequestSchema } from "../contracts/publication";
import { transitionPublication, type PublicationTarget } from "../application/publication-service";

export type PublicationContext = { params: Promise<{ id: string }> };
export function publicationHandler(target: PublicationTarget) {
  return async (req: Request, context: PublicationContext) => {
    const requestId = req.headers.get("x-correlation-id") || randomUUID();
    const headers = { "Cache-Control": "private, no-store", Pragma: "no-cache", "x-correlation-id": requestId };
    try {
      const { context: staff, csrf } = await requireCatalogStaffSession(req, true);
      const parsed = publicationRequestSchema.safeParse(await boundedJson(req));
      if (!parsed.success) throw ApiError.badRequest("Expected an empty JSON object");
      const { id } = await context.params;
      const product = await transitionPublication(db, id, target, staff.userId, requestId);
      return NextResponse.json({ success: true, product, csrf }, { headers });
    } catch (error) {
      if (!(error instanceof ApiError)) console.error(`[${requestId}] Unhandled Error:`, error);
      const failure = error instanceof ApiError ? error : ApiError.internal();
      return NextResponse.json(failure.toResponse(requestId), { status: failure.statusCode, headers });
    }
  };
}
