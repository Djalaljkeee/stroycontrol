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

  it('приход сходится с листом «приходы»', () => {
    expect(cell('CONCRETE_B30').balance.incoming).toBeCloseTo(2385.5, 2);
    expect(cell('REBAR').balance.incoming).toBeCloseTo(384.91, 2);
  });

  it('списание бетона В30 равно закрытому объёму КС-6а', () => {
    // 1118,2 плита + 25,41 колонны + 131,5 стены ЛК/ЛШ.
    expect(cell('CONCRETE_B30').balance.consumed).toBeCloseTo(1275.11, 2);
  });

  it('неподтверждённый расход В30 — тот самый разрыв в 1110 м³', () => {
    expect(cell('CONCRETE_B30').balance.unconfirmed).toBeCloseTo(1110.39, 2);
  });

  it('арматура: 205 т числится на складе без привязки к конструктивам', () => {
    const rebar = cell('REBAR');
    expect(rebar.balance.consumed).toBeCloseTo(179.96, 2);
    expect(rebar.balance.stock).toBeCloseTo(204.95, 2);
    // У арматуры есть склад, поэтому неподтверждённого расхода быть не может.
    expect(rebar.balance.unconfirmed).toBe(0);
  });

  it('фактический коэффициент расхода бетона совпал с нормативным 1,05', () => {
    expect(cell('CONCRETE_B30').forecast.kActual).toBeCloseTo(1.05, 3);
    expect(cell('CONCRETE_B25').forecast.kActual).toBeCloseTo(1.05, 3);
  });

  it('сметный лимит переезжает вслед за сменой класса, а сумма сохраняется', () => {
    // Плита ЛПК: 1736 м³ записаны в ресурсной как В25, по ДС3 заливаются В30.
    expect(cell('CONCRETE_B30').estimateOriginal).toBeCloseTo(7661.4, 1);
    expect(cell('CONCRETE_B30').estimatePurchase).toBeCloseTo(9397.4, 1);
    expect(cell('CONCRETE_B25').estimateOriginal).toBeCloseTo(2120.7, 1);
    expect(cell('CONCRETE_B25').estimatePurchase).toBeCloseTo(384.7, 1);

    // Итог по всем классам не меняется ни в одном разрезе.
    const concrete = report.totals.filter((c) => c.material.kind === 'concrete');
    const original = concrete.reduce((a, c) => a + (c.estimateOriginal ?? 0), 0);
    const effective = concrete.reduce((a, c) => a + (c.estimatePurchase ?? 0), 0);
    expect(original).toBeCloseTo(10125.3, 1);
    expect(effective).toBeCloseTo(10125.3, 1);
  });

  it('прогноз по В30 ложится на переехавший лимит', () => {
    const b30 = cell('CONCRETE_B30');
    expect(b30.forecast.total).toBeCloseTo(9396.09, 1);
    expect(b30.forecast.overrunVsEstimate!).toBeCloseTo(-1.31, 1);
  });

  it('проектная база берётся из КЖ только на своей отметке', () => {
    const columns = report.structures.find((s) => s.code === '3.2-columns')!;
    const level = report.structures.find((s) => s.code === '3.2-columns-L-0.080')!;

    // У конструктива целиком — договорная база 854,4 м³, а не 79,44 из КЖ.
    const parent = report.byStructure
      .get(columns.id)!
      .cells.find((c) => c.material.code === 'CONCRETE_B30')!;
    expect(parent.base?.source).toBe('contract');
    expect(parent.basePurchase).toBeCloseTo(854.4, 1);

    // На отметке — проектная база из ведомости КЖ1-01: 75,66 × 1,05.
    const child = report.byStructure
      .get(level.id)!
      .cells.find((c) => c.material.code === 'CONCRETE_B30')!;
    expect(child.base?.source).toBe('project');
    expect(child.base?.isEstimated).toBe(false);
    expect(child.basePurchase).toBeCloseTo(79.443, 2);
  });

  it('конфликт класса между КЖ и ДС обнаружен и только один', () => {
    expect(report.classConflicts).toHaveLength(1);
    expect(report.classConflicts[0].structureCode).toBe('3.2-walls-L-0.080');
    expect(report.classConflicts[0].projectMaterial).toContain('В25');
    expect(report.classConflicts[0].contractMaterial).toContain('В30');
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
