import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { deliveries, issues, materials, pours, structures } from '@/db/schema';
import { buildReport } from '@/lib/report';
import { coeff, date, n, num } from '@/lib/format';
import { canWrite, requirePage } from '@/lib/auth';
import { K_CONCRETE } from '@/domain';
import { Card, Empty, VerdictBadge } from '@/components/ui';
import { PourForm } from './form';
import { CompleteForm } from './complete';
import { loadTargetGroups } from '@/lib/targets';
import { buildProtection } from '@/lib/protection';
import { ProtectionTable } from '@/components/protection';
import { StatusControl } from './status';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Выполнение — СтройКонтроль' };

export default async function PoursPage() {
  const user = await requirePage('pours');
  const [report, structureRows, concreteMaterials, pourRows, deliveryRows, issueRows, targetGroups, protection] =
    await Promise.all([
      buildReport(),
      db.select().from(structures).orderBy(structures.sortOrder),
      db.select().from(materials).where(eq(materials.kind, 'concrete')).orderBy(materials.id),
      db.select().from(pours).orderBy(desc(pours.pouredAt), desc(pours.id)),
      db.select().from(deliveries),
      db.select().from(issues),
      loadTargetGroups({ includeTiers: false }),
      buildProtection(),
    ]);
  // Прорабу — то, что сейчас в работе или ждёт закрытия: под это готовится исполнительная.
  const active = protection.rows.filter((r) => r.status !== 'closed' && r.status !== 'not_started');

  const structureName = new Map(structureRows.map((s) => [s.id, s]));
  const materialName = new Map(concreteMaterials.map((m) => [m.id, m]));

  const concreteByPour = new Map<number, number>();
  for (const d of deliveryRows) {
    if (d.pourId == null) continue;
    concreteByPour.set(d.pourId, (concreteByPour.get(d.pourId) ?? 0) + n(d.quantity));
  }
  const writtenByPour = new Map<number, number>();
  const rebarByPour = new Map<number, number>();
  for (const i of issueRows) {
    if (i.pourId == null) continue;
    const material = report.materials.find((m) => m.id === i.materialId);
    if (material?.kind === 'rebar') {
      rebarByPour.set(i.pourId, (rebarByPour.get(i.pourId) ?? 0) + n(i.quantity));
    } else {
      writtenByPour.set(i.pourId, (writtenByPour.get(i.pourId) ?? 0) + n(i.quantity));
    }
  }

  // Конструктивы-разделы захватку не несут: заливают конкретную конструкцию.
  const pourTargets = structureRows.filter((s) => s.kind !== 'object' && s.kind !== 'section');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Выполнение</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          Когда конструктив забетонирован, отметьте выполнение — с этой даты объём ждёт защиты в
          процентовке, и руководитель видит, что закрыть.
        </p>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          Захватка — единица учёта: залили такой-то объём такой-то конструкции. Проектный объём
          захватки, умноженный на {coeff(K_CONCRETE)}, — это норма; всё, что принято по ТТН сверх
          неё, идёт в перерасход.
        </p>
      </div>

      {canWrite(user, 'pours') ? (
        <Card title="Отметить выполнение конструктива">
          <CompleteForm targets={targetGroups} materials={concreteMaterials} />
        </Card>
      ) : null}

      <Card title="В работе и ждёт защиты">
        {active.length === 0 ? (
          <Empty>Нет конструктивов в работе: всё выполненное закрыто.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <ProtectionTable rows={active} showMoney={false} />
          </div>
        )}
      </Card>

      {canWrite(user, 'pours') ? (
        <Card
          title="Новая захватка вручную"
          hint="Для частичной заливки с отдельным номером и статусом «запланирована / в работе»."
        >
          <PourForm structures={pourTargets} materials={concreteMaterials} />
        </Card>
      ) : null}

      <Card
        title="Журнал заливок"
      >
        {pourRows.length === 0 ? (
          <Empty>Захваток пока нет.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid-table text-sm">
              <thead>
                <tr>
                  <th>Захватка</th>
                  <th>Конструктив</th>
                  <th>Дата</th>
                  <th>Класс</th>
                  <th>Проектный объём</th>
                  <th>Норма (×{coeff(K_CONCRETE)})</th>
                  <th>Принято по ТТН</th>
                  <th>Списано по КС-6а</th>
                  <th>К&nbsp;факт</th>
                  <th>Отклонение</th>
                  <th>Арматура, т</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {pourRows.map((p) => {
                  const design = n(p.designVolumeM3);
                  const norm = design * K_CONCRETE;
                  const ttn = concreteByPour.get(p.id) ?? 0;
                  const acted = writtenByPour.get(p.id) ?? 0;
                  const fact = ttn + acted;
                  const kActual = design > 0 ? fact / design : null;
                  const deviation = fact > 0 ? fact - norm : null;
                  const verdict =
                    kActual == null
                      ? ('unknown' as const)
                      : kActual / K_CONCRETE <= 1.02
                        ? ('ok' as const)
                        : kActual / K_CONCRETE <= 1.05
                          ? ('warning' as const)
                          : ('over' as const);
                  return (
                    <tr key={p.id}>
                      <td>{p.label}</td>
                      <td>{structureName.get(p.structureId)?.name ?? '—'}</td>
                      <td>{date(p.pouredAt)}</td>
                      <td>{materialName.get(p.concreteMaterialId)?.concreteClass ?? '—'}</td>
                      <td>{num(design)}</td>
                      <td>{num(norm)}</td>
                      <td>{num(ttn)}</td>
                      <td>{num(acted)}</td>
                      <td>{coeff(kActual)}</td>
                      <td
                        className={
                          deviation != null && deviation > 0.01
                            ? 'font-medium text-red-700'
                            : undefined
                        }
                      >
                        {deviation == null ? '—' : num(deviation)}
                      </td>
                      <td>{num(rebarByPour.get(p.id) ?? 0)}</td>
                      <td className="flex items-center justify-end gap-2">
                        <VerdictBadge verdict={verdict} />
                        {canWrite(user, 'pours') ? (
                          <StatusControl pourId={p.id} status={p.status} />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
