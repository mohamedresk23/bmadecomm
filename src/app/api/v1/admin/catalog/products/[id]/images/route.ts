import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "../../../../../../../../db";
import { requireCatalogStaffSession } from "../../../../../../../../modules/content/settings/infrastructure/admin-auth";
import {
  getGalleryByProductId,
  updateGallery,
  uploadGalleryImage,
} from "../../../../../../../../modules/catalog/products/application/gallery-service";
import { readMediaFile } from "../../../../../../../../lib/media/request";
import { ApiError } from "../../../../../../../../shared/api/errors";
import { boundedJson } from "../../../../../../../../shared/api/bounded-json";

import {
  MAX_PUT_BODY,
  MAX_REQUEST_BODY,
  updateGallerySchema,
} from "../../../../../../../../modules/catalog/products/contracts/gallery";


type Context = { params: Promise<{ id: string }> };

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

export const POST = privateHandler(async (req, route, requestId) => {
  const { context } = await requireCatalogStaffSession(req, true);
  const { id: productId } = await route.params;

  if (!productId.trim() || /[\x00-\x1f\x7f]/.test(productId)) throw ApiError.badRequest("Valid product id required");
  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKey.trim() || /[\x00-\x1f\x7f]/.test(idempotencyKey) || Buffer.byteLength(idempotencyKey, "utf8") > 128) {
    throw ApiError.badRequest("Idempotency-Key header is required (1-128 bytes)");
  }

  const file = await readMediaFile(req, { maxBytes: MAX_REQUEST_BODY, deadlineMs: 15_000 });
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

export const PUT = privateHandler(async (req, route, requestId) => {
  const { context } = await requireCatalogStaffSession(req, true);
  const { id: productId } = await route.params;

  if (!productId.trim() || /[\x00-\x1f\x7f]/.test(productId)) {
    throw ApiError.badRequest("Valid product id required");
  }

  const rawJson = await boundedJson(req, MAX_PUT_BODY);
  const parsed = updateGallerySchema.safeParse(rawJson);
  if (!parsed.success) {
    const rawImages = (rawJson as { images?: Array<{ id?: unknown }> })?.images;
    const details = parsed.error.issues.map((issue) => {
      let field = issue.path.join(".");
      const match = /^images\.(\d+)\.(.+)$/.exec(field);
      if (match) {
        const idx = Number(match[1]);
        const subField = match[2];
        const imgId = rawImages?.[idx]?.id;
        if (imgId && typeof imgId === "string") {
          field = `images.${imgId}.${subField}`;
        }
      }
      return { field, message: issue.message };
    });
    throw ApiError.unprocessableEntity("Validation failed", details);
  }

  const gallery = await updateGallery(db, {
    productId,
    staffUserId: context.userId,
    requestId,
    payload: parsed.data,
  });

  return NextResponse.json({ success: true, gallery }, { status: 200 });
});

