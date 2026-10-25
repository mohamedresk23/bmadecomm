import Link from "next/link";
import { requireStaffPage } from "../../../../../modules/identity/infrastructure/staff-server";
import { AdminPageHeader } from "../../admin-page-header";
import { HomepageEditor } from "./homepage-editor";

export const dynamic = "force-dynamic";

export default async function AdminHomepageContentPage() {
  const context = await requireStaffPage();
  if (!context.roles.some((role) => ["owner", "marketing"].includes(role))) {
    return (
      <section className="p-8" dir="rtl">
        <h1 className="text-xl font-bold">غير مصرح بالدخول</h1>
        <p className="mt-2 text-slate-600">ليس لديك الصلاحية لإدارة محتوى الصفحة الرئيسية.</p>
        <Link href="/admin" className="mt-4 inline-block text-blue-700 hover:underline">
          العودة إلى الإدارة
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6" dir="rtl">
      <AdminPageHeader
        title="محتوى الصفحة الرئيسية"
        section="إدارة المحتوى"
        description="تخصيص وترتيب أقسام الصفحة الرئيسية، وحفظ المسودة قبل نشرها للمتسوقين."
      />
      <HomepageEditor />
    </section>
  );
}

