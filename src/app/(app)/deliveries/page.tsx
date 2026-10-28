import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { deliveries, issues, materials, pours, structures, tiers } from '@/db/schema';
import { buildReport } from '@/lib/report';
import { date, n, num } from '@/lib/format';
import { canWrite, requirePage } from '@/lib/auth';
import { loadTargetGroups } from '@/lib/targets';
import { isImplausible } from '@/domain';
import { Card, Empty } from '@/components/ui';
import { DeliveryForm } from './form';
import { AllocateForm } from './allocate';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Приход и списание — СтройКонтроль' };

const PAGE_SIZE = 60;

export default async function DeliveriesPage() {
  const user = await requirePage('deliveries');
  const [report, materialRows, pourRows, structureRows, tierRows, rows, issueRows, targetGroups] = await Promise.all([
    buildReport(),
    db.select().from(materials).orderBy(materials.id),
    db.select().from(pours).orderBy(desc(pours.pouredAt)),
    db.select().from(structures),
    db.select().from(tiers),
    db.select().from(deliveries).orderBy(desc(deliveries.date), desc(deliveries.id)),
    db.select().from(issues).orderBy(desc(issues.date), desc(issues.id)),
    loadTargetGroups({ includeTiers: true }),
  ]);

  const materialById = new Map(materialRows.map((m) => [m.id, m]));
  const structureById = new Map(structureRows.map((s) => [s.id, s]));
  const pourById = new Map(pourRows.map((p) => [p.id, p]));
  const tierById = new Map(tierRows.map((t) => [t.id, t]));

  const structureOf = (d: (typeof rows)[number]) =>
    d.structureId ?? (d.pourId != null ? pourById.get(d.pourId)?.structureId ?? null : null);
  const targetLabel = (d: (typeof rows)[number]) => {
    const sid = structureOf(d);
    const s = sid != null ? structureById.get(sid) : undefined;
    const t = d.tierId != null ? tierById.get(d.tierId) : undefined;
    if (s) {
      const pour = d.pourId != null ? pourById.get(d.pourId) : undefined;
      return `${pour ? `${pour.label} · ` : ''}${s.name}${t ? ` (${t.name})` : ''}`;
    }
    if (t) return `${t.name}, без разбивки`;
    // Старые записи до объединения со списанием: бетон без привязки, арматура на складе.
    return materialById.get(d.materialId)?.kind === 'concrete' ? '— не разнесён' : 'на склад';
  };

  // Без разнесения бетон висит неподтверждённым расходом — это первое, что нужно
  // разобрать. Арматура на складе — нормальное состояние, её здесь нет.
  const unallocated = rows.filter(
    (d) => structureOf(d) == null && d.tierId == null && materialById.get(d.materialId)?.kind === 'concrete',
  );
  const unallocatedTotal = unallocated.reduce((acc, d) => acc + n(d.quantity), 0);
  // Разнесённое только на ярус можно уточнить до конструктива. Кроме ярусов, где
  // расход ведётся по процентовке: там уточнение посчитало бы расход дважды.
  const refinable = rows.filter(
    (d) =>
      structureOf(d) == null &&
      d.tierId != null &&
      !tierById.get(d.tierId)?.consumptionFromClosings,
  );

  // Удельное армирование по конструктивам — проверка правдоподобия: ловит приход,
  // списанный не на тот конструктив.
  const specific = report.structures
    .map((s) => {
      const r = report.byStructure.get(s.id)!;
      const rebar = r.cells.find((c) => c.material.kind === 'rebar' && c.material.isAggregate);
      return { structure: s, cell: rebar, report: r };
    })
    .filter((x) => x.cell?.specificKgPerM3 != null);

  // Импорт заметок не пишет осей — там служебная пометка листа «приходы».
  const noteOf = (d: (typeof rows)[number]) => (d.source === 'prihody' ? null : d.note);

  // Приход арматуры вводится по диаметрам; агрегатная позиция служит только
  // для сравнения со сметой и в форме не предлагается.
  const selectableMaterials = materialRows.filter((m) => !m.isAggregate);
  const writable = canWrite(user, 'deliveries');
  const canAllocate = canWrite(user, 'allocate');

  const allocationTable = (list: typeof rows) => (
    <div className="overflow-x-auto">
      <table className="grid-table text-sm">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Материал</th>
            <th>Количество</th>
            <th>Сейчас</th>
            <th>Разнести</th>
          </tr>
        </thead>
        <tbody>
          {list.slice(0, PAGE_SIZE).map((d) => {
            const material = materialById.get(d.materialId);
            return (
              <tr key={d.id}>
                <td>{date(d.date)}</td>
                <td>{material?.name ?? '—'}</td>
                <td>
                  {num(n(d.quantity))} {material?.unit ?? ''}
                </td>
                <td>{targetLabel(d)}</td>
                <td>
                  {canAllocate ? (
                    <AllocateForm deliveryId={d.id} targets={targetGroups} />
                  ) : (
                    <span className="text-slate-400">нет прав</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {list.length > PAGE_SIZE ? (
        <p className="mt-2 text-xs text-slate-500">
          Показаны первые {PAGE_SIZE} из {list.length} записей.
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Приход и списание</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          Поставка вводится сразу на конструктив — так же, как в листе «приходы»: этаж и блок —
          колонны, стены, плиту, лестницы. Это и есть списание, отдельный акт не нужен. Оси и
          участок внутри конструктива пишутся в примечании.
        </p>
      </div>

      {writable ? (
        <Card title="Новый приход">
          <DeliveryForm materials={selectableMaterials} targets={targetGroups} />
        </Card>
      ) : null}

      {unallocated.length > 0 ? (
        <Card
          title={`Бетон без разнесения — ${num(unallocatedTotal)} м³`}
          hint="Пока поставка не разнесена ни на этаж, ни на конструктив, она числится неподтверждённым расходом."
        >
          {allocationTable(unallocated)}
        </Card>
      ) : null}

      {refinable.length > 0 ? (
        <Card
          title="Разнесено на этаж без разбивки"
          hint="Уточните конструктив, когда сверите ТТН с захватками — тогда приход попадёт в К_факт конкретного блока."
        >
          {allocationTable(refinable)}
        </Card>
      ) : null}

      <Card title="Реестр приходов и списаний">
        {rows.length === 0 ? (
          <Empty>Приходов пока нет.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid-table text-sm">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Материал</th>
                  <th>Количество</th>
                  <th>Ед.</th>
                  <th>ТТН</th>
                  <th>Поставщик</th>
                  <th>Конструктив</th>
                  <th>Оси / примечание</th>
                  <th>Источник</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, PAGE_SIZE).map((d) => {
                  const material = materialById.get(d.materialId);
                  return (
                    <tr key={d.id}>
                      <td>{date(d.date)}</td>
                      <td>{material?.name ?? '—'}</td>
                      <td>{num(n(d.quantity))}</td>
                      <td>{material?.unit ?? '—'}</td>
                      <td>{d.ttnNumber ?? '—'}</td>
                      <td>{d.supplier ?? '—'}</td>
                      <td>{targetLabel(d)}</td>
                      <td>{noteOf(d) ?? '—'}</td>
                      <td>{d.source === 'prihody' ? 'импорт' : 'ручной ввод'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > PAGE_SIZE ? (
              <p className="mt-2 text-xs text-slate-500">
                Показаны первые {PAGE_SIZE} из {rows.length} записей. Полный реестр — в выгрузке
                Excel.
              </p>
            ) : null}
          </div>
        )}
      </Card>

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

      {issueRows.length > 0 ? (
        <Card
          title="Списания по процентовке КС-6а"
          hint="Этажи, где приход не разнесён по конструктивам: расход по конструктиву берётся из закрытого объёма. Записи создаёт импорт, вручную не вводятся."
        >
          <div className="overflow-x-auto">
            <table className="grid-table text-sm">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Материал</th>
                  <th>Количество</th>
                  <th>Конструктив</th>
                  <th>Документ</th>
                </tr>
              </thead>
              <tbody>
                {issueRows.slice(0, PAGE_SIZE).map((i) => {
                  const material = materialById.get(i.materialId);
                  return (
                    <tr key={i.id}>
                      <td>{date(i.date)}</td>
                      <td>{material?.name ?? '—'}</td>
                      <td>
                        {num(n(i.quantity))} {material?.unit ?? ''}
                      </td>
                      <td>{structureById.get(i.structureId)?.name ?? '—'}</td>
                      <td>{i.document ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {issueRows.length > PAGE_SIZE ? (
              <p className="mt-2 text-xs text-slate-500">
                Показаны первые {PAGE_SIZE} из {issueRows.length} записей.
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
