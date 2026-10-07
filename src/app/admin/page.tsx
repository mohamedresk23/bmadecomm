import Link from "next/link";
import { requireStaffPage } from "../../modules/identity/infrastructure/staff-server";
import { staffNavigation } from "../../modules/identity/application/staff-navigation";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const context = await requireStaffPage();
  const navItems = staffNavigation(context.roles);

  return (
    <main className="min-h-screen bg-slate-50 py-6 sm:py-8 px-3 sm:px-6 lg:px-8 text-slate-900" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Header Card */}
        <header className="bg-white rounded-2xl border border-slate-300 p-6 sm:p-8 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-blue-700 text-white font-extrabold flex items-center justify-center text-xs tracking-wider shadow-sm" aria-hidden="true">
                BM
              </span>
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Administration</h1>
              <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-300 font-mono">
                <bdi dir="ltr">v0.1</bdi>
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-600">
              Your staff password and MFA session is active.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-300 px-3 py-1 rounded-full font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-600" aria-hidden="true"></span>
              <span>جلسة مصادقة نشطة</span>
            </span>
          </div>
        </header>

        {/* Navigation Cards */}
        <section className="bg-white rounded-2xl border border-slate-300 p-6 sm:p-8 shadow-xs space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">الوظائف والخدمات الإدارية المتاحة</h2>
            <p className="text-xs text-slate-600 mt-0.5">اختر القسم الذي ترغب في إدارته وفق صلاحيات حسابك الحالي</p>
          </div>

          <nav aria-label="Administration" className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group p-4 rounded-xl border border-slate-300 hover:border-blue-700 bg-slate-50 hover:bg-blue-50/50 transition-all flex items-center justify-between shadow-2xs focus-visible:ring-2 focus-visible:ring-blue-700"
              >
                <div>
                  <span className="font-bold text-sm text-slate-900 group-hover:text-blue-700 transition-colors block">
                    {item.label}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    <bdi dir="ltr">{item.href}</bdi>
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
    </main>
  );
}
