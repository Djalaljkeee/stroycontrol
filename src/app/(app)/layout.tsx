import Link from 'next/link';
import { redirect } from 'next/navigation';
import { canView, currentUser } from '@/lib/auth';
import { SECTIONS } from '@/lib/access';
import { logout } from '@/actions/auth';

// Выгрузка — кнопка справа, а не пункт меню.
const NAV = SECTIONS.filter((s) => s.key !== 'export');

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const nav = NAV.filter((item) => canView(user, item.key));

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-5 py-2.5">
          <Link href={user.home} className="shrink-0" title="СтройКонтроль">
            <img src="/logo.svg" alt="СтройКонтроль" width={135} height={20} className="h-5 w-auto" />
          </Link>
          <nav className="flex flex-1 flex-wrap gap-1">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {canView(user, 'export') ? (
            <a
              href="/api/export"
              className="rounded border border-slate-300 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
            >
              Выгрузить в Excel
            </a>
          ) : null}
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <Link href="/account" className="hover:text-slate-900" title="Сменить пароль">
              {user.name} · {user.roleName}
            </Link>
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
