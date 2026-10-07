import Link from 'next/link';
import { requireStaffPage } from '../../../modules/identity/infrastructure/staff-server';
import { StaffAccessForm } from '../staff-access-form';

export const dynamic = 'force-dynamic';

export default async function StaffSecurity() {
  await requireStaffPage();
  return (
    <main className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8 text-slate-900" dir="rtl">
      <div className="max-w-md mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">Your staff security</h1>
            <p className="text-xs text-slate-600 mt-0.5">إدارة جلسات الدخول والمصادقة وكلمة المرور</p>
          </div>
          <Link
            href="/admin"
            className="text-xs font-semibold text-slate-800 hover:text-blue-700 bg-white hover:bg-slate-100 px-3.5 py-2 rounded-lg border border-slate-300 transition-colors focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            Administration
          </Link>
        </div>
        <StaffAccessForm initialMode="security" />
      </div>
    </main>
  );
}
