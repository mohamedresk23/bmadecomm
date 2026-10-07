import Link from "next/link";
import { requireStaffPage } from "../../../modules/identity/infrastructure/staff-server";
import { StoreProfileForm } from "./profile-form";
import { ShippingSettingsManager } from "./shipping-manager";

export const dynamic = "force-dynamic";

interface AdminSettingsPageProps {
  searchParams?: Promise<{ tab?: string }>;
}

export default async function AdminSettingsPage({
  searchParams,
}: AdminSettingsPageProps) {
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

  const resolvedParams = searchParams ? await searchParams : undefined;
  const currentTab = resolvedParams?.tab === "shipping" ? "shipping" : "profile";

  const tabs = [
    {
      id: "profile",
      label: "هوية وملف المتجر",
      href: "/admin/settings?tab=profile",
      active: currentTab === "profile",
      enabled: true,
    },
    {
      id: "shipping",
      label: "مناطق وطرق الشحن",
      href: "/admin/settings?tab=shipping",
      active: currentTab === "shipping",
      enabled: true,
    },
    {
      id: "payments",
      label: "طرق الدفع",
      active: false,
      enabled: false,
      badge: "قريبًا",
    },
    {
      id: "policies",
      label: "السياسات المالية والتشغيلية",
      active: false,
      enabled: false,
      badge: "قريبًا",
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">إعدادات المتجر التشغيلية</h1>
            <p className="text-sm text-gray-500 mt-1">
              {currentTab === "shipping"
                ? "إدارة مناطق التغطية الجغرافية في مصر وطرق وتكاليف الشحن والتوصيل"
                : "إدارة الهوية التجارية، قنوات التواصل، المنطقة الزمنية والعملة الأساسية"}
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
            {tabs.map((tab) =>
              tab.enabled ? (
                <Link
                  key={tab.id}
                  href={tab.href!}
                  className={`py-4 px-1 inline-flex items-center gap-2 border-b-2 font-medium text-sm transition-colors ${
                    tab.active
                      ? "border-blue-500 text-blue-600 font-semibold"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                  aria-current={tab.active ? "page" : undefined}
                >
                  {tab.label}
                </Link>
              ) : (
                <span
                  key={tab.id}
                  className="py-4 px-1 inline-flex items-center gap-2 border-b-2 border-transparent font-medium text-sm text-gray-400 cursor-not-allowed"
                >
                  {tab.label}
                  {tab.badge && (
                    <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-normal">
                      {tab.badge}
                    </span>
                  )}
                </span>
              )
            )}
          </nav>
        </div>

        {/* Tab Content */}
        {currentTab === "profile" && <StoreProfileForm />}
        {currentTab === "shipping" && <ShippingSettingsManager />}
      </div>
    </main>
  );
}
