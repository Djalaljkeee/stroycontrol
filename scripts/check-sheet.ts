/**
 * Сверка системы с листом «приходы» (data/extracted/deliveries.json): по каждому
 * блоку листа и материалу — проект, проект × К, приход, запроцентовано против
 * того же в системе. Только чтение. CSV — путём из первого аргумента.
 */
import './env';
import { writeFileSync } from 'node:fs';
import { sql } from '../src/db';
import { buildReport, type TierRow } from '../src/lib/report';
import { loadDeliveries, loadMapping, normalizeName, type DeliveryTarget } from './import/lib';

const EPS = 0.01;

async function main() {
  const mapping = loadMapping();
  const sheet = loadDeliveries();
  const report = await buildReport();

  const rowToMaterial = new Map<string, string>();
  for (const c of mapping.materials.concrete) {
    for (const name of [c.deliveryRow, ...(c.aliases ?? [])]) rowToMaterial.set(normalizeName(name), c.code);
  }
  for (const s of mapping.materials.rebarSkus) {
    for (const name of [s.deliveryRow, ...(s.aliases ?? [])]) rowToMaterial.set(normalizeName(name), s.code);
  }
  rowToMaterial.set(normalizeName(mapping.materials.rebarAggregate.deliveryRow), mapping.materials.rebarAggregate.code);
  const headerTarget = new Map(mapping.deliveryBlocks.headers.map((h) => [normalizeName(h.header), h.target]));

  // Цифры системы для цели блока: этаж целиком — итог этажа, захватка — её строка.
  const systemRow = (target: NonNullable<DeliveryTarget>, code: string): TierRow | null => {
    if ('tier' in target) {
      const t = report.byTier.find((x) => x.tier.code === target.tier);
      return t?.rows.find((r) => r.material.code === code) ?? null;
    }
    for (const t of report.byTier) {
      const b = t.blocks.find((x) => x.structure.code === target.structure);
      if (b) return b.rows.find((r) => r.material.code === code) ?? null;
    }
    return null;
  };

  type Line = {
    block: string;
    material: string;
    sheet: { project: number | null; withK: number | null; incoming: number | null; closed: number | null };
    system: { project: number | null; withK: number | null; incoming: number; closed: number; revision: string | null };
  };
  const lines: Line[] = [];
  const merged = new Map<string, Line>();
  let header = 'КЖ0 (сводка до первого заголовка)';
  let target: DeliveryTarget = mapping.deliveryBlocks.initial;
  const sheetIncomingByMaterial = new Map<string, number>();

  for (const row of sheet.rows) {
    const name = normalizeName(row.name);
    if (headerTarget.has(name)) {
      target = headerTarget.get(name)!;
      header = row.name.trim();
      continue;
    }
    const code = rowToMaterial.get(name);
    if (!code || target == null) continue;
    const incoming = row.daily.reduce((a, d) => a + d.quantity, 0);
    if (code !== 'REBAR') sheetIncomingByMaterial.set(code, (sheetIncomingByMaterial.get(code) ?? 0) + incoming);
    if (row.project == null && row.incoming == null && row.closed == null) continue;

    // Несколько строк одного материала в блоке (В25 и «В25(лестница)») — суммируем.
    const key = `${header}|${code}`;
    const sys = systemRow(target, code);
    const prev = merged.get(key);
    const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));
    const line: Line = prev ?? {
      block: header,
      material: code,
      sheet: { project: null, withK: null, incoming: null, closed: null },
      system: {
        project: sys?.project ?? null,
        withK: sys?.projectWithK ?? null,
        incoming: sys?.incoming ?? 0,
        closed: sys?.closed ?? 0,
        revision: sys?.projectRevision ?? null,
      },
    };
    line.sheet.project = add(line.sheet.project, row.project);
    line.sheet.withK = add(line.sheet.withK, row.projectWithK);
    line.sheet.incoming = add(line.sheet.incoming, code === 'REBAR' ? row.incoming : incoming);
    line.sheet.closed = add(line.sheet.closed, row.closed);
    if (!prev) {
      merged.set(key, line);
      lines.push(line);
    }
  }

  const f = (v: number | null) => (v == null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 3 }));
  const d = (a: number | null, b: number | null) =>
    a == null || b == null ? '' : Math.abs(a - b) > EPS ? `Δ${(b - a).toLocaleString('ru-RU', { maximumFractionDigits: 3 })}` : '=';

  console.log('\n=== Блоки листа «приходы» против системы ===');
  console.log('блок | материал | проект лист/сист | ×К лист/сист | приход лист/сист | запроц лист/сист | приход − ×К (лист) | ред.');
  const csv = [
    'block;material;sheet_project;sys_project;sheet_withK;sys_withK;sheet_incoming;sys_incoming;sheet_closed;sys_closed;sheet_over;sys_revision',
  ];
  for (const l of lines) {
    const over = l.sheet.incoming != null && l.sheet.withK != null ? l.sheet.incoming - l.sheet.withK : null;
    console.log(
      [
        l.block.slice(0, 40),
        l.material,
        `${f(l.sheet.project)} / ${f(l.system.project)} ${d(l.sheet.project, l.system.project)}`,
        `${f(l.sheet.withK)} / ${f(l.system.withK)} ${d(l.sheet.withK, l.system.withK)}`,
        `${f(l.sheet.incoming)} / ${f(l.system.incoming)} ${d(l.sheet.incoming ?? 0, l.system.incoming)}`,
        `${f(l.sheet.closed)} / ${f(l.system.closed)} ${d(l.sheet.closed ?? 0, l.system.closed)}`,
        over == null ? '' : over > EPS ? `ПЕРЕРАСХОД ${f(over)}` : `в норме ${f(over)}`,
        l.system.revision ?? '',
      ].join(' | '),
    );
    csv.push(
      [
        l.block, l.material, l.sheet.project, l.system.project, l.sheet.withK, l.system.withK,
        l.sheet.incoming, l.system.incoming, l.sheet.closed, l.system.closed, over, l.system.revision,
      ].map((v) => (v == null ? '' : String(v))).join(';'),
    );
  }

  console.log('\n=== Приход по материалам: сумма листа против всех поставок в БД ===');
  const dbRows = await sql<{ code: string; source: string; total: string }[]>`
    select m.code, d.source, sum(d.quantity)::text as total
    from deliveries d join materials m on m.id = d.material_id group by 1, 2`;
  const corrections = new Map<string, number>();
  for (const c of mapping.deliveryBlocks.corrections ?? []) corrections.set(c.material, (corrections.get(c.material) ?? 0) + c.quantity);
  const codes = new Set([...sheetIncomingByMaterial.keys(), ...dbRows.map((r) => r.code)]);
  for (const code of [...codes].sort()) {
    const inSheet = sheetIncomingByMaterial.get(code) ?? 0;
    const imported = dbRows.filter((r) => r.code === code && r.source === 'prihody').reduce((a, r) => a + Number(r.total), 0);
    const manual = dbRows.filter((r) => r.code === code && r.source !== 'prihody').reduce((a, r) => a + Number(r.total), 0);
    const corr = corrections.get(code) ?? 0;
    const delta = imported - corr - inSheet;
    console.log(
      `${code.padEnd(15)} лист ${f(inSheet).padStart(10)} | импорт ${f(imported).padStart(10)} (корректировки ${f(corr)}) | ручной ввод ${f(manual)} | ${Math.abs(delta) > EPS ? `Δ ${f(delta)}` : 'сходится'}`,
    );
  }

  if (process.argv[2]) writeFileSync(process.argv[2], csv.join('\n'));
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
