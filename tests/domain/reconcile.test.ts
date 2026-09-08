import { describe, it, expect } from 'vitest';
import { diffRevisions, type RevisionEntry } from '@/domain/reconcile';

const base = {
  designQuantity: null,
  effectiveFrom: '2026-07-31',
  source: 'contract' as const,
};

describe('дифф редакций ДС', () => {
  it('смена класса бетона плиты В25 → В30 попадает в дифф, а не в перерасход', () => {
    // Редакция от 31.07.2026: плита ЛПК проходила как «Поставка бетона В25».
    const from: RevisionEntry[] = [
      {
        ...base,
        revision: 'ДС2',
        structureCode: '3.1',
        structureName: 'Фундаментная плита ЛПК',
        materialCode: 'CONCRETE_SLAB',
        materialName: 'Бетон плиты ЛПК',
        concreteClass: 'В25',
        purchaseQuantity: 1736,
      },
    ];
    // ДС3: тот же объём, но класс В30.
    const to: RevisionEntry[] = [
      {
        ...base,
        revision: 'ДС3',
        effectiveFrom: '2026-08-31',
        structureCode: '3.1',
        structureName: 'Фундаментная плита ЛПК',
        materialCode: 'CONCRETE_SLAB',
        materialName: 'Бетон плиты ЛПК',
        concreteClass: 'В30',
        purchaseQuantity: 1736,
      },
    ];

    const [row] = diffRevisions(from, to);
    expect(row.kind).toBe('class');
    expect(row.fromClass).toBe('В25');
    expect(row.toClass).toBe('В30');
    // Объём не изменился, значит перерасхода из смены класса не возникает.
    expect(row.delta).toBe(0);
  });

  it('рост арматуры плиты 122 → 214,7 т виден как изменение объёма', () => {
    const from: RevisionEntry[] = [
      {
        ...base,
        revision: 'ДС2',
        structureCode: '3.1',
        structureName: 'Фундаментная плита ЛПК',
        materialCode: 'REBAR',
        materialName: 'Арматура в ассортименте',
        purchaseQuantity: 122,
      },
    ];
    const to: RevisionEntry[] = [
      {
        ...base,
        revision: 'ДС3',
        effectiveFrom: '2026-08-31',
        structureCode: '3.1',
        structureName: 'Фундаментная плита ЛПК',
        materialCode: 'REBAR',
        materialName: 'Арматура в ассортименте',
        purchaseQuantity: 214.7,
      },
    ];

    const [row] = diffRevisions(from, to);
    expect(row.kind).toBe('quantity');
    expect(row.delta).toBeCloseTo(92.7, 2);
  });

  it('появившиеся и исчезнувшие строки помечаются отдельно', () => {
    const from: RevisionEntry[] = [
      { ...base, revision: 'ДС2', structureCode: '1.2.4', structureName: 'Перегородки', materialCode: 'BLOCK', materialName: 'Газобетон', purchaseQuantity: 8 },
    ];
    const to: RevisionEntry[] = [
      { ...base, revision: 'ДС3', structureCode: '3.3', structureName: 'Приямки', materialCode: 'REBAR', materialName: 'Арматура', purchaseQuantity: 2 },
    ];

    const rows = diffRevisions(from, to);
    expect(rows.find((r) => r.structureCode === '3.3')?.kind).toBe('added');
    expect(rows.find((r) => r.structureCode === '1.2.4')?.kind).toBe('removed');
  });

  it('расхождение меньше копейки объёма — округление, не изменение', () => {
    const mk = (q: number, rev: string): RevisionEntry[] => [
      { ...base, revision: rev, structureCode: '3.2', structureName: 'Стены', materialCode: 'CONCRETE_B30', materialName: 'Бетон В30', purchaseQuantity: q },
    ];
    const [row] = diffRevisions(mk(1740, 'ДС2'), mk(1740.004, 'ДС3'));
    expect(row.kind).toBe('unchanged');
  });
});
