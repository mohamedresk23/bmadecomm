import Link from "next/link";
import { requireStaffPage } from "../../../../../modules/identity/infrastructure/staff-server";
import { ProductManager } from "./product-manager";
import { AdminPageHeader } from '../../admin-page-header';
export const dynamic = "force-dynamic";
export default async function AdminProductsPage() {
  const context = await requireStaffPage();
  if (!context.roles.some(role => ["owner", "staff", "catalog_manager", "catalog"].includes(role))) {
    return <section className="p-8"><h1>غير مصرح بالدخول</h1><Link href="/admin">العودة إلى الإدارة</Link></section>;
  }
  return <section className="space-y-6">
    <AdminPageHeader title="مسودات المنتجات" section="الكتالوج" description="إنشاء وتعديل المنتجات والأسعار والمتغيرات." /><ProductManager />
  </section>;
}
