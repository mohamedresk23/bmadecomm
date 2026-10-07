import Link from "next/link";
import { requireStaffPage } from "../../../modules/identity/infrastructure/staff-server";
import { StoreProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const context = await requireStaffPage();

  if (!context.roles.includes("owner")) {
    return (
      <main className="p-8 max-w-4xl mx-auto" dir="rtl">
        <h1 className="text-2xl font-bold text-red-600 mb-4">غير مصرح بالدخول</h1>
        <p className="text-gray-700 mb-4">
          عذرًا، إعدادات المتجر التشغيلية متاحة حصريًا لحساب مالك المتجر (Store Owner).
        </p>
        <Link
          href="/admin"
          className="text-blue-600 hover:underline font-medium"
        >
          العودة إلى لوحة التحكم
        </Link>
      </main>
    );
  }

  const tabs = [
    { id: "profile", label: "هوية وملف المتجر", active: true },
    { id: "shipping", label: "مناطق وطرق الشحن", active: false, badge: "قريبًا" },
    { id: "payments", label: "طرق الدفع", active: false, badge: "قريبًا" },
    { id: "policies", label: "السياسات المالية والتشغيلية", active: false, badge: "قريبًا" },
  ];

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">إعدادات المتجر التشغيلية</h1>
            <p className="text-sm text-gray-500 mt-1">
              إدارة الهوية التجارية، قنوات التواصل، المنطقة الزمنية والعملة الأساسية
            </p>
          </div>
          <Link
            href="/admin"
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            ← العودة للوحة الإدارة
          </Link>
        </div>

        {/* Settings Navigation Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-reverse space-x-8" aria-label="أقسام الإعدادات">
            {tabs.map((tab) => (
              <span
                key={tab.id}
                className={`py-4 px-1 inline-flex items-center gap-2 border-b-2 font-medium text-sm ${
                  tab.active
                    ? "border-blue-500 text-blue-600 font-semibold"
                    : "border-transparent text-gray-400 cursor-not-allowed"
                }`}
                aria-current={tab.active ? "page" : undefined}
              >
                {tab.label}
                {tab.badge && (
                  <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-normal">
                    {tab.badge}
                  </span>
                )}
              </span>
            ))}
          </nav>
        </div>

        {/* Profile Form Card */}
        <StoreProfileForm />
      </div>
    </main>
  );
}

