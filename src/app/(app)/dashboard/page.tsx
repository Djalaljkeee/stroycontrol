import Link from 'next/link';
import { buildReport } from '@/lib/report';
import { coeff, money, moneyShort, num, percent, signed } from '@/lib/format';
import { Card, Empty, Stat, VerdictBadge } from '@/components/ui';
import { canView, requirePage } from '@/lib/auth';
import { ControlTabs } from '@/components/control-tabs';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Прогноз — СтройКонтроль' };

export default async function DashboardPage() {
  const user = await requirePage('dashboard');
  const report = await buildReport();

  const tracked = report.totals.filter(
    (c) => c.material.kind === 'concrete' || c.material.isAggregate,
  );

  // Прогнозный перерасход в деньгах считается только по позициям, где он
  // положителен: взаимозачёт экономии по одному классу с перерасходом по
  // другому скрыл бы проблему.
  const overrunCost = tracked
    .filter((c) => (c.forecast.overrunVsEstimate ?? 0) > 0)
    .reduce((acc, c) => acc + (c.forecast.overrunCost ?? 0), 0);

  const unconfirmed = tracked.filter((c) => c.balance.unconfirmed > 0.01);
  const unconfirmedCost = unconfirmed.reduce(
    (acc, c) => acc + c.balance.unconfirmed * (c.unitCost ?? 0),
    0,
  );

  const stock = tracked.filter((c) => c.balance.stock > 0.01);
  const stockCost = stock.reduce((acc, c) => acc + c.balance.stock * (c.unitCost ?? 0), 0);

  // Проблемы почти всегда видны на конструктиве, а не в итоге по объекту:
  // перерасход на одной конструкции растворяется в общем объёме.
  const attention = report.structures
    .flatMap((s) => {
      const r = report.byStructure.get(s.id)!;
      return r.cells
        .filter((c) => c.material.kind === 'concrete' || c.material.isAggregate)
        .filter((c) => c.forecast.verdict === 'over' || c.forecast.verdict === 'warning')
        // Без своей базы К считается от армированности родителя — для захваток
        // КЖ0, у которых нет ведомостей, это даёт ложную тревогу.
        .filter((c) => c.forecast.progress != null)
        .map((c) => ({ structure: s, cell: c }));
    })
    // Родительский узел повторяет проблему ребёнка: показываем самый глубокий.
    .filter(({ structure, cell }, _i, all) =>
      !all.some(
        (o) =>
          o.cell.material.id === cell.material.id &&
          o.structure.depth > structure.depth &&
          o.structure.subtree.every((id) => structure.subtree.includes(id)),
      ),
    )
    .sort(
      (a, b) => (b.cell.forecast.overrunCost ?? 0) - (a.cell.forecast.overrunCost ?? 0),
    );

  const object = report.structures.find((s) => s.parentId == null);
  const objectReport = object ? report.byStructure.get(object.id) : undefined;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Контроль</h1>
        <ControlTabs user={user} active="dashboard" />
        <p className="mt-1 text-sm text-slate-600">
          Данные на {report.generatedAt.toLocaleString('ru-RU')}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Выполнено по бетону"
          value={percent(objectReport?.concreteProgress ?? null)}
          sub={`${num(objectReport?.concreteDesignCompleted ?? 0)} из ${num(
            objectReport?.concreteDesignTotal ?? 0,
          )} м³ конструктива`}
        />
        <Stat
          label="Прогноз перерасхода"
          value={moneyShort(overrunCost)}
          sub="по себестоимости, против сметных лимитов"
          tone={overrunCost > 0 ? 'over' : 'ok'}
        />
        <Stat
          label="Неподтверждённый расход"
          value={moneyShort(unconfirmedCost)}
          sub="приход без привязки к конструкции"
          tone={unconfirmedCost > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Лежит на складе"
          value={moneyShort(stockCost)}
          sub="принято, но ещё не смонтировано"
        />
      </div>

      <Card
        title="Требует внимания"
        hint="Фактический коэффициент расхода выше нормативного больше чем на 2%. Показан самый нижний уровень, на котором виден перерасход; звёздочка — выполнено меньше 10%, коэффициент ещё не показателен."
      >
        {attention.length === 0 ? (
          <Empty>Все отслеживаемые позиции в пределах нормы расхода.</Empty>
        ) : (
          <table className="grid-table text-sm">
            <thead>
              <tr>
                <th>Конструктив</th>
                <th>Материал</th>
                <th>К&nbsp;норм</th>
                <th>К&nbsp;факт</th>
                <th>Выполнено</th>
                <th>Прогноз</th>
                <th>Перерасход</th>
                <th>В рублях</th>
                <th>Оценка</th>
              </tr>
            </thead>
            <tbody>
              {attention.map(({ structure, cell: c }) => (
                <tr key={`${structure.id}-${c.material.id}`}>
                  <td>{structure.name}</td>
                  <td>{c.material.name}</td>
                  <td>{coeff(c.k)}</td>
                  <td className="font-medium">{coeff(c.forecast.kActual)}</td>
                  <td>
                    {percent(c.forecast.progress)}
                    {c.forecast.confidence === 'preliminary' ? (
                      <span title="Выполнено меньше 10% — коэффициент ещё не показателен"> *</span>
                    ) : null}
                  </td>
                  <td>
                    {num(c.forecast.total)} {c.material.unit}
                  </td>
                  <td>{signed(c.forecast.overrunVsEstimate)}</td>
                  <td>{money(c.forecast.overrunCost)}</td>
                  <td>
                    <VerdictBadge verdict={c.forecast.verdict} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Приход, расход и процентовка по объекту"
        hint="Расход — разнесённое на конструктивы плюс списанное актами; на этажах КЖ0 и 1, где приход не делился по конструктивам, — запроцентованное. Минус в «Приход − расход» значит: закрыто по норме больше, чем привезено. Плюс — приход без привязки к конструкции."
      >
        <table className="grid-table text-sm">
          <thead>
            <tr>
              <th>Материал</th>
              <th>Приход</th>
              <th>Расход</th>
              <th>Приход − расход</th>
              <th>Запроцентовано</th>
              <th title="Привезено, но ещё не закрыто перед заказчиком">Не запроцентовано</th>
              <th title="Списано на конструктивы, по которым ещё нет выполнения">В работе</th>
            </tr>
          </thead>
          <tbody>
            {tracked.map((c) => {
              const diff = c.material.kind === 'concrete' ? c.balance.unconfirmed : c.balance.stock;
              return (
                <tr key={c.material.id}>
                  <td>{c.material.name}</td>
                  <td>
                    {num(c.balance.incoming)} {c.material.unit}
                  </td>
                  <td>{num(c.balance.consumed)}</td>
                  <td className={diff > 0.01 ? 'font-medium text-amber-700' : diff < -0.01 ? 'text-slate-500' : undefined}>
                    {signed(diff)}
                  </td>
                  <td>{num(c.closed)}</td>
                  <td>{num(c.balance.incoming - c.closed)}</td>
                  <td>{num(c.inProgress)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-slate-600">
          Разнести приход —{' '}
          <Link href="/deliveries" className="text-sky-700 underline">
            Приход и списание
          </Link>
          , закрыть месяц —{' '}
          <Link href="/closings" className="text-sky-700 underline">
            Выполнение
          </Link>
          {canView(user, 'tiers') ? (
            <>
              , сверка по этажам —{' '}
              <Link href="/tiers" className="text-sky-700 underline">
                Этажи
              </Link>
            </>
          ) : null}
          .
        </p>
      </Card>

      {report.classConflicts.length > 0 ? (
        <Card
          title="Расхождение проекта и договора по классу бетона"
          hint="Автоматически такие случаи разрешить нельзя: нужно решение сметчика, по какому классу закрывать конструктив."
        >
          <ul className="space-y-2 text-sm text-slate-700">
            {report.classConflicts.map((c, i) => (
              <li key={i} className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                <span className="font-medium">{c.structureName}</span>: рабочая документация{' '}
                {c.revision} задаёт <span className="font-medium">{c.projectMaterial}</span>, а по
                договору на этот конструктив закупается{' '}
                <span className="font-medium">{c.contractMaterial}</span>.
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
