import Link from 'next/link';
import { requireStaffPage } from '../../modules/identity/infrastructure/staff-server';
import { staffNavigation } from '../../modules/identity/application/staff-navigation';
export const dynamic = 'force-dynamic';
export default async function AdminPage() {
  const context = await requireStaffPage();
  return <main><h1>Administration</h1><p>Your staff password and MFA session is active.</p><nav aria-label="Administration">{staffNavigation(context.roles).map(item => <p key={item.href}><Link href={item.href}>{item.label}</Link></p>)}</nav></main>;
}
