import Link from 'next/link';
import { requireStaffPage } from '../../../modules/identity/infrastructure/staff-server';
import { StaffAccessForm } from '../staff-access-form';
export const dynamic = 'force-dynamic';
export default async function StaffSecurity() {
  await requireStaffPage();
  return <main><h1>Your staff security</h1><Link href="/admin">Administration</Link><StaffAccessForm initialMode="security" /></main>;
}
