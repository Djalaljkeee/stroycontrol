import { describe, it, expect } from 'vitest';
import {
  K_CONCRETE,
  K_REBAR,
  kNorm,
  baselineFor,
  designQuantityOf,
  purchaseQuantityOf,
} from '@/domain/norms';
import type { BaselineEntry } from '@/domain/types';

describe('нормативные коэффициенты', () => {
  it('бетон 1,05, арматура 1,10', () => {
    expect(kNorm('concrete', 'columns')).toBe(K_CONCRETE);
    expect(kNorm('concrete', 'slab')).toBe(1.05);
    expect(kNorm('rebar', 'slab')).toBe(K_REBAR);
  });

  it('выводятся из ресурсной как отношение закупки к конструктиву', () => {
    // Плита ЛПК: 1580 (основная) + 73 (фундаменты ЛК и ЛШ) → 1736 м3 закупки.
    expect((1736 / (1580 + 73))).toBeCloseTo(1.05, 2);
    // Колонны ЛПК: 813,75 → 854,4.
    expect(854.4 / 813.75).toBeCloseTo(1.05, 4);
    // Перекрытия ЛПК: 4826 → 5067.
    expect(5067 / 4826).toBeCloseTo(1.05, 3);
  });

  it('точечное переопределение важнее правила по виду материала', () => {
    const overrides = [
      { materialKind: 'concrete' as const, structureKind: null, kLoss: 1.05 },
      { materialKind: 'concrete' as const, structureKind: 'prep' as const, kLoss: 1.09 },
    ];
    expect(kNorm('concrete', 'prep', overrides)).toBe(1.09);
    expect(kNorm('concrete', 'columns', overrides)).toBe(1.05);
  });
});

describe('подбор базы сравнения', () => {
  const columns: BaselineEntry[] = [
    { source: 'estimate', revision: 'ресурсная', designQuantity: 813.75, purchaseQuantity: 854.4, effectiveFrom: '2026-06-09' },
    { source: 'contract', revision: 'ДС3', designQuantity: 813.75, purchaseQuantity: 854.4, effectiveFrom: '2026-08-07' },
    { source: 'project', revision: 'КЖ1-01', designQuantity: 75.66, purchaseQuantity: null, effectiveFrom: '2026-09-02' },
  ];

  it('проект точнее договора, договор точнее сметы', () => {
    const resolved = baselineFor(columns);
    expect(resolved?.source).toBe('project');
    expect(resolved?.revision).toBe('КЖ1-01');
    expect(resolved?.isEstimated).toBe(false);
  });

  it('без КЖ откатывается на договор и помечает базу оценочной', () => {
    // Перекрытия отм. +22,400 — КЖ на них ещё не выпущен.
    const floors = columns.filter((e) => e.source !== 'project');
    const resolved = baselineFor(floors);
    expect(resolved?.source).toBe('contract');
    expect(resolved?.isEstimated).toBe(true);
  });

  it('без договора остаётся смета', () => {
    const only = columns.filter((e) => e.source === 'estimate');
    expect(baselineFor(only)?.source).toBe('estimate');
  });

  it('внутри источника побеждает свежая редакция ДС', () => {
    // Арматура плиты ЛПК: 122 т в первой редакции, 214,7 т в ДС3.
    const rebar: BaselineEntry[] = [
      { source: 'contract', revision: 'ДС2', designQuantity: null, purchaseQuantity: 122, effectiveFrom: '2026-07-31' },
      { source: 'contract', revision: 'ДС3', designQuantity: null, purchaseQuantity: 214.7, effectiveFrom: '2026-08-31' },
    ];
    const resolved = baselineFor(rebar);
    expect(resolved?.revision).toBe('ДС3');
    expect(resolved?.purchaseQuantity).toBe(214.7);
  });

  it('нет ни одной базы — null', () => {
    expect(baselineFor([])).toBeNull();
  });

  it('недостающую величину достраивает через коэффициент', () => {
    const project = baselineFor(columns)!;
    // В КЖ есть только конструктивный объём — закупка достраивается умножением.
    expect(purchaseQuantityOf(project, 1.05)).toBeCloseTo(79.443, 3);

    const contract = baselineFor(columns, ['contract'])!;
    expect(designQuantityOf(contract, 1.05)).toBeCloseTo(813.75, 2);
  });
});
