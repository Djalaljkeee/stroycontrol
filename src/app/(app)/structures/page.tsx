import { Fragment } from 'react';
import { buildReport } from '@/lib/report';
import { num, percent, signed } from '@/lib/format';
import { BasisBadge, Card } from '@/components/ui';
import Link from 'next/link';
import { canView, requirePage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Конструктивы — СтройКонтроль' };

export default async function StructuresPage() {
  const user = await requirePage('structures');
  const report = await buildReport();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Конструктивы</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          Объём по конструктивам для заявки на приход: сколько нужно по проекту, сколько уже пришло
          и сколько довезти. Проект берётся из самого точного источника — рабочей документации, затем
          действующего ДС, затем сметы; где КЖ ещё не выпущен, источник помечен серым — объём
          оценочный.
          {canView(user, 'revisions') ? (
            <>
              {' '}
              <Link href="/revisions" className="text-sky-700 underline">
                Редакции ДС и выпусков КЖ →
              </Link>
            </>
          ) : null}
        </p>
      </div>

      <Card title="Дерево конструктивов">
        <div className="overflow-x-auto">
          <table className="grid-table text-sm">
            <thead>
              <tr>
                <th>Конструктив</th>
                <th>Материал</th>
                <th>База</th>
                <th>Проект</th>
                <th>Смета</th>
                <th>Приход</th>
                <th>Списано</th>
                <th>Довезти</th>
              </tr>
            </thead>
            <tbody>
              {report.structures.map((s) => {
                const r = report.byStructure.get(s.id)!;
                const rows = r.cells.filter(
                  (c) => c.material.kind === 'concrete' || c.material.isAggregate,
                );
                return (
                  <Fragment key={s.id}>
                    <tr className="bg-slate-50">
                      <td
                        colSpan={8}
                        style={{ paddingLeft: `${0.6 + s.depth * 1.1}rem` }}
                        className="font-medium text-slate-800"
                      >
                        {s.code} — {s.name}
                        {s.level ? (
                          <span className="ml-2 text-xs text-slate-500">отм. {s.level}</span>
                        ) : null}
                        {r.concreteProgress != null ? (
                          <span className="ml-3 text-xs font-normal text-slate-500">
                            выполнено {percent(r.concreteProgress)} —{' '}
                            {num(r.concreteDesignCompleted)} из {num(r.concreteDesignTotal)} м³
                          </span>
                        ) : null}
                      </td>
                    </tr>
                    {rows.map((c) => {
                      // Проект — уже закупочный объём (с коэффициентом расхода): сравнивается с приходом напрямую.
                      const toDeliver = c.basePurchase != null ? c.basePurchase - c.balance.incoming : null;
                      return (
                        <tr key={`c-${s.id}-${c.material.id}`} className={c.superseded ? 'text-slate-400' : undefined}>
                          <td style={{ paddingLeft: `${1.6 + s.depth * 1.1}rem` }} />
                          <td className="text-left">{c.material.name}</td>
                          <td>
                            <BasisBadge
                              source={c.base?.source}
                              revision={c.base?.revision}
                              estimated={c.base?.isEstimated}
                            />
                          </td>
                          <td>
                            {num(c.basePurchase)} {c.material.unit}
                          </td>
                          <td>{num(c.estimatePurchase)}</td>
                          <td>{num(c.balance.incoming)}</td>
                          <td>{num(c.balance.consumed)}</td>
                          <td
                            className={toDeliver != null && toDeliver < -0.005 ? 'text-red-700' : 'font-medium'}
                            title={toDeliver != null && toDeliver < -0.005 ? 'Привезено больше проекта' : undefined}
                          >
                            {toDeliver == null || Math.abs(toDeliver) <= 0.005
                              ? '—'
                              : toDeliver > 0
                                ? `${num(toDeliver)} ${c.material.unit}`
                                : `перевезено ${signed(-toDeliver)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
