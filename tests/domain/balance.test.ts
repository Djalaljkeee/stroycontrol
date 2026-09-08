import { describe, it, expect } from 'vitest';
import { computeBalance, completedDesignVolume } from '@/domain/balance';
import { computeVariance } from '@/domain/variance';
import { K_CONCRETE, K_REBAR } from '@/domain/norms';

describe('остатки по бетону', () => {
  it('колонны ЛПК: списано 25,41 при залитых 24,2 — потерь сверх нормы нет', () => {
    const balance = computeBalance({
      materialKind: 'concrete',
      deliveries: [{ quantity: 25.41, pourId: 1 }],
      issues: [],
    });
    expect(balance.incoming).toBeCloseTo(25.41, 4);
    expect(balance.consumed).toBeCloseTo(25.41, 4);
    expect(balance.stock).toBe(0);
    expect(balance.unconfirmed).toBeCloseTo(0, 6);

    const variance = computeVariance({
      projectPurchase: null,
      estimatePurchase: 854.4,
      completedDesign: 24.2,
      k: K_CONCRETE,
      balance,
    });
    // 25,41 − 24,2 × 1,05 = 0. Ровно по норме.
    expect(variance.loss).toBeCloseTo(0, 3);
  });

  it('стены ЛК/ЛШ: 131,5 при залитых 125,3 — тоже в норме', () => {
    const balance = computeBalance({
      materialKind: 'concrete',
      deliveries: [{ quantity: 131.5, pourId: 7 }],
      issues: [],
    });
    const variance = computeVariance({
      projectPurchase: null,
      estimatePurchase: 1740,
      completedDesign: 125.3,
      k: K_CONCRETE,
      balance,
    });
    // 131,5 − 125,3 × 1,05 = −0,065: недобор в пределах округления.
    expect(Math.abs(variance.loss)).toBeLessThan(0.1);
  });

  it('В30 в целом: приход 2385,5 против списанных 1275,11 — неподтверждённый расход', () => {
    // Приход по листу «приходы», списание — по КС-6а за август:
    // 1118,2 (плита) + 25,41 (колонны) + 131,5 (стены ЛК/ЛШ).
    const balance = computeBalance({
      materialKind: 'concrete',
      deliveries: [
        { quantity: 1118.2, pourId: 1 },
        { quantity: 25.41, pourId: 2 },
        { quantity: 131.5, pourId: 3 },
        { quantity: 2385.5 - 1275.11, pourId: null },
      ],
      issues: [],
    });
    expect(balance.incoming).toBeCloseTo(2385.5, 2);
    expect(balance.consumed).toBeCloseTo(1275.11, 2);
    expect(balance.unconfirmed).toBeCloseTo(1110.39, 2);
  });
});

describe('остатки по арматуре', () => {
  it('приход 384,91 т при списанных 174,36 т оставляет 210,55 т на складе', () => {
    // Приход — сумма по SKU листа «приходы»; сходится с агрегатной строкой.
    const skus = [
      4, 1.9, 31.788, 189.088, 2.335, 4.575, 7.97, 0.14, 91.569, 51.545,
    ];
    expect(skus.reduce((a, b) => a + b, 0)).toBeCloseTo(384.91, 3);

    const balance = computeBalance({
      materialKind: 'rebar',
      deliveries: skus.map((quantity) => ({ quantity, pourId: null })),
      // Списание по КС-6а за август: плита 148 + колонны 8,84 + стены 13,2
      // + фундамент БК 2,32 + приямки 2.
      issues: [148, 8.84, 13.2, 2.32, 2].map((quantity) => ({ quantity })),
    });

    expect(balance.incoming).toBeCloseTo(384.91, 3);
    expect(balance.consumed).toBeCloseTo(174.36, 3);
    expect(balance.stock).toBeCloseTo(210.55, 3);
    // У арматуры есть склад, поэтому неподтверждённого расхода быть не может.
    expect(balance.unconfirmed).toBe(0);
  });

  it('арматура плиты ЛПК: проект разошёлся со сметой на 92,7 т', () => {
    const balance = computeBalance({
      materialKind: 'rebar',
      deliveries: [{ quantity: 214.7, pourId: null }],
      issues: [{ quantity: 148 }],
    });
    const variance = computeVariance({
      projectPurchase: 214.7, // ДС3
      estimatePurchase: 122, // ресурсная
      completedDesign: 1065, // залито по КС-6а за август
      k: K_REBAR,
      balance,
    });
    expect(variance.design).toBeCloseTo(92.7, 2);
    // В деньгах по себестоимости 54 000 ₽/т — около 5,0 млн ₽.
    expect(variance.design! * 54000).toBeCloseTo(5_005_800, 0);
  });
});

describe('выполненный объём', () => {
  it('в расчёт идут только залитые захватки', () => {
    const done = completedDesignVolume([
      { designVolumeM3: 24.2, status: 'done' },
      { designVolumeM3: 100, status: 'planned' },
      { designVolumeM3: 50, status: 'in_progress' },
    ]);
    expect(done).toBe(24.2);
  });
});

describe('списание бетона из двух источников', () => {
  it('привязанные ТТН и закрытые объёмы КС-6а складываются, а не дублируются', () => {
    // Захватка с привязанной ТТН — так работает ввод на площадке.
    // Закрытый объём КС-6а за другой месяц — так выглядит история до пилота.
    const balance = computeBalance({
      materialKind: 'concrete',
      deliveries: [
        { quantity: 25.41, pourId: 1 },
        { quantity: 1118.2, pourId: null },
      ],
      issues: [{ quantity: 1118.2 }],
    });
    expect(balance.incoming).toBeCloseTo(1143.61, 2);
    expect(balance.consumed).toBeCloseTo(1143.61, 2);
    expect(balance.unconfirmed).toBeCloseTo(0, 6);
  });

  it('непривязанный приход арматуры — это склад, а не потеря', () => {
    const balance = computeBalance({
      materialKind: 'rebar',
      deliveries: [{ quantity: 100, pourId: null }],
      issues: [{ quantity: 40 }],
    });
    expect(balance.stock).toBe(60);
    expect(balance.unconfirmed).toBe(0);
  });
});
