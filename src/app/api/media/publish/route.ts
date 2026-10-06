import { NextResponse } from "next/server";
import { publishMedia } from "../../../../lib/media/upload";
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

async function publishHandler(request: Request) {
  const ctx = getContext(request);
  requirePermission(ctx, "media:upload");

  const body = await request.json();
  if (!body.id || typeof body.id !== "string") {
    throw ApiError.badRequest("Missing media id");
  }

  const result = await publishMedia(body.id);
  return NextResponse.json(result);
}

export const POST = withErrorHandler(publishHandler);
