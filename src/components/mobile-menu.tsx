'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

// Меню шапки на телефоне: пункты не помещаются в строку, поэтому прячутся под
// кнопку. Закрывается само при переходе — шапка между страницами не перерисовывается.
export function MobileMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
        className="flex h-9 w-9 items-center justify-center rounded text-slate-700 hover:bg-slate-100"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          {open ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 5.5h14M3 10h14M3 14.5h14" />}
        </svg>
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-full z-20 border-b border-slate-200 bg-white px-3 pb-3 shadow-md">
          {children}
        </div>
      ) : null}
    </div>
  );
}
