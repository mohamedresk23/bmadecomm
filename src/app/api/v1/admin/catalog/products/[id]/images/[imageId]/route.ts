import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "../../../../../../../../../db";
import { requireCatalogStaffSession } from "../../../../../../../../../modules/content/settings/infrastructure/admin-auth";
import { deleteGalleryImage } from "../../../../../../../../../modules/catalog/products/application/gallery-service";
import { ApiError } from "../../../../../../../../../shared/api/errors";
import { boundedJson } from "../../../../../../../../../shared/api/bounded-json";
import {
  MAX_DELETE_BODY,
  deleteGalleryImageSchema,
} from "../../../../../../../../../modules/catalog/products/contracts/gallery";

type Context = { params: Promise<{ id: string; imageId: string }> };

function privateHandler(handler: (req: Request, context: Context, requestId: string) => Promise<NextResponse>) {
  return async (req: Request, ...args: unknown[]) => {
    const correlationId = req.headers.get("x-correlation-id") || randomUUID();
    const baseHeaders = new Headers({
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
    });
    if (correlationId) baseHeaders.set("x-correlation-id", correlationId);

    try {
      const response = await handler(req, args[0] as Context, correlationId);
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Pragma", "no-cache");
      response.headers.set("x-correlation-id", correlationId);
      return response;
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        return NextResponse.json(err.toResponse(correlationId), {
          status: err.statusCode,
          headers: baseHeaders,
        });
      }

      console.error(`[${correlationId}] Unhandled Gallery Delete Error:`, err);
      const internalError = ApiError.internal("Internal Server Error", correlationId);
      return NextResponse.json(internalError.toResponse(correlationId), {
        status: 500,
        headers: baseHeaders,
      });
    }
  };
}

export const DELETE = privateHandler(async (req, route, requestId) => {
  const { context } = await requireCatalogStaffSession(req, true);
  const { id: productId, imageId } = await route.params;

  if (!productId.trim() || /[\x00-\x1f\x7f]/.test(productId)) {
    throw ApiError.badRequest("Valid product id required");
  }
  if (!imageId.trim() || /[\x00-\x1f\x7f]/.test(imageId)) {
    throw ApiError.badRequest("Valid image id required");
  }

  const rawJson = await boundedJson(req, MAX_DELETE_BODY);
  const parsed = deleteGalleryImageSchema.safeParse(rawJson);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    throw ApiError.unprocessableEntity("Validation failed", details);
  }

  const gallery = await deleteGalleryImage(db, {
    productId,
    imageId,
    staffUserId: context.userId,
    requestId,
    payload: parsed.data,
  });

  return NextResponse.json({ success: true, gallery }, { status: 200 });
});

