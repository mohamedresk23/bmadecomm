export type AdminNavItem = { href: string; label: string };
export const adminNavigationMetadata: Record<string, { label: string; description: string; group: string; icon: string }> = {
  '/admin': { label: 'لوحة الإدارة', description: 'الأقسام المتاحة ومعلومات حسابك.', group: 'الإدارة', icon: 'home' },
  '/admin/catalog/products': { label: 'المنتجات', description: 'مسودات المنتجات والأسعار والمتغيرات.', group: 'الكتالوج', icon: 'box' },
  '/admin/catalog/categories': { label: 'التصنيفات', description: 'تنظيم الفئات الرئيسية والفرعية.', group: 'الكتالوج', icon: 'tree' },
  '/admin/settings': { label: 'إعدادات المتجر', description: 'هوية المتجر والتواصل ومناطق الشحن.', group: 'المتجر والحساب', icon: 'settings' },
  '/admin/security': { label: 'أمان الحساب', description: 'كلمة المرور والمصادقة وجلسة الدخول.', group: 'المتجر والحساب', icon: 'shield' },
};
export function isAdminRouteActive(pathname: string, href: string) {
  return pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`));
}
