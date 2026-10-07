/** E02-01 exposes only implemented own-account pages; business grants arrive in E02-02. */
export function staffNavigation(roles: readonly string[]) {
  if (!roles.length) return [];
  return [{ href: '/admin', label: 'Administration' }, { href: '/admin/security', label: 'Your security' }];
}
