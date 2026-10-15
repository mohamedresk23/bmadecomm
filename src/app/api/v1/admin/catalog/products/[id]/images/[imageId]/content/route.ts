import { NextResponse } from "next/server";
import { db } from "../../../../../../../../../../db";
import { requireCatalogStaffSession } from "../../../../../../../../../../modules/content/settings/infrastructure/admin-auth";
import { getGalleryImageContent } from "../../../../../../../../../../modules/catalog/products/application/gallery-service";
import { withErrorHandler } from "../../../../../../../../../../shared/api/error-handler";

type Context = { params: Promise<{ id: string; imageId: string }> };
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
  const { id: productId, imageId } = await route.params;

  const { buffer, mimeType } = await getGalleryImageContent(db, productId, imageId);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
