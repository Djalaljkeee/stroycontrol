import { buildReport, type Cell } from '@/lib/report';
import { coeff, money, num, percent, signed } from '@/lib/format';
import { BasisBadge, Card, Empty, VerdictBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Остаточная таблица — СтройКонтроль' };

export default async function BalancePage() {
  const report = await buildReport();

  const concrete = report.totals.filter((c) => c.material.kind === 'concrete');
  const rebarAggregate = report.totals.filter(
    (c) => c.material.kind === 'rebar' && c.material.isAggregate,
  );
  const rebarSkus = report.totals.filter(
    (c) => c.material.kind === 'rebar' && !c.material.isAggregate,
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Остаточная таблица</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          Замена листа «приходы»: к приходу добавлены списание, складской остаток и прогноз.
          Прежняя таблица считала остаток как «смета минус приход», что не является складским
          остатком и не показывает перерасход.
        </p>
      </div>

      <Card
        title="Бетон"
        hint="Бетон не складируется: списание — это привязка ТТН к захватке либо закрытый объём по КС-6а."
      >
        <BalanceTable rows={concrete} />
      </Card>

      <Card
        title="Арматура"
        hint="Приход ведётся по диаметрам, сравнение со сметой — общим тоннажом: смета арматуру по диаметрам не расписывает."
      >
        <BalanceTable rows={rebarAggregate} />
      </Card>

      <Card
        title="Арматура по диаметрам — склад"
        hint="Актов монтажа в разрезе диаметров нет: КС-6а закрывает арматуру общим тоннажом. Поэтому здесь только приход, склад и проектная потребность по КЖ, без прогноза."
      >
        <SkuTable rows={rebarSkus} />
      </Card>
    </div>
  );
}

function BalanceTable({ rows }: { rows: Cell[] }) {
  if (rows.length === 0) return <Empty>Нет данных</Empty>;

  return (
    <div className="overflow-x-auto">
      <table className="grid-table text-sm">
        <thead>
          <tr>
            <th>Материал</th>
            <th>Ед.</th>
            <th>Смета</th>
            <th>Проект</th>
            <th>База</th>
            <th>Приход</th>
            <th>Списано</th>
            <th>Склад</th>
            <th>Неподтв.</th>
            <th>Вып., %</th>
            <th>К&nbsp;норм</th>
            <th>К&nbsp;факт</th>
            <th>Прогноз</th>
            <th>Перерасход</th>
            <th>В рублях</th>
            <th>Оценка</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.material.id} className={c.superseded ? 'text-slate-400' : undefined}>
              <td>
                {c.material.name}
                {c.superseded ? (
                  <span
                    className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 ring ring-slate-200"
                    title="Действующий ДС перевёл эти конструктивы на другой класс бетона. Сметный лимит показан для сверки, прогноз по нему не строится."
                  >
                    лимит переехал
                  </span>
                ) : null}
              </td>
              <td>{c.material.unit}</td>
              <td>
                {num(c.estimatePurchase)}
                {c.estimateOriginal != null &&
                c.estimatePurchase != null &&
                Math.abs(c.estimateOriginal - c.estimatePurchase) > 0.01 ? (
                  <span
                    className="ml-1 text-xs text-slate-400"
                    title={`По ресурсной ${num(c.estimateOriginal)} ${c.material.unit}. Разница — лимит конструктивов, переведённых действующим ДС на другой класс бетона: он учитывается там, где эти конструктивы теперь заливаются.`}
                  >
                    ({num(c.estimateOriginal, 0)})
                  </span>
                ) : null}
              </td>
              <td>{num(c.projectPurchase)}</td>
              <td>
                <BasisBadge
                  source={c.base?.source}
                  revision={c.base?.revision}
                  estimated={c.base?.isEstimated}
                />
              </td>
              <td>{num(c.balance.incoming)}</td>
              <td>{num(c.balance.consumed)}</td>
              <td>{num(c.balance.stock)}</td>
              <td className={c.balance.unconfirmed > 0.01 ? 'font-medium text-red-700' : undefined}>
                {num(c.balance.unconfirmed)}
              </td>
              <td>{percent(c.forecast.progress)}</td>
              <td>{coeff(c.k)}</td>
              <td
                className={
                  c.forecast.verdict === 'over'
                    ? 'font-medium text-red-700'
                    : c.forecast.verdict === 'warning'
                      ? 'font-medium text-amber-700'
                      : undefined
                }
              >
                {coeff(c.forecast.kActual)}
                {c.forecast.confidence === 'preliminary' && c.forecast.kActual != null ? (
                  <span title="Выполнено меньше 10% — коэффициент ещё не показателен"> *</span>
                ) : null}
              </td>
              <td>{num(c.forecast.total)}</td>
              <td>{signed(c.forecast.overrunVsEstimate)}</td>
              <td>{money(c.forecast.overrunCost)}</td>
              <td>
                <VerdictBadge verdict={c.forecast.verdict} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        Звёздочка у К&nbsp;факт — прогноз предварительный: выполнено меньше 10% объёма.
        «Неподтв.» — приход, не привязанный ни к одной конструкции. Значение в скобках
        у сметы — лимит по ресурсной до переезда конструктивов между классами бетона.
      </p>
    </div>
  );
}

function SkuTable({ rows }: { rows: Cell[] }) {
  if (rows.length === 0) return <Empty>Нет данных</Empty>;

  return (
    <div className="overflow-x-auto">
      <table className="grid-table text-sm">
        <thead>
          <tr>
            <th>Позиция</th>
            <th>⌀, мм</th>
            <th>Класс</th>
            <th>Проект (КЖ)</th>
            <th>Приход</th>
            <th>Списано</th>
            <th>Склад</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.material.id}>
              <td>{c.material.name}</td>
              <td>{c.material.rebarDiameter ?? '—'}</td>
              <td>{c.material.rebarClass ?? '—'}</td>
              <td>{num(c.projectPurchase)}</td>
              <td>{num(c.balance.incoming)}</td>
              <td>{num(c.balance.consumed)}</td>
              <td>{num(c.balance.stock)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
