import { NextResponse } from "next/server";
import { publishMedia } from "../../../../lib/media/upload";
import { requireOwnerSession } from "../../../../modules/content/settings/infrastructure/admin-auth";
import { readPublishId } from "../../../../lib/media/request";
import { ApiError } from "../../../../shared/api/errors";
import { mediaHandler } from "../../../../lib/media/http";

async function publishHandler(request: Request) {
  const { config } = await requireOwnerSession(request, true);
  if (request.headers.get("origin") !== config.origin) throw ApiError.forbidden("Invalid request origin");
  const result = await publishMedia(await readPublishId(request));
  return NextResponse.json(result);
}

const handler = mediaHandler(publishHandler);
export async function POST(request: Request) {
  const response = await handler(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
