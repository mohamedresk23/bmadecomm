import { AdminPageHeader } from '../admin-page-header';
import { requireStaffPage } from '../../../../modules/identity/infrastructure/staff-server';
import { StaffAccessForm } from '../../staff-access-form';

export const dynamic = 'force-dynamic';

export default async function StaffSecurity() {
  await requireStaffPage();
  return (
    <section className="space-y-6">
        <AdminPageHeader title="أمان الحساب" description="إدارة جلسات الدخول والمصادقة وكلمة المرور" />
      <div className="max-w-lg space-y-6">
        <StaffAccessForm initialMode="security" />
      </div>
    </section>
  );
}
