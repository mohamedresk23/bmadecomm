import { NextResponse } from "next/server";
import { db } from "../../../../../../db";
import { withErrorHandler } from "../../../../../../shared/api/error-handler";
import { requireOwnerSession } from "../../../../../../modules/content/settings/infrastructure/admin-auth";
import { staffConfig } from "../../../../../../modules/identity/infrastructure/staff-config";
import { sessionCsrf } from "../../../../../../modules/identity/infrastructure/staff-crypto";
import { listConfiguredMethods } from "../../../../../../modules/content/settings/application/payment-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGet(req: Request) {
  const { token } = await requireOwnerSession(req, false);
  const methods = await listConfiguredMethods(db);
  const config = staffConfig();
  const csrf = sessionCsrf(token, config.key);

  return NextResponse.json(
    {
      success: true,
      methods,
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

export const GET = withErrorHandler(handleGet);

