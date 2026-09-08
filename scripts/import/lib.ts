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
  incoming: number | null;
  remainder: number | null;
  daily: { date: string; quantity: number }[];
}

export interface Mapping {
  object: { code: string; name: string; kind: string };
  sections: { code: string; name: string; parent: string }[];
  structures: {
    code: string;
    parent: string;
    name: string;
    kind: string;
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
    levels?: string[];
    note?: string | string[];
  }[];
  materials: {
    concrete: { code: string; name: string; class: string; deliveryRow: string }[];
    rebarAggregate: { code: string; name: string; deliveryRow: string };
    rebarSkus: { code: string; diameter: number; class: string; deliveryRow: string }[];
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
    concrete: {
      structureCode: string;
      parent: string;
      name: string;
      kind: string;
      level: string;
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
