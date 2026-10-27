import { date, money, num } from '@/lib/format';
import { STATUS_LABELS, type ProtectionRow, type ProtectionStatus } from '@/lib/protection';

const STATUS_STYLE: Record<ProtectionStatus, string> = {
  not_started: 'bg-slate-100 text-slate-500 ring-slate-200',
  in_work: 'bg-sky-50 text-sky-800 ring-sky-200',
  pending: 'bg-amber-50 text-amber-900 ring-amber-200',
  overdue: 'bg-red-50 text-red-800 ring-red-200',
  closed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
};

export function ProtectionBadge({ status, days }: { status: ProtectionStatus; days?: number }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs ring ${STATUS_STYLE[status]}`}>
      {STATUS_LABELS[status]}
      {status === 'overdue' && days ? ` · ${days} дн` : ''}
    </span>
  );
}

/** Таблица конструктивов: проект → выполнено → защищено. */
export function ProtectionTable({ rows, showMoney }: { rows: ProtectionRow[]; showMoney: boolean }) {
  return (
    <table className="grid-table text-sm">
      <thead>
        <tr>
          <th>Конструктив</th>
          <th>Бетон</th>
          <th title="Конструктивный объём по КЖ, без КЖ — по договору">Проект, м³</th>
          <th>Выполнено</th>
          <th>Защищено</th>
          <th title="Залито, но не закрыто процентовкой">Ждёт защиты</th>
          {showMoney ? <th title="По договорной цене поставки с К 1,05">Не предъявлено</th> : null}
          <th>Выполнен</th>
          <th>Закрыт</th>
          <th title="Дней от окончания выполнения до закрытия">Срок защиты</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.structureId}:${r.materialId}`}>
            <td>
              {r.structureName}
              {r.parentName ? <span className="ml-1.5 text-xs text-slate-400">{r.parentName}</span> : null}
            </td>
            <td>{r.materialName.replace('Бетон ', '')}</td>
            <td>
              {num(r.project)}
              {r.projectSource === 'contract' ? (
                <span className="ml-1 text-xs text-slate-400" title="Рабочей документации нет — объём по договору">
                  дог.
                </span>
              ) : null}
            </td>
            <td>{r.executed > 0 ? num(r.executed) : '—'}</td>
            <td>{r.closed > 0 ? num(r.closed) : '—'}</td>
            <td className={r.unclosed > 0.01 ? 'font-medium text-amber-800' : undefined}>
              {r.unclosed > 0.01 ? num(r.unclosed) : '—'}
            </td>
            {showMoney ? <td>{r.unclosed > 0.01 ? money(r.unclosedValue) : '—'}</td> : null}
            <td>{date(r.finishedAt)}</td>
            <td>{date(r.closedAt)}</td>
            <td>{r.protectionDays != null ? `${r.protectionDays} дн` : '—'}</td>
            <td>
              <ProtectionBadge status={r.status} days={r.overdueDays} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
