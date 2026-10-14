import { AdminPageHeader } from '../../admin-page-header';
import Link from "next/link";
import { requireStaffPage } from "../../../../../modules/identity/infrastructure/staff-server";
import { CategoryManager } from "./category-manager";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  const context = await requireStaffPage();

  const isAuthorized = context.roles.some((r) =>
    ["owner", "staff", "catalog_manager", "catalog"].includes(r)
  );

  if (!isAuthorized) {
    return (
      <section className="bg-slate-50 p-6 sm:p-12 flex items-center justify-center" dir="rtl">
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
      </section>
    );
  }

  return (
    <section className="space-y-6" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">
        <AdminPageHeader title="إدارة شجرة التصنيفات" section="الكتالوج" description="إنشاء وتنظيم التسلسل الهرمي للتصنيفات لتبويب المنتجات وبناء تصفح المتجر." />

        {/* Client Category Tree Manager */}
        <CategoryManager />
      </div>
    </section>
  );
}

