import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { deliveries, materials, pours, structures } from '@/db/schema';
import { date, n, num } from '@/lib/format';
import { canWrite, currentUser } from '@/lib/auth';
import { Card, Empty } from '@/components/ui';
import { DeliveryForm } from './form';
import { AllocateForm } from './allocate';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Приходы — СтройКонтроль' };

const PAGE_SIZE = 60;

export default async function DeliveriesPage() {
  const user = await currentUser();
  const [materialRows, pourRows, structureRows, rows] = await Promise.all([
    db.select().from(materials).orderBy(materials.id),
    db.select().from(pours).orderBy(desc(pours.pouredAt)),
    db.select().from(structures),
    db.select().from(deliveries).orderBy(desc(deliveries.date), desc(deliveries.id)),
  ]);

  const materialById = new Map(materialRows.map((m) => [m.id, m]));
  const structureById = new Map(structureRows.map((s) => [s.id, s]));
  const pourById = new Map(pourRows.map((p) => [p.id, p]));

  // Разнесению по захваткам подлежит только бетон: у арматуры есть склад,
  // и непривязанный приход там — это запас, а не потерянный расход. Проверяем
  // вид материала, а не только флаг: флаг мог быть выставлен ошибочно.
  const unallocated = rows.filter(
    (d) =>
      d.needsAllocation &&
      d.pourId == null &&
      materialById.get(d.materialId)?.kind === 'concrete',
  );
  const unallocatedTotal = unallocated.reduce((acc, d) => acc + n(d.quantity), 0);

  // Приход арматуры вводится по диаметрам; агрегатная позиция служит только
  // для сравнения со сметой и в форме не предлагается.
  const selectableMaterials = materialRows.filter((m) => !m.isAggregate);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Приходы</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          Бетон привязывается к захватке прямо при вводе — склада у него нет, поэтому приход и есть
          списание. Арматура принимается на склад по диаметрам, а списывается отдельно актом
          монтажа.
        </p>
      </div>

      {canWrite(user, 'deliveries') ? (
        <Card title="Новый приход">
          <DeliveryForm materials={selectableMaterials} pours={pourRows} structures={structureRows} />
        </Card>
      ) : null}

      {unallocated.length > 0 ? (
        <Card
          title={`Требуют разнесения по захваткам — ${num(unallocatedTotal)} м³`}
          hint="Поставки бетона из листа «приходы»: в исходных данных они не привязаны ни к одной конструкции. Пока приход не разнесён, он числится неподтверждённым расходом."
        >
          <div className="overflow-x-auto">
            <table className="grid-table text-sm">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Материал</th>
                  <th>Объём</th>
                  <th>Захватка</th>
                </tr>
              </thead>
              <tbody>
                {unallocated.slice(0, PAGE_SIZE).map((d) => {
                  const material = materialById.get(d.materialId);
                  const options = pourRows.filter(
                    (p) => p.concreteMaterialId === d.materialId,
                  );
                  return (
                    <tr key={d.id}>
                      <td>{date(d.date)}</td>
                      <td>{material?.name ?? '—'}</td>
                      <td>{num(n(d.quantity))}</td>
                      <td>
                        {canWrite(user, 'deliveries') ? (
                          <AllocateForm
                            deliveryId={d.id}
                            pours={options.map((p) => ({
                              id: p.id,
                              label: `${p.label} · ${
                                structureById.get(p.structureId)?.name ?? ''
                              }`,
                            }))}
                          />
                        ) : (
                          <span className="text-slate-400">нет прав</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {unallocated.length > PAGE_SIZE ? (
              <p className="mt-2 text-xs text-slate-500">
                Показаны первые {PAGE_SIZE} из {unallocated.length} записей.
              </p>
            ) : null}
          </div>
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
                  <th>Захватка</th>
                  <th>Источник</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, PAGE_SIZE).map((d) => {
                  const material = materialById.get(d.materialId);
                  const pour = d.pourId != null ? pourById.get(d.pourId) : null;
                  return (
                    <tr key={d.id}>
                      <td>{date(d.date)}</td>
                      <td>{material?.name ?? '—'}</td>
                      <td>{num(n(d.quantity))}</td>
                      <td>{material?.unit ?? '—'}</td>
                      <td>{d.ttnNumber ?? '—'}</td>
                      <td>{d.supplier ?? '—'}</td>
                      <td>
                        {pour
                          ? `${pour.label} · ${structureById.get(pour.structureId)?.name ?? ''}`
                          : material?.kind === 'concrete'
                            ? '— не разнесён'
                            : 'на склад'}
                      </td>
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
