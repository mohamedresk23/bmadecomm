import { NextResponse } from "next/server";
import { db } from "../../../../../../../../db";
import { requireCatalogStaffSession } from "../../../../../../../../modules/content/settings/infrastructure/admin-auth";
import { getGalleryByProductId } from "../../../../../../../../modules/catalog/products/application/gallery-service";
import { withErrorHandler } from "../../../../../../../../shared/api/error-handler";

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
  await requireCatalogStaffSession(req);
  const { id: productId } = await route.params;
  const gallery = await getGalleryByProductId(db, productId);

  return NextResponse.json(
    { success: true, gallery },
    { status: 200 }
  );
});
