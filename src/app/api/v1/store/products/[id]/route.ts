import { NextResponse } from "next/server";
import { db } from "../../../../../../db";
import { withErrorHandler } from "../../../../../../shared/api/error-handler";
import { getProductById } from "../../../../../../modules/catalog/products/application/product-service";
export const dynamic = "force-dynamic";
export const GET = withErrorHandler(async (_req, ...args) => {
  const { id } = await (args[0] as { params: Promise<{ id: string }> }).params;
  return NextResponse.json({ success: true, product: await getProductById(db, id, true) }, { headers: { "Cache-Control": "no-store" } });
});
