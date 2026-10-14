import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "../../../../../../db";
import { boundedJson } from "../../../../../../shared/api/bounded-json";
import { withErrorHandler } from "../../../../../../shared/api/error-handler";
import { requireCatalogStaffSession } from "../../../../../../modules/content/settings/infrastructure/admin-auth";
import { createProduct, listProducts, getProductFormMetadata } from "../../../../../../modules/catalog/products/application/product-service";
import { createProductSchema } from "../../../../../../modules/catalog/products/contracts/product";
import { ApiError } from "../../../../../../shared/api/errors";
import { executeIdempotent, Json } from "../../../../../../shared/idempotency/execute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Pragma: "no-cache" };
function privateHandler(handler: (req: Request) => Promise<NextResponse>) {
  const wrapped = withErrorHandler(handler);
  return async (req: Request) => {
    const response = await wrapped(req);
    Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  };
}
export const GET = privateHandler(async req => {
  const { csrf } = await requireCatalogStaffSession(req, false);
  return NextResponse.json({ success: true, products: await listProducts(db), metadata: await getProductFormMetadata(db), csrf });
});
export const POST = privateHandler(async req => {
  const { context } = await requireCatalogStaffSession(req, true);
  const parsed = createProductSchema.safeParse(await boundedJson(req, 262144));
  if (!parsed.success) throw ApiError.unprocessableEntity("Validation failed", parsed.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })));
  const input = parsed.data;
  const revision = req.headers.get("X-Pricing-Revision");
  if (!revision) throw ApiError.conflict("Pricing revision required");
  const requestId = req.headers.get("x-correlation-id") || randomUUID();
  const key = req.headers.get("Idempotency-Key");
  const product = key ? await executeIdempotent(db, { actor: `staff:${context.userId}`, operation: "product.create", key, payload: { input, revision } as Json },
    async tx => await createProduct(tx, input, context.userId, requestId, revision) as unknown as Json)
    : await createProduct(db, input, context.userId, requestId, revision);
  return NextResponse.json({ success: true, product }, { status: 201 });
});
