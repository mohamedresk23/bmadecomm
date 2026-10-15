import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "../../../../../../../../db";
import { requireCatalogStaffSession } from "../../../../../../../../modules/content/settings/infrastructure/admin-auth";
import {
  getGalleryByProductId,
  uploadGalleryImage,
} from "../../../../../../../../modules/catalog/products/application/gallery-service";
import { readMediaFile } from "../../../../../../../../lib/media/request";
import { ApiError } from "../../../../../../../../shared/api/errors";

type Context = { params: Promise<{ id: string }> };

function privateHandler(handler: (req: Request, context: Context) => Promise<NextResponse>) {
  return async (req: Request, ...args: unknown[]) => {
    const correlationId = req.headers.get("x-correlation-id") || undefined;
    const baseHeaders = new Headers({
      "Cache-Control": "private, no-store",
      Pragma: "no-cache",
    });
    if (correlationId) baseHeaders.set("x-correlation-id", correlationId);

    try {
      const response = await handler(req, args[0] as Context);
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Pragma", "no-cache");
      return response;
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.statusCode === 429) {
          const retryDetail = err.details?.find((i) => i.field === "upload");
          const match = retryDetail?.message.match(/Retry after (\d+) seconds/);
          baseHeaders.set("Retry-After", match ? match[1] : "600");
        }
        return NextResponse.json(err.toResponse(correlationId), {
          status: err.statusCode,
          headers: baseHeaders,
        });
      }

      console.error(`[${correlationId}] Unhandled Gallery Error:`, err);
      const internalError = ApiError.internal("Internal Server Error", correlationId);
      return NextResponse.json(internalError.toResponse(correlationId), {
        status: 500,
        headers: baseHeaders,
      });
    }
  };
}

export const GET = privateHandler(async (req, route) => {
  await requireCatalogStaffSession(req);
  const { id: productId } = await route.params;
  const gallery = await getGalleryByProductId(db, productId);

  return NextResponse.json({ success: true, gallery }, { status: 200 });
});

export const POST = privateHandler(async (req, route) => {
  const { context } = await requireCatalogStaffSession(req, true);
  const { id: productId } = await route.params;

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey || idempotencyKey.length < 1 || Buffer.byteLength(idempotencyKey, "utf8") > 128) {
    throw ApiError.badRequest("Idempotency-Key header is required (1-128 bytes)");
  }

  const requestId = req.headers.get("x-correlation-id") || randomUUID();
  const file = await readMediaFile(req);
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const result = await uploadGalleryImage(db, {
    productId,
    staffUserId: context.userId,
    requestId,
    idempotencyKey,
    file: {
      name: file.name,
      type: file.type,
      buffer,
    },
    signal: req.signal,
  });

  return NextResponse.json(result, { status: 201 });
});
