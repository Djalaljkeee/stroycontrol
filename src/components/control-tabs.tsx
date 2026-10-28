import Link from 'next/link';
import { canView, type SessionUser } from '@/lib/auth';

// «Контроль» в шапке — один пункт на две страницы: защита объёмов и прогноз.
const TABS = [
  { key: 'control', label: 'Выполнение и защита', href: '/control' },
  { key: 'dashboard', label: 'Прогноз', href: '/dashboard' },
] as const;

export function ControlTabs({ user, active }: { user: SessionUser; active: (typeof TABS)[number]['key'] }) {
  const tabs = TABS.filter((t) => canView(user, t.key));
  if (tabs.length < 2) return null;
  return (
    <nav className="mt-2 flex gap-1 border-b border-slate-200 text-sm">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={
            t.key === active
              ? '-mb-px border-b-2 border-slate-900 px-3 py-1.5 font-medium text-slate-900'
              : 'px-3 py-1.5 text-slate-500 hover:text-slate-900'
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
