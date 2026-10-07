/** E02-01 exposes only implemented own-account pages; business grants arrive in E02-02. */
export function staffNavigation(roles: readonly string[]) {
  if (!roles.length) return [];
  const items = [
    { href: '/admin', label: 'Administration' },
    { href: '/admin/security', label: 'Your security' },
  ];
  if (roles.includes('owner')) {
    items.push({ href: '/admin/settings', label: 'Store settings' });
  }
  return items;
}
