import type { Verdict } from '@/domain';

const VERDICT_STYLE: Record<Verdict, { label: string; className: string }> = {
  ok: { label: 'в норме', className: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  warning: { label: 'тревога', className: 'bg-amber-50 text-amber-900 ring-amber-200' },
  over: { label: 'перерасход', className: 'bg-red-50 text-red-800 ring-red-200' },
  unknown: { label: 'нет данных', className: 'bg-slate-100 text-slate-500 ring-slate-200' },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const s = VERDICT_STYLE[verdict];
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs ring ${s.className}`}>
      {s.label}
    </span>
  );
}

/** База сравнения: проект точнее договора, договор точнее сметы. */
export function BasisBadge({
  source,
  revision,
  estimated,
}: {
  source: string | null | undefined;
  revision?: string | null;
  estimated?: boolean;
}) {
  if (!source) return <span className="text-slate-400">—</span>;
  const label =
    source === 'project' ? 'проект' : source === 'contract' ? 'договор' : 'смета';
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs ring ${
        estimated
          ? 'bg-slate-100 text-slate-600 ring-slate-200'
          : 'bg-sky-50 text-sky-800 ring-sky-200'
      }`}
      title={
        estimated
          ? 'Рабочая документация на этот конструктив ещё не выпущена — база оценочная'
          : 'База взята из ведомостей рабочей документации'
      }
    >
      {label}
      {revision ? ` · ${revision}` : ''}
    </span>
  );
}

export function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'over';
}) {
  const tones = {
    neutral: 'text-slate-900',
    ok: 'text-emerald-700',
    warn: 'text-amber-700',
    over: 'text-red-700',
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}
