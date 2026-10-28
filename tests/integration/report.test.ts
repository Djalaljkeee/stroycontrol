/**
 * Проверка сквозного расчёта на данных объекта.
 *
 * Работает на отдельной базе <имя>_test, которая создаётся заново и наполняется
 * миграциями и импортом: числа здесь точные, и на рабочей базе тесты ломал бы
 * любой введённый прорабом приход. Нужен только поднятый Postgres
 * (`npm run db:up`); без DATABASE_URL тесты пропускаются.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { dropTestDatabase, prepareTestDatabase } from './setup-db';
import { buildOverrun } from '@/lib/overrun';

if (existsSync('.env')) process.loadEnvFile('.env');

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('отчёт на данных объекта', () => {
  let report: Awaited<ReturnType<typeof import('@/lib/report').buildReport>>;
  let sql: (typeof import('@/db'))['sql'];
  let testUrl: string | null = null;

  beforeAll(async () => {
    testUrl = await prepareTestDatabase();
    if (!testUrl) return;
    // Модуль @/db читает DATABASE_URL при загрузке, поэтому переменную нужно
    // подменить до первого импорта.
    process.env.DATABASE_URL = testUrl;

    const dbModule = await import('@/db');
    sql = dbModule.sql;
    const { buildReport } = await import('@/lib/report');
    report = await buildReport();
  }, 120_000);

  afterAll(async () => {
    await sql?.end().catch(() => {});
    if (testUrl) await dropTestDatabase(testUrl).catch(() => {});
  });

  const cell = (code: string) => {
    const c = report.totals.find((x) => x.material.code === code);
    if (!c) throw new Error(`Нет позиции ${code} в сводке`);
    return c;
  };

  const structure = (code: string) => {
    const s = report.structures.find((x) => x.code === code);
    if (!s) throw new Error(`Нет конструктива ${code}`);
    return s;
  };
  const structureCell = (code: string, material: string) => {
    const c = report.byStructure.get(structure(code).id)!.cells.find((x) => x.material.code === material);
    if (!c) throw new Error(`Нет позиции ${material} у ${code}`);
    return c;
  };
  const tierRow = (tier: string, material: string) => {
    const t = report.byTier.find((x) => x.tier.code === tier);
    if (!t) throw new Error(`Нет яруса ${tier}`);
    return t.rows.find((r) => r.material.code === material);
  };

  it('приход сходится с листом «приходы» от 27.10', () => {
    expect(cell('CONCRETE_B30').balance.incoming).toBeCloseTo(3596.2, 2);
    expect(cell('CONCRETE_B25').balance.incoming).toBeCloseTo(642.4, 2);
    expect(cell('REBAR').balance.incoming).toBeCloseTo(716.69, 2);
  });

  it('перерасход — приход − проект × К по блокам листа', () => {
    const lines = buildOverrun(report);
    const line = (tier: string, structure: string | null, code: string) =>
      lines.find(
        (l) => l.tier.code === tier && (l.structure?.code ?? null) === structure && l.material.code === code,
      );
    // Те же цифры, что в колонках листа; колонны — по проекту КЖ1 изм. 8.
    expect(line('KJ0', null, 'CONCRETE_B7_5')!.overrun).toBeCloseTo(57.125, 3);
    expect(line('KJ0', null, 'CONCRETE_B30')!.verdict).toBe('ok');
    expect(line('KJ0', '3.2-stairs-KJ0', 'CONCRETE_B25')!.overrun).toBeCloseTo(0.255, 3);
    expect(line('T3', '3.2-columns-T3', 'REBAR_32_A500')!.overrun).toBeCloseTo(25.148 - 18.196 * 1.1, 2);
    expect(line('T4', '3.2-walls-kj1-T4', 'REBAR_8_A240')!.overrun).toBeCloseTo(2.8 - 1.7417 * 1.1, 2);
  });

  it('весь приход разнесён на ярус или конструктив', () => {
    expect([...report.unallocatedIncoming.values()].every((q) => Math.abs(q) < 1e-6)).toBe(true);
  });

  it('запроцентовано — сумма помесячных объёмов КС-6а по ДС5', () => {
    expect(cell('CONCRETE_B30').closed).toBeCloseTo(3076.03, 2);
    expect(cell('CONCRETE_B25').closed).toBeCloseTo(402.4, 2);
    expect(cell('REBAR').closed).toBeCloseTo(470.83, 2);
  });

  it('бетон без склада: приход минус расход может уйти в минус', () => {
    // На ярусах КЖ0 и 1 расход считается по процентовке, а закрыто там больше,
    // чем привезено по листу: −103 м³ В30.
    expect(cell('CONCRETE_B30').balance.unconfirmed).toBeCloseTo(-103.03, 2);
    expect(cell('CONCRETE_B30').balance.stock).toBe(0);
  });

  it('арматура: склад — разница прихода и расхода', () => {
    const rebar = cell('REBAR');
    expect(rebar.balance.consumed).toBeCloseTo(755.55, 2);
    expect(rebar.balance.stock).toBeCloseTo(-38.86, 2);
    expect(rebar.balance.unconfirmed).toBe(0);
  });

  it('прогноз не учитывает привезённое под ещё не закрытые захватки', () => {
    // 623,2 м³ В30 разнесено на ярусы 2–3, выполнения по ним ещё нет.
    expect(cell('CONCRETE_B30').inProgress).toBeCloseTo(623.2, 1);
    expect(cell('CONCRETE_B30').forecast.kActual).toBeCloseTo(1.05, 3);
  });

  it('сметный лимит делится между классами по ДС, а итог сохраняется', () => {
    expect(cell('CONCRETE_B30').estimateOriginal).toBeCloseTo(7661.4, 1);
    expect(cell('CONCRETE_B30').estimatePurchase).toBeCloseTo(7884.21, 1);
    expect(cell('CONCRETE_B25').estimateOriginal).toBeCloseTo(2120.7, 1);
    expect(cell('CONCRETE_B25').estimatePurchase).toBeCloseTo(1897.89, 1);

    const concrete = report.totals.filter((c) => c.material.kind === 'concrete');
    const original = concrete.reduce((a, c) => a + (c.estimateOriginal ?? 0), 0);
    const effective = concrete.reduce((a, c) => a + (c.estimatePurchase ?? 0), 0);
    expect(original).toBeCloseTo(10125.3, 1);
    expect(effective).toBeCloseTo(10125.3, 1);
  });

  it('ДС5 развёл стены на КЖ0 (В30) и КЖ1 (В25)', () => {
    expect(structureCell('3.2-walls-kj0', 'CONCRETE_B30').basePurchase).toBeCloseTo(296.78, 2);
    expect(structureCell('3.2-walls-kj1', 'CONCRETE_B25').basePurchase).toBeCloseTo(1980, 2);
    // Конфликт класса КЖ1-01 / ДС3 по стенам на −0,080 снят.
    expect(report.classConflicts).toHaveLength(0);
  });

  it('проектная база берётся из КЖ1 изм. 8 на захватке яруса', () => {
    const parent = structureCell('3.2-columns', 'CONCRETE_B30');
    expect(parent.base?.source).toBe('contract');
    expect(parent.basePurchase).toBeCloseTo(854.4, 1);

    const child = structureCell('3.2-columns-T1', 'CONCRETE_B30');
    expect(child.base?.source).toBe('project');
    expect(child.base?.revision).toBe('КЖ1 изм. 8');
    expect(child.basePurchase).toBeCloseTo(74.14 * 1.05, 3);
  });

  it('разрез по ярусам повторяет лист «приходы»', () => {
    // КЖ0: проект с листа целиком на ярус.
    expect(tierRow('KJ0', 'CONCRETE_B30')?.project).toBeCloseTo(2364.95, 2);
    expect(tierRow('KJ0', 'CONCRETE_B30')?.incoming).toBeCloseTo(2339.5, 2);
    // Ярус 2: сумма захваток изм. 8 — колонны 74,14 + плита 488,45.
    expect(tierRow('T2', 'CONCRETE_B30')?.project).toBeCloseTo(562.59, 2);
    expect(tierRow('T2', 'CONCRETE_B30')?.incoming).toBeCloseTo(586.3, 2);
    // Закрыто на ярус 1 в октябре: колонны 77,85 + плита 530,87.
    expect(tierRow('T1', 'CONCRETE_B30')?.closed).toBeCloseTo(608.72, 2);
  });

  it('удельное армирование плиты правдоподобно', () => {
    const slab = report.structures.find((s) => s.code === '3.1-slab')!;
    const rebar = report.byStructure
      .get(slab.id)!
      .cells.find((c) => c.material.code === 'REBAR')!;
    // 148 т на 1065 м³ залитой плиты — около 139 кг/м³.
    expect(rebar.specificKgPerM3!).toBeGreaterThan(100);
    expect(rebar.specificKgPerM3!).toBeLessThan(200);
  });
});
