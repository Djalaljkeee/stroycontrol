import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { baselines, closings, materials, structures } from '@/db/schema';
import { date, n, num, signed } from '@/lib/format';
import { canWrite, currentUser } from '@/lib/auth';
import { loadTargetGroups } from '@/lib/targets';
import { Card, Empty } from '@/components/ui';
import { ClosingForm } from './form';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Процентовка — СтройКонтроль' };

const RECENT = 40;

const monthLabel = (period: string) =>
  new Date(`${period}T00:00:00Z`).toLocaleDateString('ru-RU', { month: 'short', year: '2-digit', timeZone: 'UTC' });

export default async function ClosingsPage() {
  const user = await currentUser();
  const [materialRows, structureRows, contractRows, closingRows, targetGroups] = await Promise.all([
    db.select().from(materials).orderBy(materials.id),
    db.select().from(structures).orderBy(structures.sortOrder),
    db.select().from(baselines).where(eq(baselines.source, 'contract')),
    db.select().from(closings).orderBy(desc(closings.period), desc(closings.id)),
    loadTargetGroups({ includeTiers: false }),
  ]);

  const materialById = new Map(materialRows.map((m) => [m.id, m]));
  const structureById = new Map(structureRows.map((s) => [s.id, s]));

  // Действующая договорная база: по каждой строке КС-6а — последняя редакция ДС.
  const contract = new Map<string, (typeof contractRows)[number]>();
  for (const b of contractRows) {
    if (b.structureId == null) continue;
    const key = `${b.structureId}:${b.materialId}`;
    const prev = contract.get(key);
    if (!prev || b.effectiveFrom > prev.effectiveFrom) contract.set(key, b);
  }

  // Процентовка вводится на захватку, а договор — на строку КС-6а: поднимаемся
  // по дереву до первого узла, у которого есть договорная база по материалу.
  const lineOf = (structureId: number, materialId: number): number | null => {
    for (let s = structureById.get(structureId); s; s = s.parentId != null ? structureById.get(s.parentId) : undefined) {
      if (contract.has(`${s.id}:${materialId}`)) return s.id;
    }
    return null;
  };

  const periods = [...new Set(closingRows.map((c) => c.period))].sort();
  type Line = { structureId: number; materialId: number; byPeriod: Map<string, number>; total: number };
  const lines = new Map<string, Line>();
  const orphan: typeof closingRows = [];
  for (const c of closingRows) {
    const lineId = lineOf(c.structureId, c.materialId);
    if (lineId == null) {
      orphan.push(c);
      continue;
    }
    const key = `${lineId}:${c.materialId}`;
    const line = lines.get(key) ?? { structureId: lineId, materialId: c.materialId, byPeriod: new Map(), total: 0 };
    line.byPeriod.set(c.period, (line.byPeriod.get(c.period) ?? 0) + n(c.quantity));
    line.total += n(c.quantity);
    lines.set(key, line);
  }
  // Строки договора без процентовки тоже показываем: видно, что ещё не начато.
  for (const [key, b] of contract) {
    if (!lines.has(key)) lines.set(key, { structureId: b.structureId!, materialId: b.materialId, byPeriod: new Map(), total: 0 });
  }
  const sortOrder = (id: number) => structureById.get(id)?.sortOrder ?? 0;
  const lineList = [...lines.values()]
    .filter((l) => {
      const m = materialById.get(l.materialId);
      return m && (m.kind === 'concrete' || m.isAggregate);
    })
    .sort((a, b) => sortOrder(a.structureId) - sortOrder(b.structureId) || a.materialId - b.materialId);

  const selectable = materialRows.filter((m) => m.kind === 'concrete' || m.isAggregate);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Процентовка</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          Что закрыто перед заказчиком по КС-6а, помесячно. Вводится на захватку яруса — так
          видно, какой именно этаж закрыт, — а в таблице собирается по строкам договора. Объём
          конструктива по строке работ задаёт выполнение: от него считаются К_факт и прогноз.
        </p>
      </div>

      {canWrite(user, 'closings') ? (
        <Card title="Закрыть объём за месяц">
          <ClosingForm materials={selectable} targets={targetGroups} />
        </Card>
      ) : null}

      <Card
        title="По строкам КС-6а"
        hint="По договору — количество поставки по действующему ДС. Остаток — сколько ещё можно закрыть по строке."
      >
        <div className="overflow-x-auto">
          <table className="grid-table text-sm">
            <thead>
              <tr>
                <th>Строка КС-6а</th>
                <th>Материал</th>
                <th>По договору</th>
                {periods.map((p) => (
                  <th key={p}>{monthLabel(p)}</th>
                ))}
                <th>Итого</th>
                <th>Остаток</th>
              </tr>
            </thead>
            <tbody>
              {lineList.map((l) => {
                const s = structureById.get(l.structureId)!;
                const m = materialById.get(l.materialId)!;
                const b = contract.get(`${l.structureId}:${l.materialId}`);
                const plan = b?.purchaseQuantity != null ? n(b.purchaseQuantity) : null;
                const rest = plan != null ? plan - l.total : null;
                return (
                  <tr key={`${l.structureId}:${l.materialId}`}>
                    <td>
                      <span className="text-slate-400">{s.code}</span> {s.name}
                      {b ? <span className="ml-1.5 text-xs text-slate-400">{b.revision}</span> : null}
                    </td>
                    <td>{m.name}</td>
                    <td>{num(plan)}</td>
                    {periods.map((p) => (
                      <td key={p}>{l.byPeriod.has(p) ? num(l.byPeriod.get(p)) : ''}</td>
                    ))}
                    <td className="font-medium">{num(l.total)}</td>
                    <td className={rest != null && rest < -0.005 ? 'text-red-700' : undefined}>{signed(rest)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {orphan.length > 0 ? (
          <p className="mt-2 text-xs text-amber-800">
            {orphan.length} записей не легли ни на одну строку договора — материал не совпадает с
            классом по ДС. Проверьте их в журнале ниже.
          </p>
        ) : null}
      </Card>

      <Card title="Журнал процентовки">
        {closingRows.length === 0 ? (
          <Empty>Процентовки пока нет.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid-table text-sm">
              <thead>
                <tr>
                  <th>Конструктив</th>
                  <th>Месяц</th>
                  <th>Материал</th>
                  <th>Закрыто</th>
                  <th>Объём конструктива</th>
                  <th>Документ</th>
                  <th>Источник</th>
                </tr>
              </thead>
              <tbody>
                {closingRows.slice(0, RECENT).map((c) => {
                  const m = materialById.get(c.materialId);
                  return (
                    <tr key={c.id}>
                      <td>{structureById.get(c.structureId)?.name ?? '—'}</td>
                      <td>{date(c.period)}</td>
                      <td>{m?.name ?? '—'}</td>
                      <td>
                        {num(n(c.quantity))} {m?.unit ?? ''}
                      </td>
                      <td>{c.designQuantity != null ? num(n(c.designQuantity)) : '—'}</td>
                      <td>{c.document ?? c.revision ?? '—'}</td>
                      <td>{c.source === 'ks6a' ? 'импорт КС-6а' : 'ручной ввод'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {closingRows.length > RECENT ? (
              <p className="mt-2 text-xs text-slate-500">
                Показаны последние {RECENT} из {closingRows.length} записей.
              </p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
