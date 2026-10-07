import { db } from "../../../../db";
import { ApiError } from "../../../../shared/api/errors";
import { readStaffCookie } from "../../../identity/infrastructure/staff-cookies";
import { resolveStaffSession } from "../../../identity/infrastructure/staff-sessions";
import {
  staffConfig,
  STAFF_SESSION_POLICY,
} from "../../../identity/infrastructure/staff-config";
import {
  sessionCsrf,
  sameSecret,
} from "../../../identity/infrastructure/staff-crypto";

export async function requireOwnerSession(req: Request, validateCsrf = false) {
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

  const config = staffConfig();
  const csrf = sessionCsrf(token, config.key);

  if (validateCsrf) {
    const origin = req.headers.get("origin");
    if (origin && origin !== config.origin) {
      throw ApiError.forbidden("Invalid request origin");
    }

    const csrfHeader = req.headers.get("x-csrf-token");
    if (!csrfHeader || !sameSecret(csrfHeader, csrf)) {
      throw ApiError.forbidden("Invalid CSRF token");
    }
  }

  return { token, context, config, csrf };
}
