import { db } from '@/db';
import { baselines, materials, structures } from '@/db/schema';
import { diffRevisions, SOURCE_LABELS, type RevisionEntry } from '@/domain';
import { nOrNull, num, signed } from '@/lib/format';
import { buildReport } from '@/lib/report';
import { Card, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Редакции — СтройКонтроль' };

const KIND_LABEL: Record<string, string> = {
  added: 'появилось',
  removed: 'убрано',
  quantity: 'изменён объём',
  class: 'изменён класс',
  unchanged: 'без изменений',
};

export default async function RevisionsPage() {
  const [report, baselineRows, structureRows, materialRows] = await Promise.all([
    buildReport(),
    db.select().from(baselines),
    db.select().from(structures),
    db.select().from(materials),
  ]);

  const structureById = new Map(structureRows.map((s) => [s.id, s]));
  const materialById = new Map(materialRows.map((m) => [m.id, m]));

  const toEntry = (b: (typeof baselineRows)[number]): RevisionEntry | null => {
    const s = structureById.get(b.structureId);
    const m = materialById.get(b.materialId);
    if (!s || !m) return null;
    return {
      source: b.source as RevisionEntry['source'],
      revision: b.revision,
      designQuantity: nOrNull(b.designQuantity),
      purchaseQuantity: nOrNull(b.purchaseQuantity),
      effectiveFrom: b.effectiveFrom,
      structureCode: s.code,
      structureName: s.name,
      // Сопоставление идёт по паре «конструктив + вид материала», а класс бетона
      // считается атрибутом редакции. Иначе переезд плиты ЛПК с В25 на В30 дал бы
      // одновременно фиктивный перерасход по В30 и фиктивную экономию по В25.
      materialCode: m.kind === 'concrete' ? 'CONCRETE' : m.isAggregate ? 'REBAR' : m.code,
      materialName: m.kind === 'concrete' ? 'Бетон' : m.name,
      concreteClass: m.concreteClass,
    };
  };

  const entries = baselineRows.map(toEntry).filter((e): e is RevisionEntry => e !== null);

  // Показываем только позиции пилота: бетон и арматуру общим тоннажом.
  const tracked = entries.filter(
    (e) => e.materialCode === 'CONCRETE' || e.materialCode === 'REBAR',
  );

  const revisions = [...new Set(tracked.map((e) => `${e.source}|${e.revision}`))].sort((a, b) => {
    const ea = tracked.find((e) => `${e.source}|${e.revision}` === a)!;
    const eb = tracked.find((e) => `${e.source}|${e.revision}` === b)!;
    return ea.effectiveFrom.localeCompare(eb.effectiveFrom);
  });

  const pairs: { from: string; to: string }[] = [];
  for (let i = 1; i < revisions.length; i++) {
    pairs.push({ from: revisions[i - 1], to: revisions[i] });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Редакции баз сравнения</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          История того, как менялись опорные объёмы: смета → редакции ДС → выпуски рабочей
          документации. Смена класса бетона показывается отдельно от изменения объёма — иначе она
          выглядела бы как перерасход по одному классу и экономия по другому.
        </p>
      </div>

      {report.classConflicts.length > 0 ? (
        <Card title="Конфликты класса между проектом и договором">
          <ul className="space-y-2 text-sm text-slate-700">
            {report.classConflicts.map((c, i) => (
              <li key={i} className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                <span className="font-medium">
                  {c.structureCode} — {c.structureName}
                </span>
                : {c.revision} задаёт {c.projectMaterial}, договор на {c.parentCode} закупает{' '}
                {c.contractMaterial}. Требуется решение сметчика.
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {pairs.length === 0 ? (
        <Card title="Диффы">
          <Empty>Загружена одна редакция — сравнивать пока не с чем.</Empty>
        </Card>
      ) : (
        pairs.map(({ from, to }) => {
          const [fromSource, fromRev] = from.split('|');
          const [toSource, toRev] = to.split('|');
          const rows = diffRevisions(
            tracked.filter((e) => `${e.source}|${e.revision}` === from),
            tracked.filter((e) => `${e.source}|${e.revision}` === to),
          ).filter((r) => r.kind !== 'unchanged');

          return (
            <Card
              key={`${from}->${to}`}
              title={`${SOURCE_LABELS[fromSource as keyof typeof SOURCE_LABELS]} ${fromRev} → ${
                SOURCE_LABELS[toSource as keyof typeof SOURCE_LABELS]
              } ${toRev}`}
            >
              {rows.length === 0 ? (
                <Empty>Расхождений нет.</Empty>
              ) : (
                <table className="grid-table text-sm">
                  <thead>
                    <tr>
                      <th>Конструктив</th>
                      <th>Материал</th>
                      <th>Было</th>
                      <th>Стало</th>
                      <th>Изменение</th>
                      <th>Класс</th>
                      <th>Что произошло</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td>
                          {r.structureCode} — {r.structureName}
                        </td>
                        <td>{r.materialName}</td>
                        <td>{num(r.fromQuantity)}</td>
                        <td>{num(r.toQuantity)}</td>
                        <td
                          className={
                            (r.delta ?? 0) > 0.01 ? 'font-medium text-red-700' : undefined
                          }
                        >
                          {signed(r.delta)}
                        </td>
                        <td>
                          {r.fromClass || r.toClass
                            ? `${r.fromClass ?? '—'} → ${r.toClass ?? '—'}`
                            : '—'}
                        </td>
                        <td className="text-left">{KIND_LABEL[r.kind]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
