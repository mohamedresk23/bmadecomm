import Link from 'next/link';
export function AdminPageHeader({ title, description, section }: { title: string; description: string; section?: string }) {
  return <header className="admin-page-header">
    <nav aria-label="مسار التصفح"><ol className="flex flex-wrap items-center gap-2 text-sm text-slate-600"><li><Link className="hover:text-blue-700 underline" href="/admin">الإدارة</Link></li>{section && <li><span aria-hidden="true">/ </span>{section}</li>}<li><span aria-hidden="true">/ </span><span aria-current="page">{title}</span></li></ol></nav>
    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">{title}</h1><p className="text-sm text-slate-600">{description}</p>
  </header>;
}
