import { readFileSync } from 'node:fs';

export interface Ks6aRow {
  row: number;
  code: string | null;
  name: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  total: number | null;
  monthly: { month: string; volume: number }[];
  remainder: number | null;
}

export interface Ks6aSheet {
  months: string[];
  rows: Ks6aRow[];
}

export interface ResourceRow {
  row: number;
  code: string | null;
  work: string | null;
  workUnit: string | null;
  workQuantity: number | null;
  resource: string | null;
  resourceUnit: string | null;
  norm: number | null;
  resourceQuantity: number | null;
  resourcePrice: number | null;
  matrix: Record<string, number>;
}

export interface DeliveryRow {
  row: number;
  name: string;
  estimate: number | null;
  project: number | null;
  projectWithK: number | null;
  /** Колонка «Приход» — по формуле листа сумма дневных значений строки. */
  incoming: number | null;
  /** Колонка «Запроцентовано». */
  closed: number | null;
  daily: { date: string; quantity: number }[];
}

export interface TierSpec {
  code: string;
  name: string;
  stage: string;
  levelFrom: string | null;
  levelTo: string | null;
  consumptionFromClosings?: boolean;
}

/** Куда ложится приход блока листа «приходы»: на захватку или на ярус целиком. */
export type DeliveryTarget = { structure: string } | { tier: string } | null;

export interface Mapping {
  object: { code: string; name: string; kind: string };
  sections: { code: string; name: string; parent: string }[];
  tiers: TierSpec[];
  structures: {
    code: string;
    parent: string;
    name: string;
    kind: string;
    tier?: string;
    /** Редакции ДС, в которых строка существует; без поля — во всех. */
    revisions?: string[];
    workCodes: string[];
    supply: {
      material: string;
      code: string;
      /** Тот же конструктив в нумерации ресурсной, с классом бетона по смете. */
      estimate?: { material: string; code: string };
      /** Класс бетона, под которым конструктив проходил в конкретной редакции ДС. */
      materialByRevision?: Record<string, string>;
    }[];
    workCodesResource?: string[];
    /** Захватки по ярусам для строк КС-6а на несколько этажей. */
    blocks?: { code: string; tier: string; name: string; level?: string }[];
    /** Месяц КС-6а (последний день) → захватка, на которую ложится закрытый объём. */
    closingBlocks?: Record<string, string>;
    note?: string | string[];
  }[];
  materials: {
    concrete: { code: string; name: string; class: string; deliveryRow: string; aliases?: string[] }[];
    rebarAggregate: { code: string; name: string; deliveryRow: string };
    rebarSkus: {
      code: string;
      diameter: number;
      class: string;
      deliveryRow: string;
      aliases?: string[];
    }[];
  };
  deliveryBlocks: {
    initial: DeliveryTarget;
    headers: { header: string; target: DeliveryTarget }[];
    /** Поставки, которых в листе нет, но которые подтверждены прошлой версией листа или КС-6а. */
    corrections?: { date: string; material: string; quantity: number; target: DeliveryTarget; note: string }[];
  };
  revisions: {
    sheets: { sheet: string; revision: string; effectiveFrom: string; factThrough: string }[];
    current: string;
  };
}

export interface KjSheets {
  sheets: {
    revision: string;
    issuedAt: string;
    /** База на ярус целиком, когда проект не разложен по конструктивам (м3 / т). */
    tierLevel?: { tier: string; material: string; design: number }[];
    concrete: {
      structureCode: string;
      material: string;
      designM3: number;
    }[];
    steel: {
      byStructure: {
        structureCode: string;
        byDiameter: { material: string; kg: number }[];
        totalKg: number;
      }[];
    };
  }[];
}

const json = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

export const loadKs6a = () => json<Record<string, Ks6aSheet>>('data/extracted/ks6a.json');
export const loadResource = () => json<{ rows: ResourceRow[] }>('data/extracted/resource.json');
export const loadDeliveries = () =>
  json<{ dates: string[]; rows: DeliveryRow[] }>('data/extracted/deliveries.json');
export const loadMapping = () => json<Mapping>('data/mapping.json');
export const loadKj = () => json<KjSheets>('data/kj-baselines.json');

/** Месяц КС-6а («август, 2026») → последний день месяца, чтобы сравнивать с factThrough. */
const MONTHS: Record<string, number> = {
  январь: 1, февраль: 2, март: 3, апрель: 4, май: 5, июнь: 6,
  июль: 7, август: 8, сентябрь: 9, октябрь: 10, ноябрь: 11, декабрь: 12,
};

export function monthToDate(label: string): string | null {
  const m = /^([а-яё]+),\s*(\d{4})$/i.exec(label.trim());
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const year = Number(m[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/** Помесячные объёмы КС-6а делятся на факт и план по дате закрытия листа. */
export function splitFactAndPlan(
  monthly: { month: string; volume: number }[],
  factThrough: string,
): { fact: { month: string; date: string; volume: number }[]; plan: number } {
  const fact: { month: string; date: string; volume: number }[] = [];
  let plan = 0;
  for (const m of monthly) {
    const date = monthToDate(m.month);
    if (date && date <= factThrough) fact.push({ month: m.month, date, volume: m.volume });
    else plan += m.volume;
  }
  return { fact, plan };
}

/**
 * Строка КС-6а по ссылке из mapping.json. Обычно ссылка — просто код ('3.2.8.'),
 * но в ДС5 коды стен повторяются для КЖ0 и КЖ1, и тогда к коду добавляется
 * фрагмент наименования: '3.2.8.#КЖ1'. Неоднозначная ссылка — ошибка маппинга,
 * а не повод взять первую попавшуюся строку.
 */
export function findKs6aRow(rows: Ks6aRow[], ref: string): Ks6aRow | null {
  const [code, marker] = ref.split('#');
  const matches = rows.filter(
    (r) => r.code?.trim() === code && (marker == null || r.name.includes(marker)),
  );
  if (matches.length > 1) {
    throw new Error(`Строка КС-6а «${ref}» неоднозначна: ${matches.length} совпадения, уточните метку`);
  }
  return matches[0] ?? null;
}

/** Наименования на листе «приходы» пишутся с лишними пробелами: «КЖ1 от  +11,920 ( Плита)». */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}

export function round(value: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function fmt(value: number | null, digits = 2): string {
  if (value == null) return '—';
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
