import { AdminPageHeader } from '../admin-page-header';
import Link from "next/link";
import { requireStaffPage } from "../../../../modules/identity/infrastructure/staff-server";
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
      <section className="bg-slate-50 p-6 sm:p-12 flex items-center justify-center" dir="rtl">
        <div className="bg-white rounded-2xl border border-rose-200 p-6 sm:p-8 max-w-lg w-full shadow-sm text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center mx-auto text-xl font-bold border border-rose-200" aria-hidden="true">
            ⚠️
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">غير مصرح بالدخول</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            عذرًا، إعدادات المتجر التشغيلية والمالية متاحة حصريًا لحساب مالك المتجر (<bdi dir="ltr" className="font-mono font-semibold">Store Owner</bdi>).
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
    <section className="space-y-6" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">
        
        <AdminPageHeader title="إعدادات المتجر التشغيلية" description={currentTab === "shipping" ? "إدارة مناطق التغطية وتكاليف وطرق التوصيل" : "إدارة الهوية التجارية، قنوات التواصل، المنطقة الزمنية والعملة الأساسية"} />

        {/* Settings Navigation Tabs */}
        <div className="border-b border-slate-300">
          <nav className="-mb-px flex space-x-reverse space-x-2 sm:space-x-6 overflow-x-auto pb-1" aria-label="أقسام الإعدادات">
            {tabs.map((tab) =>
              tab.enabled ? (
                <Link
                  key={tab.id}
                  href={tab.href!}
                  className={`py-3 px-3 sm:px-4 inline-flex items-center gap-2 border-b-2 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-blue-700 ${
                    tab.active
                      ? "border-blue-700 text-blue-700 font-bold"
                      : "border-transparent text-slate-700 hover:text-slate-900 hover:border-slate-300 font-semibold"
                  }`}
                  aria-current={tab.active ? "page" : undefined}
                >
                  {tab.label}
                </Link>
              ) : (
                <span
                  key={tab.id}
                  className="py-3 px-3 inline-flex items-center gap-1.5 border-b-2 border-transparent text-sm text-slate-500 cursor-not-allowed opacity-70 whitespace-nowrap"
                  aria-disabled="true"
                >
                  {tab.label}
                  {tab.badge && (
                    <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-medium">
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
    </section>
  );
}
