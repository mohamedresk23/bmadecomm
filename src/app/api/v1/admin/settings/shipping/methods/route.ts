import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "../../../../../../../db";
import { boundedJson } from "../../../../../../../shared/api/bounded-json";
import { ApiError } from "../../../../../../../shared/api/errors";
import { withErrorHandler } from "../../../../../../../shared/api/error-handler";
import { requireOwnerSession } from "../../../../../../../modules/content/settings/infrastructure/admin-auth";
import { createShippingMethodSchema } from "../../../../../../../modules/content/settings/contracts/shipping";
import { createShippingMethod } from "../../../../../../../modules/content/settings/application/shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePost(req: Request) {
  const { context } = await requireOwnerSession(req, true);
  const body = await boundedJson(req);

  const parsed = createShippingMethodSchema.safeParse(body);
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
  const method = await createShippingMethod(
    db,
    parsed.data,
    context.userId,
    requestId
  );

  return NextResponse.json(
    {
      success: true,
      method,
    },
    {
      status: 201,
      headers: {
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
      },
    }
  );
}

export const POST = withErrorHandler(handlePost);

