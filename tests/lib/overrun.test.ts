import { describe, expect, it } from 'vitest';
import { buildOverrun, costLines, overrunByMaterial, overrunCost } from '@/lib/overrun';
import type { MaterialInfo, Report, StructureInfo, TierInfo, TierRow } from '@/lib/report';

const material = (id: number, code: string, extra: Partial<MaterialInfo> = {}): MaterialInfo => ({
  id,
  code,
  name: code,
  kind: 'concrete',
  unit: 'м3',
  concreteClass: null,
  rebarDiameter: null,
  rebarClass: null,
  isAggregate: false,
  aggregateId: null,
  ...extra,
});
const B30 = material(1, 'CONCRETE_B30');
const REBAR = material(2, 'REBAR', { kind: 'rebar', unit: 'т', isAggregate: true });
const D32 = material(3, 'REBAR_32_A500', { kind: 'rebar', unit: 'т', aggregateId: 2, rebarDiameter: 32 });

const tier = (id: number, code: string): TierInfo => ({
  id,
  code,
  name: code,
  stage: '3.2',
  levelFrom: null,
  levelTo: null,
  consumptionFromClosings: false,
  sortOrder: id,
});
const structure = (id: number, code: string, tierId: number): StructureInfo => ({
  id,
  parentId: null,
  code,
  name: code,
  kind: 'slab',
  level: null,
  tierId,
  sortOrder: id,
  depth: 1,
  subtree: [id],
});
const row = (m: MaterialInfo, project: number | null, incoming: number, k: number, projectFromTier = false): TierRow => ({
  material: m,
  project,
  projectRevision: project != null ? 'КЖ1 изм. 8' : null,
  projectFromTier,
  projectWithK: project != null ? project * k : null,
  incoming,
  closed: 0,
});

function report(byTier: Report['byTier']): Report {
  return {
    byTier,
    totals: [
      { material: B30, unitCost: 7823 },
      { material: REBAR, unitCost: 54000 },
      { material: D32, unitCost: null },
    ],
  } as unknown as Report;
}

describe('перерасход: приход − проект × К', () => {
  it('этаж целиком с проектом с листа: выделенный блок не вычитается из проекта', () => {
    const kj0 = tier(1, 'KJ0');
    const stairs = structure(10, 'stairs', 1);
    const lines = buildOverrun(
      report([
        {
          tier: kj0,
          // Проект этажа с листа — без лестницы; приход этажа — вместе с ней.
          rows: [row(B30, 200, 230, 1.05, true)],
          tierOnlyIncoming: new Map(),
          blocks: [{ structure: stairs, rows: [row(B30, 10, 11, 1.05)] }],
        },
      ]),
    );
    const floor = lines.find((l) => l.structure == null)!;
    expect(floor.project).toBe(200);
    expect(floor.incoming).toBeCloseTo(219, 6);
    expect(floor.overrun).toBeCloseTo(9, 6);
    expect(floor.verdict).toBe('over');
    const block = lines.find((l) => l.structure?.code === 'stairs')!;
    expect(block.overrun).toBeCloseTo(0.5, 6);
    expect(block.cost).toBeCloseTo(0.5 * 7823, 3);
  });

  it('этаж по блокам: приход без проекта ни с чем не сравнивается', () => {
    const t3 = tier(2, 'T3');
    const columns = structure(20, 'columns', 2);
    const stairs = structure(21, 'stairs', 2);
    const slab = structure(22, 'slab', 2);
    const lines = buildOverrun(
      report([
        {
          tier: t3,
          rows: [row(B30, 120, 100, 1.05)],
          tierOnlyIncoming: new Map(),
          blocks: [
            { structure: columns, rows: [row(B30, 100, 100, 1.05)] },
            // Лестница без проекта, плита с проектом, но без прихода.
            { structure: stairs, rows: [row(B30, null, 0.42, 1.05)] },
            { structure: slab, rows: [row(B30, 20, 0, 1.05)] },
          ],
        },
      ]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].structure?.code).toBe('columns');
    expect(lines[0].verdict).toBe('ok');
  });

  it('арматура: деньги по диаметрам, без двойного счёта общего тоннажа', () => {
    const t3 = tier(2, 'T3');
    const columns = structure(20, 'columns', 2);
    const lines = buildOverrun(
      report([
        {
          tier: t3,
          rows: [row(REBAR, 20, 28, 1.1), row(D32, 18, 25, 1.1)],
          tierOnlyIncoming: new Map(),
          blocks: [{ structure: columns, rows: [row(REBAR, 20, 28, 1.1), row(D32, 18, 25, 1.1)] }],
        },
      ]),
    );
    expect(costLines(lines).map((l) => l.material.code)).toEqual(['REBAR_32_A500']);
    // У диаметра своей цены нет — цена общего тоннажа.
    expect(overrunCost(lines)).toBeCloseTo((25 - 18 * 1.1) * 54000, 3);
    expect(overrunByMaterial(lines).get(REBAR.id)!.overrun).toBeCloseTo(28 - 22, 6);
  });

  it('до +2% к проекту × К — тревога, а не перерасход', () => {
    const t2 = tier(3, 'T2');
    const walls = structure(30, 'walls', 3);
    const [line] = buildOverrun(
      report([
        {
          tier: t2,
          rows: [row(B30, 251.78, 266.2, 1.05)],
          tierOnlyIncoming: new Map(),
          blocks: [{ structure: walls, rows: [row(B30, 251.78, 266.2, 1.05)] }],
        },
      ]),
    );
    expect(line.overrun).toBeCloseTo(1.831, 3);
    expect(line.verdict).toBe('warning');
  });
});
