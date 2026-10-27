import { buildReport, type MaterialInfo, type TierRow } from '@/lib/report';
import { coeff, num, signed } from '@/lib/format';
import { Card, Empty } from '@/components/ui';
import { requirePage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Ярусы — СтройКонтроль' };

/** Сначала бетон по классам, затем арматура общей позицией: так устроен лист «приходы». */
const isHeadline = (m: MaterialInfo) => m.kind === 'concrete' || m.isAggregate;

function RowsTable({ rows, showSku }: { rows: TierRow[]; showSku: boolean }) {
  const visible = rows.filter((r) => (showSku ? !isHeadline(r.material) : isHeadline(r.material)));
  if (visible.length === 0) return null;
  return (
    <table className="grid-table text-sm">
      <thead>
        <tr>
          <th>Позиция</th>
          <th>Ед.</th>
          <th title="Конструктивный объём по последнему выпуску КЖ">Проект</th>
          <th title="Проект × нормативный К расхода — сколько должно быть привезено">Проект × К</th>
          <th>Приход</th>
          <th title="Приход / проект: фактический К расхода по ярусу">К прихода</th>
          <th title="Приход − проект × К: + перевезли, − ещё довезти">Приход − норма</th>
          <th>Запроцентовано</th>
          <th title="Привезено, но ещё не закрыто перед заказчиком">Не запроцентовано</th>
        </tr>
      </thead>
      <tbody>
        {visible.map((r) => {
          const k = r.project ? r.incoming / r.project : null;
          const overNorm = r.projectWithK != null ? r.incoming - r.projectWithK : null;
          const notClosed = r.incoming - r.closed;
          return (
            <tr key={r.material.id}>
              <td>
                {r.material.name}
                {r.projectRevision ? (
                  <span className="ml-1.5 text-xs text-slate-400">{r.projectRevision}</span>
                ) : null}
              </td>
              <td>{r.material.unit}</td>
              <td>{num(r.project)}</td>
              <td>{num(r.projectWithK)}</td>
              <td>{num(r.incoming)}</td>
              <td>{k != null && r.incoming > 0 ? coeff(k) : '—'}</td>
              <td className={overNorm != null && overNorm > 0.005 ? 'text-red-700' : undefined}>
                {overNorm != null && r.incoming > 0 ? signed(overNorm) : '—'}
              </td>
              <td>{num(r.closed)}</td>
              <td className={notClosed < -0.005 ? 'text-red-700' : undefined}>{signed(notClosed)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function TiersPage() {
  await requirePage('tiers');
  const report = await buildReport();
  const unallocated = [...report.unallocatedIncoming.entries()].filter(([, q]) => Math.abs(q) > 0.0005);
  const materialById = new Map(report.materials.map((m) => [m.id, m]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Ярусы</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          То же, что лист «приходы»: по каждому ярусу — проект, проект с коэффициентом, приход и
          запроцентованное, внутри — блоки «колонны / стены / плита / лестницы». Приход попадает
          сюда разнесением на странице «Приходы», процентовка — со страницы «Процентовка».
        </p>
        <nav className="mt-3 flex flex-wrap gap-1.5 text-xs">
          {report.byTier.map((t) => (
            <a
              key={t.tier.id}
              href={`#tier-${t.tier.code}`}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-slate-700 hover:bg-slate-50"
            >
              {t.tier.name}
            </a>
          ))}
        </nav>
      </div>

      {unallocated.length > 0 ? (
        <Card
          title="Приход, не разнесённый ни на ярус, ни на конструктив"
          hint="Бетон без разнесения числится неподтверждённым расходом, арматура — складом. Разнести — на странице «Приходы»."
        >
          <ul className="text-sm text-slate-700">
            {unallocated.map(([id, q]) => (
              <li key={id}>
                {materialById.get(id)?.name ?? id}: {num(q)} {materialById.get(id)?.unit}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {report.byTier.map((t) => {
        const tierOnly = [...t.tierOnlyIncoming.entries()].filter(([, q]) => Math.abs(q) > 0.0005);
        const { levelFrom, levelTo } = t.tier;
        const range =
          levelFrom && levelTo
            ? `${levelFrom} … ${levelTo}`
            : levelTo
              ? `до ${levelTo}`
              : levelFrom
                ? `выше ${levelFrom}`
                : t.tier.stage;
        return (
          <section key={t.tier.id} id={`tier-${t.tier.code}`} className="scroll-mt-4">
            <Card
              title={`${t.tier.name} · ${range}`}
              hint={
                t.tier.consumptionFromClosings
                  ? 'Приход по ярусу исторически не делился по конструктивам: расход здесь считается по процентовке.'
                  : undefined
              }
            >
              {t.rows.length === 0 ? (
                <Empty>По ярусу нет ни проекта, ни прихода.</Empty>
              ) : (
                <div className="space-y-4 overflow-x-auto">
                  <RowsTable rows={t.rows} showSku={false} />

                  {tierOnly.length > 0 ? (
                    <p className="text-xs text-slate-500">
                      Из прихода без разбивки по конструктивам:{' '}
                      {tierOnly
                        .map(([id, q]) => `${materialById.get(id)?.name ?? id} ${num(q)} ${materialById.get(id)?.unit ?? ''}`)
                        .join('; ')}
                      .
                    </p>
                  ) : null}

                  {t.rows.some((r) => !isHeadline(r.material)) ? (
                    <details>
                      <summary className="cursor-pointer text-sm text-slate-600">Арматура по диаметрам</summary>
                      <div className="mt-2">
                        <RowsTable rows={t.rows} showSku />
                      </div>
                    </details>
                  ) : null}

                  {t.blocks.filter((b) => b.rows.length > 0).length > 0 ? (
                    <details>
                      <summary className="cursor-pointer text-sm text-slate-600">
                        По конструктивам ({t.blocks.filter((b) => b.rows.length > 0).length})
                      </summary>
                      <div className="mt-2 space-y-4">
                        {t.blocks
                          .filter((b) => b.rows.length > 0)
                          .map((b) => (
                            <div key={b.structure.id}>
                              <h3 className="mb-1 text-sm font-medium text-slate-800">{b.structure.name}</h3>
                              <RowsTable rows={b.rows} showSku={false} />
                            </div>
                          ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              )}
            </Card>
          </section>
        );
      })}
    </div>
  );
}
