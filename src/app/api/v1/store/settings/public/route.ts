import { NextResponse } from "next/server";
import { db } from "../../../../../../db";
import { withErrorHandler } from "../../../../../../shared/api/error-handler";
import { getPublicStoreSettings } from "../../../../../../modules/content/settings/application/store-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGet() {
  const publicSettings = await getPublicStoreSettings(db);

  return NextResponse.json(publicSettings, {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}

export const GET = withErrorHandler(handleGet);

