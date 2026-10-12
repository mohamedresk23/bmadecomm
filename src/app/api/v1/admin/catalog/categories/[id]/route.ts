import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "../../../../../../../db";
import { boundedJson } from "../../../../../../../shared/api/bounded-json";
import { ApiError } from "../../../../../../../shared/api/errors";
import { withErrorHandler } from "../../../../../../../shared/api/error-handler";
import { requireCatalogStaffSession } from "../../../../../../../modules/content/settings/infrastructure/admin-auth";
import { updateCategorySchema } from "../../../../../../../modules/catalog/categories/contracts/category";
import {
  getCategoryById,
  updateCategory,
  deleteCategory,
} from "../../../../../../../modules/catalog/categories/application/category-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function handleGet(req: Request, contextParam: RouteContext) {
  await requireCatalogStaffSession(req, false);
  const { id } = await contextParam.params;

  const category = await getCategoryById(db, id);

  return NextResponse.json(
    {
      success: true,
      category,
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

async function handlePut(req: Request, contextParam: RouteContext) {
  const { context } = await requireCatalogStaffSession(req, true);
  const { id } = await contextParam.params;

  const body = await boundedJson(req);
  const parsed = updateCategorySchema.safeParse(body);
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
  const category = await updateCategory(
    db,
    id,
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
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
      },
    }
  );
}

async function handleDelete(req: Request, contextParam: RouteContext) {
  const { context } = await requireCatalogStaffSession(req, true);
  const { id } = await contextParam.params;

  const requestId = req.headers.get("x-correlation-id") || randomUUID();
  await deleteCategory(db, id, context.userId, requestId);

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

export const GET = withErrorHandler((req: Request, ...args: unknown[]) =>
  handleGet(req, args[0] as RouteContext)
);

export const PUT = withErrorHandler((req: Request, ...args: unknown[]) =>
  handlePut(req, args[0] as RouteContext)
);

export const DELETE = withErrorHandler((req: Request, ...args: unknown[]) =>
  handleDelete(req, args[0] as RouteContext)
);

