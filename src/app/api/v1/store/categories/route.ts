import { NextResponse } from "next/server";
import { db } from "../../../../../db";
import { withErrorHandler } from "../../../../../shared/api/error-handler";
import { getCategoryTree } from "../../../../../modules/catalog/categories/application/category-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGet() {
  const categories = await getCategoryTree(db, { onlyActive: true });

  return NextResponse.json(
    {
      success: true,
      categories,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    }
  );
}

export const GET = withErrorHandler(handleGet);
