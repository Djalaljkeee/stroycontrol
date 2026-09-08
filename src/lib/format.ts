export function num(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

/** Крупные суммы читаются на дашборде хуже, чем «5,8 млн ₽». */
export function moneyShort(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн ₽`;
  if (abs >= 1_000) return `${(value / 1_000).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} тыс ₽`;
  return `${Math.round(value)} ₽`;
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

export function coeff(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function signed(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  const s = num(value, digits);
  return value > 0 ? `+${s}` : s;
}

export function date(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : value;
  return d.toLocaleDateString('ru-RU', { timeZone: 'UTC' });
}

export const n = (v: string | number | null | undefined): number =>
  v == null ? 0 : typeof v === 'number' ? v : Number(v);

export const nOrNull = (v: string | number | null | undefined): number | null =>
  v == null ? null : typeof v === 'number' ? v : Number(v);
