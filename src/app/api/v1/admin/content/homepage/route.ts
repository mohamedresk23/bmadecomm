import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "../../../../../../db";
import { boundedJson } from "../../../../../../shared/api/bounded-json";
import { withErrorHandler } from "../../../../../../shared/api/error-handler";
import { requireContentStaffSession } from "../../../../../../modules/content/settings/infrastructure/admin-auth";
import {
  getHomepageDraft,
  getLatestPublication,
  updateHomepageDraft,
} from "../../../../../../modules/content/homepage/application/homepage-draft-service";
import { validateUpdateHomepageDraft } from "../../../../../../modules/content/homepage/contracts/section-schema";
import { ApiError } from "../../../../../../shared/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Pragma: "no-cache" };

function privateHandler(handler: (req: Request) => Promise<NextResponse>) {
  const wrapped = withErrorHandler(handler);
  return async (req: Request) => {
    const response = await wrapped(req);
    Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  };
}

export const GET = privateHandler(async (req) => {
  const { csrf } = await requireContentStaffSession(req, false);
  const draft = await getHomepageDraft(db);
  const latestPublication = await getLatestPublication(db);

  return NextResponse.json({
    success: true,
    draft: {
      sections: draft.sections,
      revision: draft.revision,
      updatedAt: draft.updatedAt,
      updatedBy: draft.updatedBy,
    },
    latestPublication,
    csrf,
  });
});

export const PUT = privateHandler(async (req) => {
  const { context, csrf } = await requireContentStaffSession(req, true);

  const rawJson = await boundedJson(req, 262144);
  const validation = validateUpdateHomepageDraft(rawJson);
  if (!validation.success) {
    throw ApiError.unprocessableEntity("Validation failed", validation.issues);
  }

  const requestId = req.headers.get("x-correlation-id") || randomUUID();
  const updated = await updateHomepageDraft(
    db,
    validation.data,
    context.userId,
    requestId
  );

  return NextResponse.json({
    success: true,
    draft: {
      sections: updated.sections,
      revision: updated.revision,
      updatedAt: updated.updatedAt,
      updatedBy: updated.updatedBy,
    },
    csrf,
  });
});

