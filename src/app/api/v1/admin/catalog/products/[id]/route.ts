import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "../../../../../../../db";
import { boundedJson } from "../../../../../../../shared/api/bounded-json";
import { withErrorHandler } from "../../../../../../../shared/api/error-handler";
import { requireCatalogStaffSession } from "../../../../../../../modules/content/settings/infrastructure/admin-auth";
import { getProductById, updateProduct } from "../../../../../../../modules/catalog/products/application/product-service";
import { UpdateProductInput } from "../../../../../../../modules/catalog/products/contracts/product";
import { ApiError } from "../../../../../../../shared/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function privateHandler(handler: (req: Request, context: Context) => Promise<NextResponse>) {
  const wrapped = withErrorHandler((req, ...args) => handler(req, args[0] as Context));
  return async (req: Request, ...args: unknown[]) => {
    const response = await wrapped(req, ...args);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Pragma", "no-cache");
    return response;
  };
}
export const GET = privateHandler(async (req, route) => {
  const { csrf } = await requireCatalogStaffSession(req, false);
  const { id } = await route.params;
  return NextResponse.json({ success: true, product: await getProductById(db, id), csrf });
});
export const PUT = privateHandler(async (req, route) => {
  const { context } = await requireCatalogStaffSession(req, true);
  const { id } = await route.params;
  const input = await boundedJson(req, 262144) as UpdateProductInput;
  const revision = req.headers.get("X-Pricing-Revision");
  if (!revision) throw ApiError.conflict("Pricing revision required");
  const product = await updateProduct(db, id, input, context.userId, req.headers.get("x-correlation-id") || randomUUID(), revision);
  return NextResponse.json({ success: true, product });
});
