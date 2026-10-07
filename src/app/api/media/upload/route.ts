import { NextResponse } from "next/server";
import { processAndSaveMedia } from "../../../../lib/media/upload";
import { requirePermission, PolicyContext } from "../../../../shared/authz";
import { ApiError } from "../../../../shared/api/errors";
import { withErrorHandler } from "../../../../shared/api/error-handler";

import { readStaffCookie } from "../../../../modules/identity/infrastructure/staff-cookies";
import { resolveStaffSession } from "../../../../modules/identity/infrastructure/staff-sessions";
import { STAFF_SESSION_POLICY } from "../../../../modules/identity/infrastructure/staff-config";
import { db } from "../../../../db";

async function getContext(request: Request): Promise<PolicyContext> {
  const userHeader = request.headers.get("x-mock-user");
  if (userHeader) {
    try {
      return { user: JSON.parse(userHeader) };
    } catch {
      return {};
    }
  }
  const token = readStaffCookie(request);
  if (token) {
    const session = await resolveStaffSession(db, token, STAFF_SESSION_POLICY);
    if (session && session.roles.includes("owner")) {
      return {
        user: {
          id: session.userId,
          roles: session.roles,
          permissions: ["media:upload"],
        },
      };
    }
  }
  return {};
}

async function uploadHandler(request: Request) {
  const ctx = await getContext(request);
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

