// Загрузка заполненной КС-6а из Excel: разбор листов и раскладка закрытого за
// месяц объёма по конструктивам — по тем же правилам mapping.json, что и import:all
// (шаг 5). Без обращений к БД: идентификаторы подставляет серверное действие.
import * as XLSX from 'xlsx';
import mappingJson from '../../data/mapping.json';
import { findKs6aRow, monthToDate, type Ks6aRow, type Ks6aSheet, type Mapping } from '../../scripts/import/lib';
import { K_CONCRETE } from '@/domain/norms';

const mapping = mappingJson as unknown as Mapping;

export interface ParsedSheet extends Ks6aSheet {
  name: string;
}

type Cell = string | number | null;

function cellValue(ws: XLSX.WorkSheet, r: number, c: number): Cell {
  const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  if (!cell || cell.v == null) return null;
  if (typeof cell.v === 'number') return cell.v;
  const s = String(cell.v).trim();
  return s === '' ? null : s;
}

/** Числа в КС местами записаны текстом: '1 736', '80,1'. */
function num(v: Cell): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const n = Number(v.replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const str = (v: Cell) => (v == null ? null : String(v).trim() || null);

/**
 * Листы с таблицей КС-6а: шапка «№ п/п» в первой колонке, под ней строка
 * «объем / стоимость», затем данные. Пара колонок на месяц начинается с H.
 * Титульные листы формы («стр1», «стр2») пропускаются.
 */
export function parseKs6aWorkbook(data: ArrayBuffer | Buffer): ParsedSheet[] {
  const wb = XLSX.read(data, { type: Buffer.isBuffer(data) ? 'buffer' : 'array' });
  const out: ParsedSheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws?.['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    let header = -1;
    for (let r = 0; r <= Math.min(range.e.r, 15); r++) {
      if (str(cellValue(ws, r, 0)) === '№ п/п') {
        header = r;
        break;
      }
    }
    if (header < 0 || range.e.c < 9) continue;

    const months: { label: string; col: number }[] = [];
    for (let c = 7; c <= range.e.c; c += 2) {
      const label = str(cellValue(ws, header, c));
      if (label && label !== 'Остаток' && monthToDate(label)) months.push({ label, col: c });
    }
    const rows: Ks6aRow[] = [];
    for (let r = header + 2; r <= range.e.r; r++) {
      const rowName = str(cellValue(ws, r, 2));
      if (!rowName) continue;
      const monthly: Ks6aRow['monthly'] = [];
      for (const m of months) {
        const v = num(cellValue(ws, r, m.col));
        if (v) monthly.push({ month: m.label, volume: v });
      }
      rows.push({
        row: r,
        code: str(cellValue(ws, r, 1)),
        name: rowName,
        unit: str(cellValue(ws, r, 3)),
        quantity: num(cellValue(ws, r, 4)),
        unitPrice: num(cellValue(ws, r, 5)),
        total: num(cellValue(ws, r, 6)),
        monthly,
        remainder: null,
      });
    }
    out.push({ name, months: months.map((m) => m.label), rows });
  }
  return out;
}

/**
 * Редакция ДС и дата, по которую объёмы — факт. Известные листы берутся из
 * mapping.json; у нового листа то и другое читается из имени «31.10.2026 по ДС5».
 * Неизвестная редакция считается текущей: состав строк берётся от неё.
 */
export function sheetMeta(name: string): { revision: string; factThrough: string | null } {
  const known = mapping.revisions.sheets.find((s) => s.sheet === name);
  if (known) return { revision: known.revision, factThrough: known.factThrough };
  const ds = /ДС\s*\d+/i.exec(name)?.[0].replace(/\s/g, '').toUpperCase();
  const d = /(\d{2})\.(\d{2})\.(\d{4})/.exec(name);
  const revisions = mapping.revisions.sheets.map((s) => s.revision);
  return {
    revision: ds && revisions.includes(ds) ? ds : mapping.revisions.current,
    factThrough: d ? `${d[3]}-${d[2]}-${d[1]}` : null,
  };
}

export interface PlannedRow {
  /** Строка КС-6а поставки. */
  ks6aCode: string;
  ks6aName: string;
  unit: string | null;
  /** Строка договора (конструктив mapping.json). */
  structureCode: string;
  /** Захватки этажей, если строка КС на несколько этажей, — выбирается одна. */
  blocks: { code: string; name: string }[];
  /** Захватка из closingBlocks или сам конструктив, если блоков нет. */
  defaultTarget: string | null;
  material: string;
  quantity: number;
  /** Объём конструктива по строке работ, м³; у арматуры нет. */
  design: number | null;
}

export interface PlannedMonth {
  period: string;
  label: string;
  rows: PlannedRow[];
  warnings: string[];
}

/** Что закрыто в каждом месяце листа, разложенное по конструктивам. */
export function planSheet(sheet: Ks6aSheet, revision: string, factThrough: string | null): PlannedMonth[] {
  const months = sheet.months
    .map((label) => ({ label, period: monthToDate(label)! }))
    .filter((m) => factThrough == null || m.period <= factThrough);
  const used = new Set<number>();
  const result: PlannedMonth[] = months.map((m) => ({ ...m, rows: [], warnings: [] }));
  const byPeriod = new Map(result.map((m) => [m.period, m]));
  const generalWarnings: string[] = [];

  const find = (ref: string): Ks6aRow | null => {
    try {
      return findKs6aRow(sheet.rows, ref);
    } catch (e) {
      generalWarnings.push((e as Error).message);
      return null;
    }
  };
  const volumeIn = (row: Ks6aRow, label: string) => row.monthly.find((x) => x.month === label)?.volume ?? 0;

  for (const s of mapping.structures) {
    if (s.revisions && !s.revisions.includes(revision)) continue;
    const workRows = s.workCodes.map(find).filter((r): r is Ks6aRow => r != null);
    for (const r of workRows) used.add(r.row);

    for (const sup of s.supply) {
      const row = find(sup.code);
      if (!row) continue;
      used.add(row.row);
      const material = sup.materialByRevision?.[revision] ?? sup.material;
      for (const m of months) {
        const quantity = volumeIn(row, m.label);
        if (!quantity) continue;
        const workVolume = workRows.reduce((acc, r) => acc + volumeIn(r, m.label), 0);
        const design =
          material === 'REBAR' ? null : workRows.length === 0 ? quantity / K_CONCRETE : workVolume || null;
        const blocks = (s.blocks ?? []).map((b) => ({ code: b.code, name: b.name }));
        byPeriod.get(m.period)!.rows.push({
          ks6aCode: row.code ?? '',
          ks6aName: row.name,
          unit: row.unit,
          structureCode: s.code,
          blocks,
          defaultTarget: blocks.length ? (s.closingBlocks?.[m.period] ?? null) : s.code,
          material,
          quantity,
          design,
        });
      }
    }
  }

  // Строки поставки бетона и арматуры с объёмом, которых нет в mapping.json, —
  // значит, в ДС появилась новая строка, и её нужно описать, иначе объём потеряется.
  for (const row of sheet.rows) {
    if (used.has(row.row) || !/^Поставка (бетона|арматуры)/i.test(row.name)) continue;
    for (const m of months) {
      if (volumeIn(row, m.label)) {
        byPeriod
          .get(m.period)!
          .warnings.push(`Строка ${row.code ?? ''} «${row.name}» не сопоставлена конструктиву — не загрузится`);
      }
    }
  }
  for (const m of result) m.warnings.unshift(...generalWarnings);
  return result.filter((m) => m.rows.length > 0 || m.warnings.length > 0);
}
