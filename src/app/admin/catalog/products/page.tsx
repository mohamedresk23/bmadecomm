import Link from "next/link";
import { requireStaffPage } from "../../../../modules/identity/infrastructure/staff-server";
import { ProductManager } from "./product-manager";
export const dynamic = "force-dynamic";
export default async function AdminProductsPage() {
  const context = await requireStaffPage();
  if (!context.roles.some(role => ["owner", "staff", "catalog_manager", "catalog"].includes(role))) {
    return <main dir="rtl" className="p-8"><h1>غير مصرح بالدخول</h1><Link href="/admin">العودة إلى الإدارة</Link></main>;
  }
  return <main dir="rtl" className="min-h-screen bg-slate-50 p-6 text-slate-900"><div className="mx-auto max-w-5xl space-y-6">
    <Link href="/admin">الإدارة</Link><h1 className="text-3xl font-bold">مسودات المنتجات</h1>
    <p>إنشاء وتعديل المنتجات والأسعار والمتغيرات.</p><ProductManager />
  </div></main>;
}
