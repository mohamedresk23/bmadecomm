import { AdminPageHeader } from './admin-page-header';
import { adminNavigationMetadata } from './admin-navigation';
import Link from "next/link";
import { requireStaffPage } from "../../../modules/identity/infrastructure/staff-server";
import { staffNavigation } from "../../../modules/identity/application/staff-navigation";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const context = await requireStaffPage();
  const navItems = staffNavigation(context.roles);

  return (
    <section className="space-y-6" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-6">
        
        <AdminPageHeader title="لوحة الإدارة" description="اختر القسم الذي ترغب في إدارته وفق صلاحيات حسابك." />

        {/* Navigation Cards */}
        <section className="bg-white rounded-2xl border border-slate-300 p-6 sm:p-8 shadow-xs space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">الوظائف والخدمات الإدارية المتاحة</h2>
            <p className="text-xs text-slate-600 mt-0.5">اختر القسم الذي ترغب في إدارته وفق صلاحيات حسابك الحالي</p>
          </div>

          <nav aria-label="أقسام الإدارة" className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group p-4 rounded-xl border border-slate-300 hover:border-blue-700 bg-slate-50 hover:bg-blue-50/50 transition-all flex items-center justify-between shadow-2xs focus-visible:ring-2 focus-visible:ring-blue-700"
              >
                <div>
                  <span className="font-bold text-sm text-slate-900 group-hover:text-blue-700 transition-colors block">
                    {adminNavigationMetadata[item.href]?.label ?? item.label}
                  </span>
                  <span className="mt-1 block text-sm text-slate-600">
                    {adminNavigationMetadata[item.href]?.description}
                  </span>
                </div>
                <span className="text-slate-400 group-hover:text-blue-700 font-bold transition-transform group-hover:-translate-x-1" aria-hidden="true">
                  ←
                </span>
              </Link>
            ))}
          </nav>
        </section>

        {/* Security & Roles Summary (Using only real context data) */}
        <section className="bg-white rounded-2xl border border-slate-300 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-700">الأدوار الممنوحة للحساب:</span>
            {context.roles.map((role) => (
              <span key={role} className="bg-blue-50 text-blue-800 border border-blue-200 font-bold px-2.5 py-0.5 rounded-md font-mono">
                {role}
              </span>
            ))}
          </div>
          <div>
            <span>وقت انتهاء الجلسة: </span>
            <bdi dir="ltr" className="font-mono font-semibold text-slate-800">
              {new Date(context.expiresAt).toLocaleTimeString()}
            </bdi>
          </div>
        </section>

      </div>
    </section>
  );
}
