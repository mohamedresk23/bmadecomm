import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '../../../db';
import { STAFF_COOKIE_NAME } from './staff-cookies';
import { resolveStaffSession } from './staff-sessions';
import { STAFF_SESSION_POLICY } from './staff-config';
export async function requireStaffPage() {
  const cookie = (await cookies()).get(STAFF_COOKIE_NAME)?.value ?? null;
  const context = await resolveStaffSession(db, cookie, STAFF_SESSION_POLICY);
  if (!context) redirect('/admin/login');
  return context;
}
