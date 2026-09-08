import { Fragment } from 'react';
import { buildReport } from '@/lib/report';
import { coeff, money, num, percent, signed } from '@/lib/format';
import { BasisBadge, Card, VerdictBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Конструктивы — СтройКонтроль' };

export default async function StructuresPage() {
  const report = await buildReport();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Конструктивы</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          База сравнения подбирается по принципу «самая точная из доступных»: рабочая документация,
          затем действующий ДС, затем смета. Где КЖ ещё не выпущен, база помечена серым — она
          оценочная.
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
                <th>Объём базы</th>
                <th>Смета</th>
                <th>Приход</th>
                <th>Списано</th>
                <th>Вып., %</th>
                <th>К&nbsp;факт</th>
                <th>Прогноз</th>
                <th>Перерасход</th>
                <th>В рублях</th>
                <th>Оценка</th>
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
                        colSpan={13}
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
                    {rows.map((c) => (
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
                        <td>{percent(c.forecast.progress)}</td>
                        <td>{coeff(c.forecast.kActual)}</td>
                        <td>{num(c.forecast.total)}</td>
                        <td>{signed(c.forecast.overrunVsEstimate)}</td>
                        <td>{money(c.forecast.overrunCost)}</td>
                        <td>
                          <VerdictBadge verdict={c.forecast.verdict} />
                        </td>
                      </tr>
                    ))}
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
