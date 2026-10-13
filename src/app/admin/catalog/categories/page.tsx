import Link from "next/link";
import { requireStaffPage } from "../../../../modules/identity/infrastructure/staff-server";
import { CategoryManager } from "./category-manager";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  const context = await requireStaffPage();

  const isAuthorized = context.roles.some((r) =>
    ["owner", "staff", "catalog_manager", "catalog"].includes(r)
  );

  if (!isAuthorized) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 sm:p-12 flex items-center justify-center" dir="rtl">
        <div className="bg-white rounded-2xl border border-rose-200 p-6 sm:p-8 max-w-lg w-full shadow-sm text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center mx-auto text-xl font-bold border border-rose-200" aria-hidden="true">
            ⚠️
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">غير مصرح بالدخول</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            عذرًا، إدارة شجرة تصنيفات المنتجات تتطلب حساب موظف أو مالك بصلاحيات إدارة الكتالوج.
          </p>
          <div className="pt-2">
            <Link
              href="/admin"
              className="inline-flex items-center justify-center px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-bold shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-700"
            >
              العودة إلى لوحة التحكم
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 py-6 sm:py-8 px-3 sm:px-6 lg:px-8 text-slate-900" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Navigation Breadcrumbs & Top Header */}
        <section className="space-y-3">
          <nav aria-label="مسار التصفح" className="flex items-center gap-2 text-xs text-slate-600">
            <Link href="/admin" className="hover:text-blue-700 hover:underline">
              الإدارة
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-slate-500 font-medium">الكتالوج</span>
            <span aria-hidden="true">/</span>
            <span className="text-blue-700 font-bold" aria-current="page">
              تصنيفات المنتجات
            </span>
          </nav>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                إدارة شجرة التصنيفات (Category Tree)
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 mt-1">
                إنشاء وتنظيم التسلسل الهرمي للتصنيفات لتبويب المنتجات وبناء تصفح المتجر بروابط دائمة ومستقرة.
              </p>
            </div>

            <Link
              href="/admin"
              className="self-start sm:self-auto text-xs font-semibold text-slate-800 hover:text-blue-700 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 rounded-lg border border-slate-300 transition-colors focus-visible:ring-2 focus-visible:ring-blue-700 whitespace-nowrap"
            >
              ← العودة للوحة الإدارة
            </Link>
          </div>
        </section>

        {/* Client Category Tree Manager */}
        <CategoryManager />
      </div>
    </main>
  );
}

