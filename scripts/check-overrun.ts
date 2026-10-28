/** Перерасход «приход − проект × К» по блокам — как на «Прогнозе». Только чтение. */
import './env';
import { sql } from '../src/db';
import { buildReport } from '../src/lib/report';
import { buildOverrun, overrunCost } from '../src/lib/overrun';

async function main() {
  const report = await buildReport();
  const lines = buildOverrun(report);
  const f = (v: number | null) => (v == null ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: 3 }));
  for (const l of lines) {
    if (l.overrun <= 0.005 && !process.argv.includes('--all')) continue;
    console.log(
      [l.tier.code, l.structure?.code ?? '(этаж)', l.material.code, f(l.project), f(l.projectWithK), f(l.incoming), f(l.overrun), f(l.cost), l.verdict].join(' | '),
    );
  }
  console.log('Итого, ₽:', f(overrunCost(lines)));
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
