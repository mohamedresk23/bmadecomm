import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "../../../../../../db";
import { boundedJson } from "../../../../../../shared/api/bounded-json";
import { ApiError } from "../../../../../../shared/api/errors";
import { withErrorHandler } from "../../../../../../shared/api/error-handler";
import { requireCatalogStaffSession } from "../../../../../../modules/content/settings/infrastructure/admin-auth";
import {
  createCategorySchema,
  reorderCategoriesSchema,
} from "../../../../../../modules/catalog/categories/contracts/category";
import {
  getCategoryTree,
  createCategory,
  reorderCategories,
} from "../../../../../../modules/catalog/categories/application/category-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGet(req: Request) {
  const { csrf } = await requireCatalogStaffSession(req, false);
  const categories = await getCategoryTree(db);

  return NextResponse.json(
    {
      success: true,
      categories,
      csrf,
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

async function handlePost(req: Request) {
  const { context } = await requireCatalogStaffSession(req, true);
  const body = await boundedJson(req);

  const parsed = createCategorySchema.safeParse(body);
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
  const category = await createCategory(
    db,
    parsed.data,
    context.userId,
    requestId
  );

  return NextResponse.json(
    {
      success: true,
      category,
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

async function handlePatch(req: Request) {
  const { context } = await requireCatalogStaffSession(req, true);
  const body = await boundedJson(req);

  const parsed = reorderCategoriesSchema.safeParse(body);
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
  await reorderCategories(db, parsed.data.items, context.userId, requestId);

  return NextResponse.json(
    {
      success: true,
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

export const GET = withErrorHandler(handleGet);
export const POST = withErrorHandler(handlePost);
export const PATCH = withErrorHandler(handlePatch);

