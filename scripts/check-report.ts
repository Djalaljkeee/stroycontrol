/** Печатает остаточную таблицу в терминал — быстрая проверка расчётов без UI. */
import './env';
import { sql } from '../src/db';
import { buildReport } from '../src/lib/report';
import { num, coeff, percent, moneyShort } from '../src/lib/format';

async function main() {
  const report = await buildReport();

  console.log('\n=== ОСТАТОЧНАЯ ТАБЛИЦА (объект целиком) ===\n');
  const head = [
    'Материал'.padEnd(24), 'Ед'.padEnd(4), 'Смета'.padStart(10), 'Проект'.padStart(10),
    'Приход'.padStart(10), 'Списано'.padStart(10), 'Склад'.padStart(10),
    'Неподтв'.padStart(10), 'К_норм'.padStart(7), 'К_факт'.padStart(7),
    'Прогноз'.padStart(10), 'Перерасх'.padStart(10), 'Статус'.padStart(9),
  ].join(' ');
  console.log(head);
  console.log('-'.repeat(head.length));

  for (const c of report.totals) {
    if (c.material.isAggregate && c.balance.incoming === 0 && c.baseDesign == null) continue;
    console.log([
      c.material.name.slice(0, 24).padEnd(24),
      c.material.unit.padEnd(4),
      num(c.estimatePurchase).padStart(10),
      num(c.projectPurchase).padStart(10),
      num(c.balance.incoming).padStart(10),
      num(c.balance.consumed).padStart(10),
      num(c.balance.stock).padStart(10),
      num(c.balance.unconfirmed).padStart(10),
      coeff(c.k).padStart(7),
      coeff(c.forecast.kActual).padStart(7),
      num(c.forecast.total).padStart(10),
      num(c.forecast.overrunVsEstimate).padStart(10),
      c.forecast.verdict.padStart(9),
    ].join(' '));
  }

  console.log('\n=== ПО КОНСТРУКТИВАМ (бетон и агрегат арматуры) ===\n');
  for (const s of report.structures) {
    const r = report.byStructure.get(s.id)!;
    const rows = r.cells.filter(
      (c) => c.material.kind === 'concrete' || c.material.isAggregate,
    );
    if (rows.length === 0) continue;
    console.log(
      `${'  '.repeat(s.depth)}${s.code} — ${s.name}` +
        (r.concreteProgress != null ? `  [выполнено ${percent(r.concreteProgress)}]` : ''),
    );
    for (const c of rows) {
      if (c.baseDesign == null && c.balance.incoming === 0 && c.balance.consumed === 0) continue;
      console.log(
        `${'  '.repeat(s.depth)}    ${c.material.name.padEnd(24)} ` +
          `база ${num(c.basePurchase).padStart(10)} ${c.material.unit} (${c.base?.source ?? '—'}/${c.base?.revision ?? '—'})` +
          `  списано ${num(c.balance.consumed).padStart(9)}` +
          `  К_факт ${coeff(c.forecast.kActual)}` +
          `  прогноз ${num(c.forecast.total).padStart(10)}` +
          `  перерасход ${num(c.forecast.overrunVsEstimate).padStart(9)} / ${moneyShort(c.forecast.overrunCost)}` +
          `  ${c.forecast.verdict}`,
      );
    }
  }

  if (report.classConflicts.length > 0) {
    console.log('\n=== КОНФЛИКТЫ КЛАССА БЕТОНА (проект против ДС) ===\n');
    for (const c of report.classConflicts) {
      console.log(
        `  ${c.structureCode} «${c.structureName}»: ${c.revision} задаёт ${c.projectMaterial}, ` +
          `а ${c.parentCode} закупает ${c.contractMaterial}`,
      );
    }
  }

  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end().catch(() => {});
  process.exit(1);
});
