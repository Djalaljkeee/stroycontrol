/** Собирает книгу Excel в файл — проверка выгрузки без запуска приложения. */
import './env';
import { sql } from '../src/db';
import { buildWorkbook } from '../src/lib/export';

async function main() {
  const wb = await buildWorkbook();
  const out = process.argv[2] ?? '/tmp/stroycontrol.xlsx';
  await wb.xlsx.writeFile(out);
  console.log(`Записано: ${out}`);
  for (const sheet of wb.worksheets) {
    console.log(`  «${sheet.name}»: ${sheet.rowCount} строк, ${sheet.columnCount} колонок`);
  }
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end().catch(() => {});
  process.exit(1);
});
