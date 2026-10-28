'use client';

import { useActionState, useState } from 'react';
import { applyKs6a, previewKs6a, type Ks6aPreview } from '@/actions/ks6a';
import { num } from '@/lib/format';

const control = 'rounded border border-slate-300 bg-white px-2 py-1 text-sm';

const monthName = (period: string) =>
  new Date(`${period}T00:00:00Z`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Загрузка заполненной КС-6а: файл → предпросмотр месяца → запись. Строки КС на
 * несколько этажей (колонны, перекрытия, стены КЖ1) нужно отнести к этажу —
 * подсказка берётся из mapping.json, если месяц там уже описан.
 */
export function Ks6aImport() {
  const [preview, parseAction, parsing] = useActionState<Ks6aPreview, FormData>(previewKs6a, {});
  const [result, applyAction, applying] = useActionState<Ks6aPreview, FormData>(applyKs6a, {});
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [document, setDocument] = useState('');

  const sheets = preview.sheets ?? [];
  // Новый файл — сбрасываем выбор на последний лист и его отчётный месяц.
  const sheet = sheets.find((s) => s.name === sheetName) ?? sheets.at(-1);
  const month =
    sheet?.months.find((m) => m.period === period) ??
    sheet?.months.find((m) => m.period === sheet.factThrough) ??
    sheet?.months.at(-1);

  const rowKey = (i: number) => `${sheet?.name}|${month?.period}|${i}`;
  const rows = (month?.rows ?? []).map((r, i) => ({ ...r, target: targets[rowKey(i)] ?? r.defaultTarget ?? '' }));
  const missing = rows.filter((r) => !r.target).length;
  const existing = month ? preview.existing?.[month.period] : undefined;
  const name = (code: string) => preview.names?.[code] ?? code;

  const payload = month
    ? JSON.stringify({
        period: month.period,
        revision: sheet!.revision,
        document: document || `КС-6а ${sheet!.revision}, лист «${sheet!.name}»`,
        rows: rows.map((r) => ({ target: r.target, material: r.material, quantity: r.quantity, design: r.design })),
      })
    : '';

  return (
    <div className="space-y-4">
      <form
        action={(fd) => {
          setSheetName(null);
          setPeriod(null);
          setTargets({});
          parseAction(fd);
        }}
        className="flex flex-wrap items-center gap-3"
      >
        <input
          type="file"
          name="file"
          accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className="text-sm file:mr-3 file:rounded file:border file:border-slate-300 file:bg-white file:px-2.5 file:py-1 file:text-sm hover:file:bg-slate-50"
        />
        <button
          type="submit"
          disabled={parsing}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {parsing ? 'Разбор…' : 'Разобрать файл'}
        </button>
        {preview.error ? <span className="text-sm text-red-700">{preview.error}</span> : null}
      </form>

      {sheet && month ? (
        <div className="space-y-3 rounded border border-slate-200 p-3">
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="block">
              <span className="block text-xs text-slate-600">Лист</span>
              <select className={control} value={sheet.name} onChange={(e) => {
                  setSheetName(e.target.value);
                  setPeriod(null);
                }}>
                {sheets.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({s.revision})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs text-slate-600">Месяц</span>
              <select className={control} value={month.period} onChange={(e) => setPeriod(e.target.value)}>
                {sheet.months.map((m) => (
                  <option key={m.period} value={m.period}>
                    {m.label} — {m.rows.length} строк
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-64 flex-1">
              <span className="block text-xs text-slate-600">Документ</span>
              <input
                className={`${control} w-full`}
                value={document}
                onChange={(e) => setDocument(e.target.value)}
                placeholder={`КС-6а ${sheet.revision}, лист «${sheet.name}»`}
              />
            </label>
          </div>

          {month.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-800">
              {w}
            </p>
          ))}

          <div className="overflow-x-auto">
            <table className="grid-table text-sm">
              <thead>
                <tr>
                  <th>Строка КС-6а</th>
                  <th>Материал</th>
                  <th>Закрыто</th>
                  <th>Объём конструктива, м³</th>
                  <th>Куда</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={rowKey(i)}>
                    <td>
                      <span className="text-slate-400">{r.ks6aCode}</span> {r.ks6aName}
                    </td>
                    <td>{preview.materialNames?.[r.material] ?? r.material}</td>
                    <td>
                      {num(r.quantity)} {r.unit ?? ''}
                    </td>
                    <td>{r.design != null ? num(r.design) : '—'}</td>
                    <td>
                      {r.blocks.length ? (
                        <select
                          className={`${control} ${r.target ? '' : 'border-amber-500'}`}
                          value={r.target}
                          onChange={(e) => setTargets((t) => ({ ...t, [rowKey(i)]: e.target.value }))}
                        >
                          <option value="">выберите этаж</option>
                          {r.blocks.map((b) => (
                            <option key={b.code} value={b.code}>
                              {name(b.code)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        name(r.structureCode)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={applyAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="payload" value={payload} />
            <button
              type="submit"
              disabled={applying || missing > 0 || rows.length === 0}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {applying ? 'Загрузка…' : `Загрузить за ${monthName(month.period)}`}
            </button>
            <span className="text-xs text-slate-500">
              {missing > 0 ? `Выберите этаж ещё для ${missing} строк. ` : ''}
              {existing?.ks6a
                ? `Загруженные раньше за этот месяц ${existing.ks6a} записей КС-6а будут заменены. `
                : ''}
              {existing?.manual ? `${existing.manual} записей ручного ввода останутся — проверьте, не задвоится ли.` : ''}
            </span>
            {result.error ? <span className="text-sm text-red-700">{result.error}</span> : null}
            {result.ok ? <span className="text-sm text-emerald-700">{result.ok}</span> : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}
