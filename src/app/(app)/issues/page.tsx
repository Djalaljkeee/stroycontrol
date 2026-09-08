import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { issues, materials, pours, structures } from '@/db/schema';
import { buildReport } from '@/lib/report';
import { date, n, num } from '@/lib/format';
import { canWrite, currentUser } from '@/lib/auth';
import { isImplausible } from '@/domain';
import { Card, Empty } from '@/components/ui';
import { IssueForm } from './form';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Списания арматуры — СтройКонтроль' };

const PAGE_SIZE = 60;

export default async function IssuesPage() {
  const user = await currentUser();
  const [report, materialRows, structureRows, pourRows, rows] = await Promise.all([
    buildReport(),
    db.select().from(materials).where(eq(materials.kind, 'rebar')).orderBy(materials.id),
    db.select().from(structures).orderBy(structures.sortOrder),
    db.select().from(pours).orderBy(desc(pours.pouredAt)),
    db.select().from(issues).orderBy(desc(issues.date), desc(issues.id)),
  ]);

  const materialById = new Map(materialRows.map((m) => [m.id, m]));
  const structureById = new Map(structureRows.map((s) => [s.id, s]));
  const pourById = new Map(pourRows.map((p) => [p.id, p]));
  const targets = structureRows.filter((s) => s.kind !== 'object' && s.kind !== 'section');

  // Удельное армирование по конструктивам — проверка правдоподобия списаний.
  const specific = report.structures
    .map((s) => {
      const r = report.byStructure.get(s.id)!;
      const rebar = r.cells.find((c) => c.material.kind === 'rebar' && c.material.isAggregate);
      return { structure: s, cell: rebar, report: r };
    })
    .filter((x) => x.cell?.specificKgPerM3 != null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Списания арматуры</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          Арматура лежит на складе, поэтому списывается отдельным документом — актом монтажа или
          исполнительной схемой. Бетон здесь не списывается: он уходит в дело сразу, привязкой ТТН
          к захватке.
        </p>
      </div>

      {canWrite(user, 'issues') ? (
        <Card title="Новое списание">
          <IssueForm
            materials={materialRows.filter((m) => !m.isAggregate || true)}
            structures={targets}
            pours={pourRows}
            structureNames={structureRows}
          />
        </Card>
      ) : null}

      <Card
        title="Удельное армирование"
        hint="Кг арматуры на м³ забетонированного объёма. Проверка не зависит от коэффициентов расхода и ловит списание не на тот конструктив: по КЖ1-01 колонны дают 347 кг/м³, стены — 96 кг/м³."
      >
        {specific.length === 0 ? (
          <Empty>Нет конструктивов с одновременно залитым бетоном и списанной арматурой.</Empty>
        ) : (
          <table className="grid-table text-sm">
            <thead>
              <tr>
                <th>Конструктив</th>
                <th>Забетонировано, м³</th>
                <th>Списано арматуры, т</th>
                <th>Факт, кг/м³</th>
                <th>По базе, кг/м³</th>
                <th>Отношение</th>
              </tr>
            </thead>
            <tbody>
              {specific.map(({ structure, cell, report: r }) => (
                <tr key={structure.id}>
                  <td style={{ paddingLeft: `${0.6 + structure.depth * 0.9}rem` }}>
                    {structure.name}
                  </td>
                  <td>{num(r.concreteDesignCompleted)}</td>
                  <td>{num(cell!.balance.consumed)}</td>
                  <td>{num(cell!.specificKgPerM3, 0)}</td>
                  <td>{num(cell!.designSpecificKgPerM3, 0)}</td>
                  <td
                    className={
                      isImplausible(cell!.specificRatio) ? 'font-medium text-red-700' : undefined
                    }
                  >
                    {cell!.specificRatio == null
                      ? '—'
                      : `${cell!.specificRatio.toLocaleString('ru-RU', {
                          maximumFractionDigits: 2,
                        })}×`}
                    {isImplausible(cell!.specificRatio) ? ' — проверьте ввод' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Реестр списаний">
        {rows.length === 0 ? (
          <Empty>Списаний пока нет.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid-table text-sm">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Материал</th>
                  <th>Количество</th>
                  <th>Конструктив</th>
                  <th>Захватка</th>
                  <th>Документ</th>
                  <th>Источник</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, PAGE_SIZE).map((i) => {
                  const material =
                    materialById.get(i.materialId) ??
                    report.materials.find((m) => m.id === i.materialId);
                  const pour = i.pourId != null ? pourById.get(i.pourId) : null;
                  return (
                    <tr key={i.id}>
                      <td>{date(i.date)}</td>
                      <td>{material?.name ?? '—'}</td>
                      <td>
                        {num(n(i.quantity))} {material?.unit ?? ''}
                      </td>
                      <td>{structureById.get(i.structureId)?.name ?? '—'}</td>
                      <td>{pour?.label ?? '—'}</td>
                      <td>{i.document ?? '—'}</td>
                      <td>{i.source === 'ks6a' ? 'импорт КС-6а' : 'ручной ввод'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > PAGE_SIZE ? (
              <p className="mt-2 text-xs text-slate-500">
                Показаны первые {PAGE_SIZE} из {rows.length} записей.
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
