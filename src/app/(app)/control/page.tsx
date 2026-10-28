import Link from 'next/link';
import { db } from '@/db';
import { closings, materials, pours } from '@/db/schema';
import { requirePage } from '@/lib/auth';
import { buildProtection, type ProtectionRow } from '@/lib/protection';
import { buildReport } from '@/lib/report';
import { buildOverrun, overrunByMaterial, overrunCost as sumOverrunCost } from '@/lib/overrun';
import { moneyShort, n, num, percent, signed } from '@/lib/format';
import { Card, Empty, Stat, VerdictBadge } from '@/components/ui';
import { ProtectionTable } from '@/components/protection';
import { ControlTabs } from '@/components/control-tabs';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Контроль — СтройКонтроль' };

const sum = (rows: ProtectionRow[], f: (r: ProtectionRow) => number) => rows.reduce((a, r) => a + f(r), 0);
const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default async function ControlPage() {
  const user = await requirePage('control');
  const [{ rows, tiers }, report, pourRows, closingRows, materialRows] = await Promise.all([
    buildProtection(),
    buildReport(),
    db.select().from(pours),
    db.select().from(closings),
    db.select().from(materials),
  ]);

  const withProject = rows.filter((r) => r.project != null);
  const projectTotal = sum(withProject, (r) => r.project!);
  const closedTotal = sum(withProject, (r) => Math.min(r.closed, r.project!));
  const executedTotal = sum(withProject, (r) => Math.min(r.executed, r.project!));

  const queue = rows
    .filter((r) => r.status === 'overdue' || r.status === 'pending')
    .sort((a, b) => b.overdueDays - a.overdueDays || b.unclosed - a.unclosed);
  const overdue = queue.filter((r) => r.status === 'overdue');
  const queueValue = sum(queue, (r) => r.unclosedValue ?? 0);
  const overdueValue = sum(overdue, (r) => r.unclosedValue ?? 0);
  const protectionDays = rows.map((r) => r.protectionDays).filter((d): d is number => d != null);
  const avgProtection =
    protectionDays.length > 0 ? protectionDays.reduce((a, d) => a + d, 0) / protectionDays.length : null;

  // Помесячно: сколько залито и сколько закрыто — расходящиеся «ножницы» видны сразу.
  const concreteIds = new Set(materialRows.filter((m) => m.kind === 'concrete').map((m) => m.id));
  const monthly = new Map<string, { poured: number; closed: number }>();
  const bucket = (ym: string) => monthly.get(ym) ?? monthly.set(ym, { poured: 0, closed: 0 }).get(ym)!;
  for (const p of pourRows) if (p.status === 'done') bucket(p.pouredAt.slice(0, 7)).poured += n(p.designVolumeM3);
  for (const c of closingRows) if (concreteIds.has(c.materialId)) bucket(c.period.slice(0, 7)).closed += n(c.designQuantity);
  const months = [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b));

  const tracked = report.totals.filter((c) => c.material.kind === 'concrete' || c.material.isAggregate);
  const lines = buildOverrun(report);
  const overrunCost = sumOverrunCost(lines);
  const overrunOf = overrunByMaterial(lines);

  const groups = [
    ...tiers.map((t) => ({ key: t.code, name: t.name, rows: rows.filter((r) => r.tierId === t.id) })),
    { key: 'none', name: 'Строки КС-6а без этажа', rows: rows.filter((r) => r.tierId == null) },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Контроль</h1>
        <ControlTabs user={user} active="control" />
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          Прораб отмечает выполнение конструктива, сметчик закрывает его процентовкой. Объём,
          выполненный в месяце, должен быть защищён в процентовке этого же месяца — всё, что
          висит дольше, показано как задержка. Считается по бетону: арматура закрывается вместе
          с конструктивом.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Защищено по проекту"
          value={percent(projectTotal > 0 ? closedTotal / projectTotal : null)}
          sub={`${num(closedTotal, 0)} из ${num(projectTotal, 0)} м³; выполнено ${percent(
            projectTotal > 0 ? executedTotal / projectTotal : null,
          )}`}
        />
        <Stat
          label="Ждёт защиты"
          value={moneyShort(queueValue)}
          sub={`${num(sum(queue, (r) => r.unclosed))} м³ на ${queue.length} конструктивах`}
          tone={queue.length > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Задержка защиты"
          value={overdue.length > 0 ? `${overdue.length} шт` : 'нет'}
          sub={
            overdue.length > 0
              ? `${moneyShort(overdueValue)}, до ${Math.max(...overdue.map((r) => r.overdueDays))} дн`
              : avgProtection != null
                ? `средний срок защиты ${Math.round(avgProtection)} дн`
                : 'выполненное закрыто в срок'
          }
          tone={overdue.length > 0 ? 'over' : 'ok'}
        />
        <Stat
          label="Перерасход по приходу"
          value={moneyShort(overrunCost)}
          sub="привезено сверх проекта × К, по себестоимости"
          tone={overrunCost > 0 ? 'over' : 'ok'}
        />
      </div>

      <Card
        title="Очередь на защиту"
        hint="Выполнено, но не закрыто процентовкой. Красное — месяц выполнения прошёл, а объём так и не предъявлен."
      >
        {queue.length === 0 ? (
          <Empty>Всё выполненное закрыто процентовкой.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <ProtectionTable rows={queue} showMoney />
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Выполнение и закрытие по месяцам" hint="Конструктивный объём бетона, м³.">
          {months.length === 0 ? (
            <Empty>Данных пока нет.</Empty>
          ) : (
            <table className="grid-table text-sm">
              <thead>
                <tr>
                  <th>Месяц</th>
                  <th>Выполнено (журнал прораба)</th>
                  <th>Закрыто процентовкой</th>
                </tr>
              </thead>
              <tbody>
                {months.map(([ym, m]) => (
                  <tr key={ym}>
                    <td>{monthLabel(ym)}</td>
                    <td>{m.poured > 0 ? num(m.poured) : '—'}</td>
                    <td>{m.closed > 0 ? num(m.closed) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-slate-500">
            До перехода на систему выполнение не велось — история есть только в процентовке.
          </p>
        </Card>

        <Card
          title="Смета, договор и перерасход"
          hint="Рост к смете — насколько действующий ДС или проект × К больше сметного лимита: это объём по договору, а не перерасход. Перерасход — привезено сверх проекта × К, сумма по блокам."
        >
          <table className="grid-table text-sm">
            <thead>
              <tr>
                <th>Материал</th>
                <th>Смета</th>
                <th>ДС / проект × К</th>
                <th>Рост к смете</th>
                <th>Приход</th>
                <th>Перерасход</th>
                <th>Оценка</th>
              </tr>
            </thead>
            <tbody>
              {tracked.map((c) => {
                const o = overrunOf.get(c.material.id);
                return (
                  <tr key={c.material.id} className={c.superseded ? 'text-slate-400' : undefined}>
                    <td>{c.material.name}</td>
                    <td>
                      {num(c.estimatePurchase, 0)} {c.material.unit}
                    </td>
                    <td>{c.superseded ? '—' : num(c.basePurchase, 0)}</td>
                    <td>
                      {!c.superseded && c.basePurchase != null && c.estimatePurchase != null
                        ? signed(c.basePurchase - c.estimatePurchase, 0)
                        : '—'}
                    </td>
                    <td>{num(c.balance.incoming, 0)}</td>
                    <td>{o && o.overrun > 0 ? signed(o.overrun) : '—'}</td>
                    <td>{o ? <VerdictBadge verdict={o.verdict} /> : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-sm">
            <Link href="/dashboard" className="text-sky-700 underline">
              Блоки с перерасходом →
            </Link>
          </p>
        </Card>
      </div>

      <Card title="По этажам" hint="Раскройте этаж, чтобы увидеть каждый конструктив.">
        <div className="space-y-2">
          {groups.map((g) => {
            const gp = g.rows.filter((r) => r.project != null);
            const project = sum(gp, (r) => r.project!);
            const closed = sum(gp, (r) => Math.min(r.closed, r.project!));
            const executed = sum(gp, (r) => Math.min(r.executed, r.project!));
            const late = g.rows.filter((r) => r.status === 'overdue').length;
            const waiting = g.rows.filter((r) => r.status === 'pending').length;
            return (
              <details key={g.key} className="rounded border border-slate-200" open={late > 0}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-800">{g.name}</span>
                  <span className="text-slate-600">
                    выполнено {percent(project > 0 ? executed / project : null, 0)} · защищено{' '}
                    {percent(project > 0 ? closed / project : null, 0)} из {num(project, 0)} м³
                  </span>
                  {late > 0 ? <span className="text-red-700">задержка: {late}</span> : null}
                  {waiting > 0 ? <span className="text-amber-800">ждут защиты: {waiting}</span> : null}
                </summary>
                <div className="overflow-x-auto border-t border-slate-200 p-2">
                  <ProtectionTable rows={g.rows} showMoney />
                </div>
              </details>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
