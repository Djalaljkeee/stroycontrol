// Перерасход так, как его считает лист «приходы»: привезено по ТТН минус
// проект × К — по каждому блоку, куда разносился приход.
//
// Блок — конструктив, на который есть и приход, и проект. Пришедшее на этаж
// целиком (КЖ0, 1-й этаж) сравнивается остатком этажа: проект этажа минус
// выделенные блоки. Приход на конструктив без проекта не сравнивается ни с чем.
// Сравнение со сметой сюда не входит — рост объёма по ДС перерасходом на
// площадке не является.
import { WARNING_RATIO, type Verdict } from '@/domain';
import type { MaterialInfo, Report, StructureInfo, TierInfo } from './report';

export interface OverrunLine {
  tier: TierInfo;
  /** null — остаток этажа: приход, разнесённый на этаж целиком. */
  structure: StructureInfo | null;
  material: MaterialInfo;
  project: number;
  projectWithK: number;
  incoming: number;
  /** Приход − проект × К; плюс — перерасход. */
  overrun: number;
  /** Приход / проект — фактический коэффициент закупки. */
  kActual: number;
  k: number;
  cost: number | null;
  verdict: Verdict;
}

const EPS = 0.005;

export function overrunVerdict(incoming: number, projectWithK: number): Verdict {
  if (projectWithK <= 0) return 'unknown';
  if (incoming - projectWithK <= EPS) return 'ok';
  return incoming / projectWithK <= WARNING_RATIO ? 'warning' : 'over';
}

export function buildOverrun(report: Report): OverrunLine[] {
  const costOf = new Map(report.totals.map((c) => [c.material.id, c.unitCost]));
  // У диаметров своей цены нет — берётся цена общего тоннажа.
  const unitCost = (m: MaterialInfo) =>
    costOf.get(m.id) ?? (m.aggregateId != null ? costOf.get(m.aggregateId) ?? null : null);

  const lines: OverrunLine[] = [];
  const push = (
    tier: TierInfo,
    structure: StructureInfo | null,
    material: MaterialInfo,
    k: number,
    project: number,
    incoming: number,
  ) => {
    if (project <= 0 || incoming <= EPS) return;
    const projectWithK = project * k;
    const overrun = incoming - projectWithK;
    const price = unitCost(material);
    lines.push({
      tier,
      structure,
      material,
      project,
      projectWithK,
      incoming,
      overrun,
      kActual: incoming / project,
      k,
      cost: price != null ? overrun * price : null,
      verdict: overrunVerdict(incoming, projectWithK),
    });
  };

  for (const t of report.byTier) {
    for (const row of t.rows) {
      if (row.project == null || row.projectWithK == null) continue;
      const k = row.project > 0 ? row.projectWithK / row.project : 1;
      let restProject: number = row.project;
      let restIncoming = row.incoming;
      for (const b of t.blocks) {
        const r = b.rows.find((x) => x.material.id === row.material.id);
        if (r == null || r.incoming <= EPS) continue;
        // Приход на конструктив без проекта сравнить не с чем — в остаток этажа
        // он не идёт, иначе ляжет на чужой проект (лестница T3 и плита T3).
        restIncoming -= r.incoming;
        if (r.project == null) continue;
        push(t.tier, b.structure, row.material, k, r.project, r.incoming);
        // Проект этажа с листа КЖ0 выделенные блоки уже не включает.
        if (!row.projectFromTier) restProject -= r.project;
      }
      push(t.tier, null, row.material, k, restProject, restIncoming);
    }
  }
  return lines;
}

/**
 * Строки, по которым считаются деньги: бетон и арматура по диаметрам, а там,
 * где диаметров нет, — общим тоннажом. Иначе одна и та же арматура
 * посчиталась бы дважды, а перерасход одного диаметра растворился бы в итоге.
 */
export function costLines(lines: OverrunLine[]): OverrunLine[] {
  const scope = (l: OverrunLine) => `${l.tier.id}:${l.structure?.id ?? '-'}`;
  const withSkus = new Set(lines.filter((l) => l.material.kind === 'rebar' && !l.material.isAggregate).map(scope));
  return lines.filter((l) =>
    l.material.kind === 'concrete' || (l.material.isAggregate ? !withSkus.has(scope(l)) : true),
  );
}

/** Сумма перерасхода в рублях — только положительные строки, без взаимозачёта. */
export const overrunCost = (lines: OverrunLine[]) =>
  costLines(lines).reduce((a, l) => a + (l.overrun > EPS ? l.cost ?? 0 : 0), 0);

/** Перерасход по материалу: сумма по блокам, где привезли больше проекта × К. */
export function overrunByMaterial(lines: OverrunLine[]) {
  const out = new Map<number, { overrun: number; cost: number; verdict: Verdict }>();
  const rank: Record<Verdict, number> = { unknown: 0, ok: 1, warning: 2, over: 3 };
  for (const l of lines) {
    const acc = out.get(l.material.id) ?? { overrun: 0, cost: 0, verdict: 'ok' as Verdict };
    if (l.overrun > EPS) {
      acc.overrun += l.overrun;
      acc.cost += l.cost ?? 0;
    }
    if (rank[l.verdict] > rank[acc.verdict]) acc.verdict = l.verdict;
    out.set(l.material.id, acc);
  }
  return out;
}
