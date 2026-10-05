import { NextResponse } from "next/server";
import { processAndSaveMedia } from "../../../../lib/media/upload";
import { requirePermission, PolicyContext } from "../../../../shared/authz";
import { ApiError } from "../../../../shared/api/errors";
import { withErrorHandler } from "../../../../shared/api/error-handler";

function getContext(request: Request): PolicyContext {
  const userHeader = request.headers.get("x-mock-user");
  if (userHeader) {
    try {
      return { user: JSON.parse(userHeader) };
    } catch {
      return {};
    }
  }
  return {};
}

async function uploadHandler(request: Request) {
  const ctx = getContext(request);
  requirePermission(ctx, "media:upload");

  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    throw ApiError.badRequest("Missing file in form data");
  }

  const result = await processAndSaveMedia(file);
  return NextResponse.json(result);
}

export const POST = withErrorHandler(uploadHandler);

