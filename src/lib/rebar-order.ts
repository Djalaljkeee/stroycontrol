// Арматура под заказ: сколько довезти по каждому диаметру.
//
// Проект по диаметрам есть только там, где выпущен КЖ (ведомость расхода стали),
// а часть прихода закрыта лишь общим тоннажом — на этажах, где приход шёл на
// этаж целиком, покрытие видно только по списанию КС-6а без диаметров. Поэтому
// считается по листовым конструктивам: остаток каждого диаметра, а покрытие
// общим тоннажом раскладывается пропорционально остаткам. Что не разложено —
// конструктивы без КЖ — идёт строкой «без разбивки».
import type { Cell, MaterialInfo, Report } from './report';

export interface SkuLine {
  material: MaterialInfo;
  project: number;
  delivered: number;
  toDeliver: number;
}

export interface RebarOrder {
  skus: SkuLine[];
  /** Остаток по общему тоннажу, который не на что разложить по диаметрам. */
  unsplit: number;
  /** Итого довезти: сумма по диаметрам плюс без разбивки. */
  total: number;
}

const covered = (c: Cell) => Math.max(c.balance.incoming, c.balance.consumed);
const aggregateOf = (cells: Cell[]) => cells.find((c) => c.material.kind === 'rebar' && c.material.isAggregate);
/** Довезти по общему тоннажу узла — так же, как в строке «Арматура в ассортименте». */
const aggregateToDeliver = (agg: Cell) =>
  agg.basePurchase != null ? Math.max(0, agg.basePurchase - covered(agg)) : 0;

function leafOrder(cells: Cell[]): RebarOrder | null {
  const agg = aggregateOf(cells);
  if (!agg) return null;
  const aggToDeliver = aggregateToDeliver(agg);
  const skuCells = cells.filter((c) => c.material.aggregateId === agg.material.id && c.basePurchase != null);

  const rem = skuCells.map((c) => Math.max(0, c.basePurchase! - covered(c)));
  const sumRem = rem.reduce((a, b) => a + b, 0);
  // Покрытие общим тоннажом (КС-6а) уменьшает остатки диаметров пропорционально.
  const scale = sumRem > 0 ? Math.min(1, aggToDeliver / sumRem) : 0;
  const skus = skuCells.map((c, i) => {
    const toDeliver = rem[i] * scale;
    // Привезено с учётом доли, закрытой общим тоннажом: привезено + довезти = проект.
    return { material: c.material, project: c.basePurchase!, delivered: Math.max(covered(c), c.basePurchase! - toDeliver), toDeliver };
  });
  const split = skus.reduce((a, s) => a + s.toDeliver, 0);
  const unsplit = Math.max(0, aggToDeliver - split);
  return { skus, unsplit, total: split + unsplit };
}

/** Под каждый узел дерева — сумма по его листовым конструктивам. */
export function buildRebarOrder(report: Report): Map<number, RebarOrder> {
  const leafs = new Map<number, RebarOrder>();
  for (const s of report.structures) {
    if (s.subtree.length !== 1) continue;
    const o = leafOrder(report.byStructure.get(s.id)?.cells ?? []);
    if (o) leafs.set(s.id, o);
  }

  const out = new Map<number, RebarOrder>();
  for (const s of report.structures) {
    const bySku = new Map<number, SkuLine>();
    let unsplit = 0;
    for (const id of s.subtree) {
      const o = leafs.get(id);
      if (!o) continue;
      unsplit += o.unsplit;
      for (const l of o.skus) {
        const acc = bySku.get(l.material.id) ?? { material: l.material, project: 0, delivered: 0, toDeliver: 0 };
        acc.project += l.project;
        acc.delivered += l.delivered;
        acc.toDeliver += l.toDeliver;
        bySku.set(l.material.id, acc);
      }
    }
    // Договор на строку КС-6а лежит на родителе, а не на захватках: у этажей без КЖ
    // остаток есть только на уровне узла — он и идёт «без разбивки».
    const agg = aggregateOf(report.byStructure.get(s.id)?.cells ?? []);
    const split = [...bySku.values()].reduce((a, l) => a + l.toDeliver, 0);
    if (agg && s.subtree.length > 1) unsplit = Math.max(unsplit, aggregateToDeliver(agg) - split);
    if (bySku.size === 0 && unsplit <= 0.005) continue;
    const skus = [...bySku.values()].sort(
      (a, b) =>
        (a.material.rebarDiameter ?? 0) - (b.material.rebarDiameter ?? 0) ||
        (a.material.rebarClass ?? '').localeCompare(b.material.rebarClass ?? ''),
    );
    const total = unsplit + split;
    out.set(s.id, { skus, unsplit, total });
  }
  return out;
}
