import { requireStaffPage } from '../../../modules/identity/infrastructure/staff-server';
import { staffNavigation } from '../../../modules/identity/application/staff-navigation';
import { AdminShell } from './admin-shell';
import './admin.css';

export default async function AdminWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const context = await requireStaffPage();
  return <AdminShell items={staffNavigation(context.roles)}>{children}</AdminShell>;
}
