import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { deliveries, materials, pours, structures, tiers } from '@/db/schema';
import { date, n, num } from '@/lib/format';
import { canWrite, currentUser } from '@/lib/auth';
import { loadTargetGroups } from '@/lib/targets';
import { Card, Empty } from '@/components/ui';
import { DeliveryForm } from './form';
import { AllocateForm } from './allocate';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Приходы — СтройКонтроль' };

const PAGE_SIZE = 60;

export default async function DeliveriesPage() {
  const user = await currentUser();
  const [materialRows, pourRows, structureRows, tierRows, rows, targetGroups] = await Promise.all([
    db.select().from(materials).orderBy(materials.id),
    db.select().from(pours).orderBy(desc(pours.pouredAt)),
    db.select().from(structures),
    db.select().from(tiers),
    db.select().from(deliveries).orderBy(desc(deliveries.date), desc(deliveries.id)),
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

  // Приход арматуры вводится по диаметрам; агрегатная позиция служит только
  // для сравнения со сметой и в форме не предлагается.
  const selectableMaterials = materialRows.filter((m) => !m.isAggregate);
  const writable = canWrite(user, 'deliveries');

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
                  {writable ? (
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
        <h1 className="text-lg font-semibold text-slate-900">Приходы</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          Каждая поставка разносится туда же, куда в листе «приходы»: на ярус и блок — колонны,
          стены, плиту, лестницы. Бетон разносится сразу при вводе — склада у него нет, приход и
          есть расход. Арматуру можно принять на склад и разнести позже.
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
          hint="Пока поставка не разнесена ни на ярус, ни на конструктив, она числится неподтверждённым расходом."
        >
          {allocationTable(unallocated)}
        </Card>
      ) : null}

      {refinable.length > 0 ? (
        <Card
          title="Разнесено на ярус без разбивки"
          hint="Уточните конструктив, когда сверите ТТН с захватками — тогда приход попадёт в К_факт конкретного блока."
        >
          {allocationTable(refinable)}
        </Card>
      ) : null}

      <Card title="Реестр приходов">
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
                  <th>Куда</th>
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
    </div>
  );
}
