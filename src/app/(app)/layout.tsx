import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, ROLE_LABELS } from '@/lib/auth';
import { logout } from '@/actions/auth';

const NAV = [
  { href: '/dashboard', label: 'Дашборд' },
  { href: '/balance', label: 'Остатки' },
  { href: '/structures', label: 'Конструктивы' },
  { href: '/pours', label: 'Заливки' },
  { href: '/deliveries', label: 'Приходы' },
  { href: '/issues', label: 'Списания' },
  { href: '/revisions', label: 'Редакции' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-5 py-2.5">
          <Link href="/dashboard" className="text-sm font-semibold text-slate-900">
            СтройКонтроль
          </Link>
          <nav className="flex flex-1 flex-wrap gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <a
            href="/api/export"
            className="rounded border border-slate-300 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
          >
            Выгрузить в Excel
          </a>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>
              {user.name} · {ROLE_LABELS[user.role]}
            </span>
            <form action={logout}>
              <button type="submit" className="text-slate-500 underline hover:text-slate-900">
                Выйти
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] p-5">{children}</main>
    </div>
  );
}
