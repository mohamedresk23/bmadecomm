import { NextResponse } from "next/server";
import { db } from "../../../../../../db";
import { boundedJson } from "../../../../../../shared/api/bounded-json";
import { ApiError } from "../../../../../../shared/api/errors";
import { withErrorHandler } from "../../../../../../shared/api/error-handler";
import { checkShippingEligibilitySchema } from "../../../../../../modules/content/settings/contracts/shipping";
import { checkShippingEligibility } from "../../../../../../modules/content/settings/application/shipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePost(req: Request) {
  const body = await boundedJson(req);

  const parsed = checkShippingEligibilitySchema.safeParse(body);
  if (!parsed.success) {
    throw ApiError.unprocessableEntity(
      "Validation failed",
      parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }))
    );
  }

  const result = await checkShippingEligibility(
    db,
    parsed.data,
    parsed.data.method_id
  );

  return NextResponse.json(
    {
      success: true,
      ...result,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "private, no-cache",
      },
    }
  );
}

export const POST = withErrorHandler(handlePost);

