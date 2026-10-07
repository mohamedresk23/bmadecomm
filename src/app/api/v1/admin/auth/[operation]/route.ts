import { db } from '../../../../../../db';
import { createStaffHttp } from '../../../../../../modules/identity/infrastructure/staff-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, context: { params: Promise<{ operation: string }> }) {
  try { return await createStaffHttp(db)(request, (await context.params).operation); }
  catch { return Response.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Request could not be completed.' } }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } }); }
}
export const GET = handle;
export const POST = handle;
