import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "../../../../../../../db";
import { boundedJson } from "../../../../../../../shared/api/bounded-json";
import { ApiError } from "../../../../../../../shared/api/errors";
import { withErrorHandler } from "../../../../../../../shared/api/error-handler";
import { requireOwnerSession } from "../../../../../../../modules/content/settings/infrastructure/admin-auth";
import { paymentMethodConfigUpdateInputSchema } from "../../../../../../../modules/content/settings/contracts/payment-settings";
import { updatePaymentMethodConfig } from "../../../../../../../modules/content/settings/application/payment-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function handlePut(req: Request, contextParam: RouteContext) {
  const { id: methodId } = await contextParam.params;

  // Validate Owner session, Origin, and CSRF token
  const { context } = await requireOwnerSession(req, true);

  if (methodId !== "cod" && methodId !== "online_card") {
    throw ApiError.notFound("Payment method not found");
  }

  const body = await boundedJson(req);
  const parsed = paymentMethodConfigUpdateInputSchema.safeParse(body);
  if (!parsed.success) {
    throw ApiError.unprocessableEntity(
      "Validation failed",
      parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }))
    );
  }

  const requestId = req.headers.get("x-correlation-id") || randomUUID();
  const updated = await updatePaymentMethodConfig(
    db,
    context.userId,
    methodId,
    parsed.data,
    requestId
  );

  return NextResponse.json(
    {
      success: true,
      method: updated,
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

export const PUT = withErrorHandler((req: Request, ...args: unknown[]) =>
  handlePut(req, args[0] as RouteContext)
);

