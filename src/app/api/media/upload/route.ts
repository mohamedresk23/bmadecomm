import { NextResponse } from "next/server";
import { processAndSaveMedia } from "../../../../lib/media/upload";
import { ApiError } from "../../../../shared/api/errors";
import { mediaHandler } from "../../../../lib/media/http";
import { requireOwnerSession } from "../../../../modules/content/settings/infrastructure/admin-auth";
import { readMediaFile } from "../../../../lib/media/request";

async function uploadHandler(request: Request) {
  const { config } = await requireOwnerSession(request, true);
  if (request.headers.get("origin") !== config.origin) {
    throw ApiError.forbidden("Invalid request origin");
  }

  const file = await readMediaFile(request);
  return NextResponse.json(await processAndSaveMedia(file, request.signal));
}

const handledUpload = mediaHandler(uploadHandler);

export async function POST(request: Request) {
  const response = await handledUpload(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
