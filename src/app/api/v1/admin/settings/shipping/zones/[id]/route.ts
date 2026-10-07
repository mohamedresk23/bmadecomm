import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "../../../../../../../../db";
import { boundedJson } from "../../../../../../../../shared/api/bounded-json";
import { ApiError } from "../../../../../../../../shared/api/errors";
import { withErrorHandler } from "../../../../../../../../shared/api/error-handler";
import { requireOwnerSession } from "../../../../../../../../modules/content/settings/infrastructure/admin-auth";
import { updateShippingZoneSchema } from "../../../../../../../../modules/content/settings/contracts/shipping";
import {
  updateShippingZone,
  deleteShippingZone,
} from "../../../../../../../../modules/content/settings/application/shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePut(
  req: Request,
  contextParam: { params: Promise<{ id: string }> }
) {
  const { id: zoneId } = await contextParam.params;
  const { context } = await requireOwnerSession(req, true);
  const body = await boundedJson(req);

  const parsed = updateShippingZoneSchema.safeParse(body);
  if (!parsed.success) {
    throw ApiError.unprocessableEntity(
      "Validation failed",
      parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }))
    );
  }

  const requestId = randomUUID();
  const zone = await updateShippingZone(
    db,
    zoneId,
    parsed.data,
    context.userId,
    requestId
  );

  return NextResponse.json(
    {
      success: true,
      zone,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
      },
    }
  );
}

async function handleDelete(
  req: Request,
  contextParam: { params: Promise<{ id: string }> }
) {
  const { id: zoneId } = await contextParam.params;
  const { context } = await requireOwnerSession(req, true);

  const requestId = randomUUID();
  await deleteShippingZone(db, zoneId, context.userId, requestId);

  return NextResponse.json(
    {
      success: true,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
      },
    }
  );
}

type RouteContext = { params: Promise<{ id: string }> };

export const PUT = withErrorHandler((req: Request, ...args: unknown[]) =>
  handlePut(req, args[0] as RouteContext)
);
export const DELETE = withErrorHandler((req: Request, ...args: unknown[]) =>
  handleDelete(req, args[0] as RouteContext)
);
