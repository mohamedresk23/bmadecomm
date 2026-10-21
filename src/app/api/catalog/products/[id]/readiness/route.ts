import { NextResponse } from "next/server";
import { db } from "../../../../../../db";
import { withErrorHandler } from "../../../../../../shared/api/error-handler";
import { requireCatalogStaffSession } from "../../../../../../modules/content/settings/infrastructure/admin-auth";
import { getPublicationReadiness } from "../../../../../../modules/catalog/products/application/publication-readiness-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

const handler = withErrorHandler(async (req, ...args) => {
  await requireCatalogStaffSession(req, false);
  const { id } = await (args[0] as Context).params;
  return NextResponse.json(await getPublicationReadiness(db, id));
});

export async function GET(req: Request, context: Context) {
  const response = await handler(req, context);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Pragma", "no-cache");
  const correlationId = req.headers.get("x-correlation-id");
  if (correlationId) response.headers.set("x-correlation-id", correlationId);
  return response;
}
