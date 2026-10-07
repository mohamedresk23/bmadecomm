import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "../../../../../../db";
import { boundedJson } from "../../../../../../shared/api/bounded-json";
import { ApiError } from "../../../../../../shared/api/errors";
import { withErrorHandler } from "../../../../../../shared/api/error-handler";
import { readStaffCookie } from "../../../../../../modules/identity/infrastructure/staff-cookies";
import { resolveStaffSession } from "../../../../../../modules/identity/infrastructure/staff-sessions";
import {
  staffConfig,
  STAFF_SESSION_POLICY,
} from "../../../../../../modules/identity/infrastructure/staff-config";
import {
  sessionCsrf,
  sameSecret,
} from "../../../../../../modules/identity/infrastructure/staff-crypto";
import { storeProfileUpdateInputSchema } from "../../../../../../modules/content/settings/contracts/store-profile";
import {
  getStoreSettings,
  updateStoreSettings,
} from "../../../../../../modules/content/settings/application/store-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireOwnerContext(req: Request) {
  const token = readStaffCookie(req);
  if (!token) {
    throw ApiError.unauthorized("Authentication required");
  }

  const context = await resolveStaffSession(db, token, STAFF_SESSION_POLICY);
  if (!context) {
    throw ApiError.unauthorized("Authentication required");
  }

  if (!context.roles.includes("owner")) {
    throw ApiError.forbidden("Only store owners can access store operational settings");
  }

  return { token, context };
}

async function handleGet(req: Request) {
  const { token } = await requireOwnerContext(req);
  const settings = await getStoreSettings(db);
  const config = staffConfig();
  const csrf = sessionCsrf(token, config.key);

  return NextResponse.json(
    {
      ...settings,
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

async function handlePut(req: Request) {
  const { token, context } = await requireOwnerContext(req);
  const config = staffConfig();

  // Validate Origin if present
  const origin = req.headers.get("origin");
  if (origin && origin !== config.origin) {
    throw ApiError.forbidden("Invalid request origin");
  }

  // Validate CSRF token (from X-CSRF-Token header or payload)
  const csrfHeader = req.headers.get("x-csrf-token");
  const expectedCsrf = sessionCsrf(token, config.key);
  if (!csrfHeader || !sameSecret(csrfHeader, expectedCsrf)) {
    throw ApiError.forbidden("Invalid CSRF token");
  }

  const body = await boundedJson(req);
  const parsed = storeProfileUpdateInputSchema.safeParse(body);
  if (!parsed.success) {
    throw ApiError.unprocessableEntity(
      "Validation failed",
      parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }))
    );
  }

  const requestId = randomUUID();
  const updatedProfile = await updateStoreSettings(
    db,
    parsed.data,
    context.userId,
    requestId
  );

  return NextResponse.json(
    {
      success: true,
      profile: updatedProfile,
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
export const PUT = withErrorHandler(handlePut);

