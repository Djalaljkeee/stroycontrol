import { Fragment } from 'react';
import { buildReport } from '@/lib/report';
import { buildRebarOrder, type RebarOrder } from '@/lib/rebar-order';
import { num, percent, signed } from '@/lib/format';
import { BasisBadge, Card } from '@/components/ui';
import Link from 'next/link';
import { canView, requirePage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Конструктивы — СтройКонтроль' };

export default async function StructuresPage() {
  const user = await requirePage('structures');
  const report = await buildReport();
  const rebarOrder = buildRebarOrder(report);
  const objectOrder = report.structures.find((s) => s.parentId == null);
  const summary = objectOrder ? rebarOrder.get(objectOrder.id) : undefined;

  const amount = (v: number, unit: string) => (Math.abs(v) <= 0.005 ? '—' : `${num(v)} ${unit}`);
  // Строки диаметров под общей позицией арматуры конструктива.
  const skuRows = (sid: number, depth: number, order: RebarOrder) => (
    <>
      {order.skus.map((l) => (
        <tr key={`sku-${sid}-${l.material.id}`} className="text-xs text-slate-500">
          <td style={{ paddingLeft: `${1.6 + depth * 1.1}rem` }} />
          <td className="text-left">⌀{l.material.rebarDiameter} {l.material.rebarClass}</td>
          <td>по КЖ</td>
          <td>{num(l.project)} т</td>
          <td />
          <td colSpan={2}>{num(l.delivered)}</td>
          <td>{amount(l.toDeliver, 'т')}</td>
        </tr>
      ))}
      {order.unsplit > 0.005 ? (
        <tr key={`sku-${sid}-unsplit`} className="text-xs text-slate-500">
          <td style={{ paddingLeft: `${1.6 + depth * 1.1}rem` }} />
          <td className="text-left">без разбивки — КЖ не выпущен</td>
          <td colSpan={5} />
          <td>{amount(order.unsplit, 'т')}</td>
        </tr>
      ) : null}
    </>
  );

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

      {summary && summary.skus.length > 0 ? (
        <Card
          title="Арматура под заказ — по сортаменту"
          hint="Проект — по ведомостям расхода стали КЖ с коэффициентом расхода. Привезено — ТТН этого диаметра; тоннаж, закрытый по КС-6а без диаметров, разложен пропорционально остаткам."
        >
          <table className="grid-table text-sm">
            <thead>
              <tr>
                <th>Диаметр</th>
                <th>Проект, т</th>
                <th>Привезено, т</th>
                <th>Довезти, т</th>
              </tr>
            </thead>
            <tbody>
              {summary.skus.map((l) => (
                <tr key={l.material.id}>
                  <td className="text-left">
                    ⌀{l.material.rebarDiameter} {l.material.rebarClass}
                  </td>
                  <td>{num(l.project)}</td>
                  <td>{num(l.delivered)}</td>
                  <td className="font-medium">{amount(l.toDeliver, 'т')}</td>
                </tr>
              ))}
              {summary.unsplit > 0.005 ? (
                <tr>
                  <td className="text-left text-slate-500">Без разбивки — конструктивы без КЖ</td>
                  <td colSpan={2} />
                  <td className="font-medium">{amount(summary.unsplit, 'т')}</td>
                </tr>
              ) : null}
              <tr className="bg-slate-50 font-medium">
                <td className="text-left">Итого</td>
                <td>{num(summary.skus.reduce((a, l) => a + l.project, 0))}</td>
                <td>{num(summary.skus.reduce((a, l) => a + l.delivered, 0))}</td>
                <td>{amount(summary.total, 'т')}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      ) : null}

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
                <th title="Проект минус привезённое под конструктив: разнесённые ТТН, а где приход шёл на этаж целиком — списанное по КС-6а">Довезти</th>
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
                      // Проект — уже закупочный объём (с коэффициентом расхода). Привезённое под
                      // конструктив — разнесённые ТТН, а на этажах, где приход шёл на этаж целиком
                      // (КЖ0, 1-й), — списанное по КС-6а: приход туда на конструктив не разнесён.
                      const covered = Math.max(c.balance.incoming, c.balance.consumed);
                      // Класс, который ДС заменил другим, заказывать не нужно.
                      const order = c.material.isAggregate ? rebarOrder.get(s.id) : undefined;
                      // У арматуры итог — сумма по диаметрам: так строка сходится с разбивкой под ней.
                      const toDeliver = order
                        ? order.total
                        : c.basePurchase != null && !c.superseded
                          ? c.basePurchase - covered
                          : null;
                      return (
                        <Fragment key={`c-${s.id}-${c.material.id}`}>
                          <tr className={c.superseded ? 'text-slate-400' : undefined}>
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
                          {order ? skuRows(s.id, s.depth, order) : null}
                        </Fragment>
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
