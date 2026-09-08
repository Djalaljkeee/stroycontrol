import { describe, it, expect } from 'vitest';
import { computeBalance } from '@/domain/balance';
import { computeForecast, verdictFor, PRELIMINARY_PROGRESS } from '@/domain/forecast';
import { K_CONCRETE, K_REBAR } from '@/domain/norms';

const CONCRETE_B30_COST = 7823; // ₽/м3 по ресурсной
const REBAR_COST = 54000; // ₽/т по ресурсной

describe('прогноз расхода бетона', () => {
  it('колонны ЛПК: К_факт 1,05, перерасхода не прогнозируется', () => {
    const balance = computeBalance({
      materialKind: 'concrete',
      deliveries: [{ quantity: 25.41, pourId: 1 }],
      issues: [],
    });
    const f = computeForecast({
      baseDesign: 813.75,
      completedDesign: 24.2,
      estimatePurchase: 854.4,
      k: K_CONCRETE,
      balance,
      unitCost: CONCRETE_B30_COST,
    });

    expect(f.kActual).toBeCloseTo(1.05, 4);
    expect(f.verdict).toBe('ok');
    // 25,41 + (813,75 − 24,2) × 1,05 = 854,4 — ровно сметный лимит.
    expect(f.total).toBeCloseTo(854.4, 1);
    expect(f.overrunVsEstimate).toBeCloseTo(0, 1);
  });

  it('при выполнении 3% прогноз помечается предварительным', () => {
    const balance = computeBalance({
      materialKind: 'concrete',
      deliveries: [{ quantity: 25.41, pourId: 1 }],
      issues: [],
    });
    const f = computeForecast({
      baseDesign: 813.75,
      completedDesign: 24.2,
      estimatePurchase: 854.4,
      k: K_CONCRETE,
      balance,
      unitCost: CONCRETE_B30_COST,
    });
    expect(f.progress).toBeCloseTo(0.0297, 4);
    expect(f.progress!).toBeLessThan(PRELIMINARY_PROGRESS);
    expect(f.confidence).toBe('preliminary');
  });

  it('перелив до К_факт 1,08 разворачивается в прогноз перерасхода и в рубли', () => {
    // Залили 24,2 м3 колонн, приняли по ТТН 26,14 м3 вместо нормативных 25,41.
    const balance = computeBalance({
      materialKind: 'concrete',
      deliveries: [{ quantity: 26.14, pourId: 1 }],
      issues: [],
    });
    const f = computeForecast({
      baseDesign: 813.75,
      completedDesign: 24.2,
      estimatePurchase: 854.4,
      k: K_CONCRETE,
      balance,
      unitCost: CONCRETE_B30_COST,
    });

    expect(f.kActual).toBeCloseTo(1.08, 2);
    // 1,08 / 1,05 = +2,9% к норме — это ещё тревога, а не перерасход.
    expect(f.verdict).toBe('warning');
    // Прогноз итога ≈ 878,8 м3 против сметных 854,4 → ~24 м3 перерасхода.
    expect(f.overrunVsEstimate!).toBeGreaterThan(20);
    expect(f.overrunCost!).toBeGreaterThan(150_000);
  });

  it('перелив до К_факт 1,15 уже даёт вердикт «перерасход»', () => {
    // 24,2 м3 конструктива против 27,83 м3 принятого бетона.
    const balance = computeBalance({
      materialKind: 'concrete',
      deliveries: [{ quantity: 27.83, pourId: 1 }],
      issues: [],
    });
    const f = computeForecast({
      baseDesign: 813.75,
      completedDesign: 24.2,
      estimatePurchase: 854.4,
      k: K_CONCRETE,
      balance,
      unitCost: CONCRETE_B30_COST,
    });

    expect(f.kActual).toBeCloseTo(1.15, 2);
    expect(f.verdict).toBe('over');
    // Прогноз ≈ 935,7 м3: перерасход около 81 м3 и 0,6 млн ₽ себестоимости.
    expect(f.overrunVsEstimate!).toBeCloseTo(81.3, 0);
    expect(f.overrunCost!).toBeCloseTo(636_000, -4);
  });

  it('без залитых захваток прогноз не строится', () => {
    const balance = computeBalance({
      materialKind: 'concrete',
      deliveries: [{ quantity: 100, pourId: null }],
      issues: [],
    });
    const f = computeForecast({
      baseDesign: 5067,
      completedDesign: 0,
      estimatePurchase: 5067,
      k: K_CONCRETE,
      balance,
      unitCost: CONCRETE_B30_COST,
    });
    expect(f.kActual).toBeNull();
    expect(f.total).toBeNull();
    expect(f.verdict).toBe('unknown');
  });

  it('без базы сравнения прогноз не строится, но К_факт считается', () => {
    const balance = computeBalance({
      materialKind: 'concrete',
      deliveries: [{ quantity: 105, pourId: 1 }],
      issues: [],
    });
    const f = computeForecast({
      baseDesign: null,
      completedDesign: 100,
      estimatePurchase: null,
      k: K_CONCRETE,
      balance,
      unitCost: null,
    });
    expect(f.kActual).toBeCloseTo(1.05, 4);
    expect(f.progress).toBeNull();
    expect(f.total).toBeNull();
  });
});

describe('прогноз расхода арматуры', () => {
  // Величины для арматуры считаются в тоннах проектной массы, а не в м3 бетона,
  // иначе К_факт получается в кг/м3 и сравнивать его с нормой 1,10 бессмысленно.
  const designMassT = 214.7 / K_REBAR; // 214,7 т закупки по ДС3 → 195,18 т конструктива
  const concreteProgress = 1065 / 1653; // залито 1065 из 1653 м3 плиты

  it('плита ЛПК: 148 т на 64% объёма — К_факт выше нормы', () => {
    const balance = computeBalance({
      materialKind: 'rebar',
      deliveries: [{ quantity: 214.7, pourId: null }],
      issues: [{ quantity: 148 }],
    });
    const f = computeForecast({
      baseDesign: designMassT,
      completedDesign: designMassT * concreteProgress,
      estimatePurchase: 122, // сметный лимит по ресурсной
      k: K_REBAR,
      balance,
      unitCost: REBAR_COST,
    });

    expect(f.progress).toBeCloseTo(0.644, 3);
    expect(f.confidence).toBe('normal');
    // 148 т списано там, где по ДС3 конструктивной массы 125,76 т → К_факт 1,177.
    expect(f.kActual).toBeCloseTo(1.177, 3);
    // 1,177 / 1,10 = +7% к норме — перерасход.
    expect(f.verdict).toBe('over');
  });

  it('тот же факт против сметного лимита 122 т даёт перерасход в рублях', () => {
    const balance = computeBalance({
      materialKind: 'rebar',
      deliveries: [{ quantity: 214.7, pourId: null }],
      issues: [{ quantity: 148 }],
    });
    const f = computeForecast({
      baseDesign: designMassT,
      completedDesign: designMassT * concreteProgress,
      estimatePurchase: 122,
      k: K_REBAR,
      balance,
      unitCost: REBAR_COST,
    });

    // 148 + (195,18 − 125,76) × 1,177 ≈ 229,7 т против сметных 122 т.
    expect(f.total).toBeCloseTo(229.71, 1);
    expect(f.overrunVsEstimate!).toBeCloseTo(107.71, 1);
    // Около 5,8 млн ₽ по себестоимости 54 000 ₽/т.
    expect(f.overrunCost!).toBeCloseTo(5_816_000, -4);
  });
});

describe('пороги оценки', () => {
  it('до +2% к норме — норма, до +5% — тревога, выше — перерасход', () => {
    expect(verdictFor(1.05, 1.05)).toBe('ok');
    expect(verdictFor(1.07, 1.05)).toBe('ok'); // +1,9%
    expect(verdictFor(1.09, 1.05)).toBe('warning'); // +3,8%
    expect(verdictFor(1.12, 1.05)).toBe('over'); // +6,7%
    expect(verdictFor(null, 1.05)).toBe('unknown');
  });
});
