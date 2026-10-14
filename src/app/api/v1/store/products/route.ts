import { NextResponse } from "next/server";
import { db } from "../../../../../db";
import { withErrorHandler } from "../../../../../shared/api/error-handler";
import { listProducts } from "../../../../../modules/catalog/products/application/product-service";
export const dynamic = "force-dynamic";
export const GET = withErrorHandler(async () => NextResponse.json({ success: true, products: await listProducts(db, true) }, { headers: { "Cache-Control": "no-store" } }));
