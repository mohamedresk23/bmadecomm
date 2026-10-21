import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "../../../../../../db";
import { resolvePublicProductBySlug } from "../../../../../../modules/catalog/products/application/public-product-service";
import { ApiError } from "../../../../../../shared/api/errors";
import { withErrorHandler } from "../../../../../../shared/api/error-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string }> };

const handler = withErrorHandler(async (_req, ...args) => {
  const { slug } = await (args[0] as Context).params;
  const result = await resolvePublicProductBySlug(db, slug);
  if (result.kind === "not-found") throw ApiError.notFound("Product not found");
  if (result.kind === "redirect") return new NextResponse(null, { status: 301, headers: { Location: result.location } });
  return NextResponse.json(result.product);
});

export async function GET(req: Request, context: Context) {
  const correlationId = req.headers.get("x-correlation-id") || randomUUID();
  const headers = new Headers(req.headers);
  headers.set("x-correlation-id", correlationId);
  const response = await handler(new Request(req, { headers }), context);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("x-correlation-id", correlationId);
  return response;
}
