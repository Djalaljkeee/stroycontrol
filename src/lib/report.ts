// Без 'server-only': модуль используется и серверными компонентами, и скриптами
// проверки/экспорта, запускаемыми через tsx. От попадания в клиентский бандл
// защищает импорт '@/db', который требует DATABASE_URL.
import { db } from '@/db';
import {
  baselines,
  closings,
  deliveries,
  issues,
  materials,
  norms,
  pours,
  prices,
  structures,
  tiers,
} from '@/db/schema';
import {
  baselineFor,
  computeBalance,
  computeForecast,
  computeVariance,
  designQuantityOf,
  kNorm,
  purchaseQuantityOf,
  specificReinforcement,
  reinforcementRatio,
  type Balance,
  type BaselineEntry,
  type Forecast,
  type MaterialKind,
  type ResolvedBaseline,
  type StructureKind,
  type Variance,
} from '@/domain';
import { n, nOrNull } from './format';

export interface MaterialInfo {
  id: number;
  code: string;
  name: string;
  kind: MaterialKind;
  unit: string;
  concreteClass: string | null;
  rebarDiameter: number | null;
  rebarClass: string | null;
  isAggregate: boolean;
  aggregateId: number | null;
}

export interface TierInfo {
  id: number;
  code: string;
  name: string;
  stage: string;
  levelFrom: string | null;
  levelTo: string | null;
  consumptionFromClosings: boolean;
  sortOrder: number;
}

export interface StructureInfo {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  kind: StructureKind;
  level: string | null;
  tierId: number | null;
  sortOrder: number;
  depth: number;
  /** Сам конструктив плюс все вложенные — по ним и агрегируется факт. */
  subtree: number[];
}

export interface Cell {
  material: MaterialInfo;
  base: ResolvedBaseline | null;
  /** Конструктивная величина базы в единицах материала (м3 либо т массы). */
  baseDesign: number | null;
  /** Объём закупки по базе. */
  basePurchase: number | null;
  /**
   * Сметный лимит закупки с учётом переездов между классами бетона —
   * против него считается перерасход.
   */
  estimatePurchase: number | null;
  /** Тот же лимит, как он записан в ресурсной, — для сверки итогов. */
  estimateOriginal: number | null;
  /** Объём закупки по проекту, если КЖ выпущен. */
  projectPurchase: number | null;
  completedDesign: number;
  k: number;
  unitCost: number | null;
  balance: Balance;
  /** Запроцентовано по КС-6а, в единицах закупки. */
  closed: number;
  /**
   * Списано на конструктивы, у которых ещё нет выполнения (ни процентовки, ни
   * залитой захватки): привезли под ярус, а закрыть не успели. В К_факт и прогноз
   * не идёт — иначе материал есть, а объёма под ним нет, и К взлетает.
   */
  inProgress: number;
  variance: Variance;
  forecast: Forecast;
  /**
   * Строка вытеснена более свежей редакцией ДС: конструктив перешёл на другой
   * класс бетона. Значения сохранены для сверки со сметой, прогноз не строится.
   */
  superseded: boolean;
  /** Кг арматуры на м3 бетона; для бетона не заполняется. */
  specificKgPerM3: number | null;
  designSpecificKgPerM3: number | null;
  specificRatio: number | null;
}

export interface StructureReport {
  structure: StructureInfo;
  /** Доля забетонированного конструктивного объёма — общая для всех материалов узла. */
  concreteProgress: number | null;
  concreteDesignTotal: number;
  concreteDesignCompleted: number;
  cells: Cell[];
}

export interface ClassConflict {
  structureCode: string;
  structureName: string;
  parentCode: string | null;
  projectMaterial: string;
  contractMaterial: string;
  revision: string;
}

/** Строка разреза по ярусам — то же, что строка листа «приходы». */
export interface TierRow {
  material: MaterialInfo;
  /** Проект, конструктивный объём (м3 / т). */
  project: number | null;
  projectRevision: string | null;
  /** Проект × К — сколько должно быть привезено. */
  projectWithK: number | null;
  /** Привезено и разнесено сюда. */
  incoming: number;
  /** Запроцентовано по КС-6а. */
  closed: number;
}

export interface TierBlockReport {
  structure: StructureInfo;
  rows: TierRow[];
}

export interface TierReport {
  tier: TierInfo;
  /** Итог яруса: проект — ярусная база либо сумма захваток, приход — всё разнесённое на ярус. */
  rows: TierRow[];
  /** Приход, разнесённый на ярус без указания конструктива. */
  tierOnlyIncoming: Map<number, number>;
  blocks: TierBlockReport[];
}

export interface Report {
  structures: StructureInfo[];
  tiers: TierInfo[];
  byStructure: Map<number, StructureReport>;
  byTier: TierReport[];
  /** Сводка по объекту целиком — она же остаточная таблица. */
  totals: Cell[];
  materials: MaterialInfo[];
  /** Приход, не разнесённый ни на ярус, ни на конструктив, по материалам. */
  unallocatedIncoming: Map<number, number>;
  /**
   * Проект задаёт конструктиву один класс бетона, а действующий ДС закупает
   * другой. Такие расхождения нельзя разрешить автоматически — их подтверждает
   * сметчик. До ДС5 так выглядели стены на отм. −0,080: КЖ1 — В25, ДС3 — В30.
   */
  classConflicts: ClassConflict[];
  generatedAt: Date;
}

/** Загружает всё и считает отчёт целиком: объём данных пилота это позволяет. */
export async function buildReport(): Promise<Report> {
  const [
    structureRows,
    tierRows,
    materialRows,
    baselineRows,
    normRows,
    priceRows,
    pourRows,
    deliveryRows,
    issueRows,
    closingRows,
  ] = await Promise.all([
    db.select().from(structures).orderBy(structures.sortOrder),
    db.select().from(tiers).orderBy(tiers.sortOrder),
    db.select().from(materials).orderBy(materials.id),
    db.select().from(baselines),
    db.select().from(norms),
    db.select().from(prices),
    db.select().from(pours),
    db.select().from(deliveries),
    db.select().from(issues),
    db.select().from(closings),
  ]);

  const materialList: MaterialInfo[] = materialRows.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    kind: m.kind as MaterialKind,
    unit: m.unit,
    concreteClass: m.concreteClass,
    rebarDiameter: m.rebarDiameter,
    rebarClass: m.rebarClass,
    isAggregate: m.isAggregate,
    aggregateId: m.aggregateId,
  }));
  const materialById = new Map(materialList.map((m) => [m.id, m]));
  const concreteMaterials = materialList.filter((m) => m.kind === 'concrete');

  // Какие SKU сворачиваются в агрегатную позицию арматуры.
  const skusOf = new Map<number, number[]>();
  for (const m of materialList) {
    if (m.aggregateId == null) continue;
    const list = skusOf.get(m.aggregateId) ?? [];
    list.push(m.id);
    skusOf.set(m.aggregateId, list);
  }
  /** Позиция и, для агрегата, все её SKU — по ним собирается факт. */
  const factMaterialIds = (m: MaterialInfo) => (m.isAggregate ? [m.id, ...(skusOf.get(m.id) ?? [])] : [m.id]);

  const tierList: TierInfo[] = tierRows.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    stage: t.stage,
    levelFrom: t.levelFrom,
    levelTo: t.levelTo,
    consumptionFromClosings: t.consumptionFromClosings,
    sortOrder: t.sortOrder,
  }));

  // ── Дерево конструктивов ────────────────────────────────────────────────
  const childrenOf = new Map<number | null, number[]>();
  for (const s of structureRows) {
    const list = childrenOf.get(s.parentId) ?? [];
    list.push(s.id);
    childrenOf.set(s.parentId, list);
  }
  const subtreeOf = (id: number): number[] => {
    const out = [id];
    for (const child of childrenOf.get(id) ?? []) out.push(...subtreeOf(child));
    return out;
  };
  const depthOf = new Map<number, number>();
  const byId = new Map(structureRows.map((s) => [s.id, s]));
  const depth = (id: number): number => {
    if (depthOf.has(id)) return depthOf.get(id)!;
    const parent = byId.get(id)?.parentId;
    const d = parent == null ? 0 : depth(parent) + 1;
    depthOf.set(id, d);
    return d;
  };

  const structureList: StructureInfo[] = structureRows.map((s) => ({
    id: s.id,
    parentId: s.parentId,
    code: s.code,
    name: s.name,
    kind: s.kind as StructureKind,
    level: s.level,
    tierId: s.tierId,
    sortOrder: s.sortOrder,
    depth: depth(s.id),
    subtree: subtreeOf(s.id),
  }));

  // ── Базы сравнения ──────────────────────────────────────────────────────
  const normOverrides = normRows.map((r) => ({
    materialKind: r.materialKind as MaterialKind,
    structureKind: (r.structureKind as StructureKind | null) ?? null,
    kLoss: n(r.kLoss),
  }));

  const costOf = new Map<number, number>();
  for (const p of priceRows) {
    if (p.layer === 'cost') costOf.set(p.materialId, n(p.value));
  }

  // Базы на ярус целиком (проект КЖ0 с листа «приходы») в дерево конструктивов
  // не входят — они видны только в разрезе ярусов.
  const structureBaselines = baselineRows.filter((b) => b.structureId != null);

  // Договорная база берётся только из действующей редакции ДС. Прошлые редакции
  // остаются в базе для экрана «Редакции», но в расчёт не идут: иначе плита ЛПК
  // учитывается дважды — как В25 по ДС2 и как В30 по ДС3.
  const currentContractRevision = structureBaselines
    .filter((b) => b.source === 'contract')
    .reduce<{ revision: string; effectiveFrom: string } | null>(
      (acc, b) =>
        acc == null || b.effectiveFrom.localeCompare(acc.effectiveFrom) > 0
          ? { revision: b.revision, effectiveFrom: b.effectiveFrom }
          : acc,
      null,
    )?.revision ?? null;

  const baselineIndex = new Map<string, BaselineEntry[]>();
  for (const b of structureBaselines) {
    if (b.source === 'contract' && b.revision !== currentContractRevision) continue;
    const key = `${b.structureId}:${b.materialId}`;
    const list = baselineIndex.get(key) ?? [];
    list.push({
      source: b.source as BaselineEntry['source'],
      revision: b.revision,
      designQuantity: nOrNull(b.designQuantity),
      purchaseQuantity: nOrNull(b.purchaseQuantity),
      effectiveFrom: b.effectiveFrom,
    });
    baselineIndex.set(key, list);
  }

  /**
   * Закупка бетона по действующему ДС в разрезе классов: своя строка конструктива,
   * а если её нет — сумма по дочерним. Стены ЛК/ЛШ по ДС5 — это КЖ0 на В30 и
   * КЖ1 на В25 дочерними строками, а у родителя своей договорной строки нет.
   */
  const contractSharesMemo = new Map<number, Map<number, number>>();
  const contractShares = (structureId: number): Map<number, number> => {
    const cached = contractSharesMemo.get(structureId);
    if (cached) return cached;
    const own = new Map<number, number>();
    for (const m of concreteMaterials) {
      const entries = baselineIndex.get(`${structureId}:${m.id}`) ?? [];
      const contract = entries.find((e) => e.source === 'contract');
      if (contract?.purchaseQuantity) own.set(m.id, contract.purchaseQuantity);
    }
    let result = own;
    if (own.size === 0) {
      result = new Map();
      for (const child of childrenOf.get(structureId) ?? []) {
        for (const [mid, q] of contractShares(child)) result.set(mid, (result.get(mid) ?? 0) + q);
      }
    }
    contractSharesMemo.set(structureId, result);
    return result;
  };

  const ownBaseline = (structureId: number, materialId: number, k: number) => {
    const entries = baselineIndex.get(`${structureId}:${materialId}`);
    if (!entries) return null;
    const resolved = baselineFor(entries);
    if (!resolved) return null;

    // Строка вытеснена, если по действующему ДС этот конструктив закрывается
    // другим классом бетона. Значение сохраняется — иначе сметные итоги
    // перестанут сходиться с ресурсной, — но прогноз по нему не строится.
    const material = materialById.get(materialId);
    const shares = material?.kind === 'concrete' ? contractShares(structureId) : null;
    const superseded = shares != null && shares.size > 0 && !shares.has(materialId);

    return {
      superseded,
      resolved,
      design: designQuantityOf(resolved, k),
      purchase: purchaseQuantityOf(resolved, k),
      estimate: (() => {
        const e = baselineFor(entries, ['estimate']);
        return e ? purchaseQuantityOf(e, k) : null;
      })(),
      project: (() => {
        const p = baselineFor(entries, ['project']);
        return p ? purchaseQuantityOf(p, k) : null;
      })(),
    };
  };

  /**
   * Сметный лимит конструктива в классе бетона `materialId` с учётом переездов.
   *
   * Ресурсная записывает лимит под одним классом, а действующий ДС закупает
   * конструктив другим или несколькими. Плита ЛПК: 1736 м3 в ресурсной как В25,
   * по ДС3 — В30, значит лимит В25 надо читать как лимит В30, иначе по одному
   * классу нарисуется экономия, а по другому — такой же перерасход, которых нет.
   * Стены ЛК/ЛШ: ресурсная — В30, ДС5 — КЖ0 на В30 и КЖ1 на В25; лимит делится
   * между классами пропорционально закупке по ДС5. Сумма по классам сохраняется.
   */
  const ownEstimate = (structureId: number, materialId: number, k: number): number | null => {
    const material = materialById.get(materialId);
    if (material?.kind !== 'concrete') return ownBaseline(structureId, materialId, k)?.estimate ?? null;

    const shares = contractShares(structureId);
    const sharesTotal = [...shares.values()].reduce((a, b) => a + b, 0);
    let result: number | null = null;
    for (const m of concreteMaterials) {
      const estimate = ownBaseline(structureId, m.id, k)?.estimate;
      if (estimate == null) continue;
      const portion =
        sharesTotal > 0 ? (estimate * (shares.get(materialId) ?? 0)) / sharesTotal : m.id === materialId ? estimate : 0;
      if (portion !== 0 || m.id === materialId) result = (result ?? 0) + portion;
    }
    return result;
  };

  /**
   * Конструктивный объём бетона узла.
   *
   * Считается по конструктивам, а не по классам бетона: у одной и той же плиты
   * ЛПК в смете стоит В25, а в ДС3 — В30, и суммирование по классам удвоило бы
   * её объём. Физический объём конструкции один, каким бы классом он ни закрывался.
   */
  const ownConcreteDesign = (structureId: number, k: number): number | null => {
    let best: number | null = null;
    let hasEstimateOnly = false;
    for (const m of concreteMaterials) {
      const own = ownBaseline(structureId, m.id, k);
      if (!own || own.superseded) continue;
      if (own.resolved.source === 'estimate') hasEstimateOnly = true;
      const design = own.design ?? null;
      if (design != null && (best == null || design > best)) best = design;
    }
    // Своя база только сметная, а у дочерних есть договор или проект — объём
    // берётся по дочерним: стены ЛК/ЛШ по ДС5 существуют только как КЖ0 и КЖ1.
    if (hasEstimateOnly && childrenHaveBase(structureId)) return null;
    return best;
  };

  const childrenHaveBase = (structureId: number): boolean =>
    (childrenOf.get(structureId) ?? []).some((child) =>
      concreteMaterials.some((m) => {
        const own = ownBaseline(child, m.id, 1);
        return (own && own.resolved.source !== 'estimate') || childrenHaveBase(child);
      }),
    );

  const concreteDesignOf = (structureId: number, k: number): number => {
    const own = ownConcreteDesign(structureId, k);
    if (own != null) return own;
    let total = 0;
    for (const child of childrenOf.get(structureId) ?? []) total += concreteDesignOf(child, k);
    return total;
  };

  /**
   * База сравнения узла: собственная, если она есть, иначе сумма дочерних.
   *
   * Складывать узел с его детьми нельзя: КЖ1 задаёт «Колонны на отм. −0,080»
   * (74,14 м3) захваткой колонн, у которых по ДС своя база 813,75 м3. Сумма дала
   * бы конструктив, которого не существует. Исключение — когда своя база только
   * сметная, а дочерние опираются на договор или проект: тогда точнее дочерние.
   */
  type Rollup = {
    resolved: ResolvedBaseline | null;
    design: number | null;
    purchase: number | null;
    estimate: number | null;
    estimateOriginal: number | null;
    project: number | null;
    superseded: boolean;
  };
  const rollupMemo = new Map<string, Rollup>();
  const rollupBaseline = (structureId: number, materialId: number, k: number): Rollup => {
    const memoKey = `${structureId}:${materialId}:${k}`;
    const cached = rollupMemo.get(memoKey);
    if (cached) return cached;

    const own = ownBaseline(structureId, materialId, k);
    const estimateHere = ownEstimate(structureId, materialId, k);

    let anyLive = false;
    let anyAtAll = false;
    let design: number | null = null;
    let purchase: number | null = null;
    let estimate: number | null = estimateHere;
    let estimateOriginal: number | null = own?.estimate ?? null;
    let project: number | null = null;
    let resolved: ResolvedBaseline | null = null;

    for (const child of childrenOf.get(structureId) ?? []) {
      const r = rollupBaseline(child, materialId, k);
      if (r.resolved) {
        anyAtAll = true;
        if (!r.superseded) anyLive = true;
      }
      // Сметный лимит суммируется в двух разрезах: estimateOriginal — как в
      // ресурсной, для сверки итогов; estimate — с учётом переездов между
      // классами, и именно он служит лимитом для прогноза.
      if (r.estimate != null) estimate = (estimate ?? 0) + r.estimate;
      if (r.estimateOriginal != null) estimateOriginal = (estimateOriginal ?? 0) + r.estimateOriginal;
      // В базу для прогноза вытесненная строка не идёт: конструктив теперь
      // закрывается другим классом, и учёт его объёма был бы двойным.
      if (r.superseded) continue;
      if (r.design != null) design = (design ?? 0) + r.design;
      if (r.purchase != null) purchase = (purchase ?? 0) + r.purchase;
      if (r.project != null) project = (project ?? 0) + r.project;
      // Точность узла определяется худшей из вошедших баз: если хоть один
      // конструктив опирается на смету, весь итог оценочный.
      if (r.resolved) {
        resolved = resolved == null || (!resolved.isEstimated && r.resolved.isEstimated) ? r.resolved : resolved;
      }
    }

    const childrenBetter = resolved != null && resolved.source !== 'estimate';
    let result: Rollup;
    if (own && !(own.resolved.source === 'estimate' && childrenBetter)) {
      // Своя строка есть и она не хуже дочерних. Если она вытеснена, её сметный
      // лимит уходит в другой класс, но остаётся в estimateOriginal для сверки.
      result = {
        resolved: own.resolved,
        design: own.design,
        purchase: own.purchase,
        project: own.project,
        superseded: own.superseded,
        estimate,
        estimateOriginal,
      };
    } else {
      result = {
        resolved,
        design,
        purchase,
        project,
        superseded: own ? own.superseded : anyAtAll && !anyLive,
        estimate,
        estimateOriginal,
      };
    }
    rollupMemo.set(memoKey, result);
    return result;
  };

  // ── Индексы факта ───────────────────────────────────────────────────────
  const pourStructure = new Map(pourRows.map((p) => [p.id, p.structureId]));
  /** Конструктив, на который разнесён приход: напрямую или через захватку. */
  const deliveryStructure = (d: (typeof deliveryRows)[number]) =>
    d.structureId ?? (d.pourId != null ? (pourStructure.get(d.pourId) ?? null) : null);

  const tierOfStructure = new Map(structureRows.map((s) => [s.id, s.tierId]));
  const deliveryTier = (d: (typeof deliveryRows)[number]) => {
    const sid = deliveryStructure(d);
    return sid != null ? (tierOfStructure.get(sid) ?? d.tierId) : d.tierId;
  };

  const push = <T,>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  const deliveriesByStructureMaterial = new Map<string, typeof deliveryRows>();
  const deliveriesByMaterial = new Map<number, typeof deliveryRows>();
  const unallocatedIncoming = new Map<number, number>();
  for (const d of deliveryRows) {
    const byMat = deliveriesByMaterial.get(d.materialId) ?? [];
    byMat.push(d);
    deliveriesByMaterial.set(d.materialId, byMat);

    const sid = deliveryStructure(d);
    if (sid != null) push(deliveriesByStructureMaterial, `${sid}:${d.materialId}`, d);
    else if (d.tierId == null) {
      unallocatedIncoming.set(d.materialId, (unallocatedIncoming.get(d.materialId) ?? 0) + n(d.quantity));
    }
  }

  const issuesByStructureMaterial = new Map<string, typeof issueRows>();
  for (const i of issueRows) push(issuesByStructureMaterial, `${i.structureId}:${i.materialId}`, i);

  const closingsByStructureMaterial = new Map<string, typeof closingRows>();
  for (const c of closingRows) push(closingsByStructureMaterial, `${c.structureId}:${c.materialId}`, c);

  const poursDoneDesign = new Map<string, number>();
  for (const p of pourRows) {
    if (p.status !== 'done') continue;
    const key = `${p.structureId}:${p.concreteMaterialId}`;
    poursDoneDesign.set(key, (poursDoneDesign.get(key) ?? 0) + n(p.designVolumeM3));
  }

  /**
   * Выполненный конструктивный объём конструктива в классе бетона. Берётся
   * бо́льшее из двух: закрытое по процентовке и залитое по захваткам прораба —
   * захватка опережает процентовку на месяц, а процентовка покрывает историю,
   * когда захваток в системе ещё не было.
   */
  const completedOwn = (structureId: number, materialId: number): number => {
    const closed = (closingsByStructureMaterial.get(`${structureId}:${materialId}`) ?? []).reduce(
      (acc, c) => acc + n(c.designQuantity),
      0,
    );
    return Math.max(closed, poursDoneDesign.get(`${structureId}:${materialId}`) ?? 0);
  };
  const concreteCompletedOwn = (structureId: number) =>
    concreteMaterials.reduce((acc, m) => acc + completedOwn(structureId, m.id), 0);

  const kConcrete = kNorm('concrete', undefined, normOverrides);
  const kRebar = kNorm('rebar', undefined, normOverrides);
  const rebarAggregate = materialList.find((m) => m.isAggregate) ?? null;

  /**
   * Проектная армированность конструктива, т арматуры на м3 бетона: своя база,
   * а без неё — ближайшего родителя. Выполнение по арматуре считается от неё,
   * а не от средней по строке КС-6а: колонны на −0,080 армированы на 369 кг/м3,
   * а в среднем по строке 3.2.1 — 250, и средняя завысила бы К_факт в полтора раза.
   */
  const rebarRatioMemo = new Map<number, number | null>();
  const rebarPerConcrete = (structureId: number): number | null => {
    if (rebarRatioMemo.has(structureId)) return rebarRatioMemo.get(structureId)!;
    let ratio: number | null = null;
    if (rebarAggregate) {
      const r = rollupBaseline(structureId, rebarAggregate.id, kRebar);
      const c = concreteDesignOf(structureId, kConcrete);
      if (r.design != null && !r.superseded && c > 0) ratio = r.design / c;
    }
    if (ratio == null) {
      const parent = byId.get(structureId)?.parentId;
      ratio = parent != null ? rebarPerConcrete(parent) : null;
    }
    rebarRatioMemo.set(structureId, ratio);
    return ratio;
  };

  const factInput: FactIndex = {
    deliveriesByStructureMaterial,
    issuesByStructureMaterial,
    closingsByStructureMaterial,
    completedOwn,
    concreteCompletedOwn,
    rebarPerConcrete,
    factMaterialIds,
  };

  // ── Сборка отчёта по конструктивам ──────────────────────────────────────
  const byStructure = new Map<number, StructureReport>();

  for (const s of structureList) {
    // Прогресс по бетону — общая для узла доля выполнения. Арматура опирается
    // на неё же: каркас вяжется под тот объём, который бетонируется.
    const concreteDesignCompleted = s.subtree.reduce((acc, sid) => acc + concreteCompletedOwn(sid), 0);
    const concreteDesignTotal = concreteDesignOf(s.id, kConcrete);
    const concreteProgress =
      concreteDesignTotal > 0 ? Math.min(concreteDesignCompleted / concreteDesignTotal, 1) : null;

    const cells: Cell[] = [];
    for (const material of materialList) {
      const cell = buildCell({
        material,
        rootId: s.id,
        structureIds: s.subtree,
        rollupBaseline,
        normOverrides,
        costOf,
        fact: factInput,
        concreteProgress,
        concreteDesignCompleted,
        concreteDesignTotal,
      });
      if (cell) cells.push(cell);
    }

    byStructure.set(s.id, { structure: s, concreteProgress, concreteDesignTotal, concreteDesignCompleted, cells });
  }

  // ── Сводка по объекту (остаточная таблица) ──────────────────────────────
  const allStructureIds = structureList.map((s) => s.id);
  const objectCompleted = allStructureIds.reduce((acc, sid) => acc + concreteCompletedOwn(sid), 0);
  const rootIds = structureList.filter((s) => s.parentId == null).map((s) => s.id);
  const objectConcreteDesign = rootIds.reduce((acc, rootId) => acc + concreteDesignOf(rootId, kConcrete), 0);
  const objectProgress = objectConcreteDesign > 0 ? Math.min(objectCompleted / objectConcreteDesign, 1) : null;

  const totals: Cell[] = [];
  for (const material of materialList) {
    const cell = buildCell({
      material,
      rootId: rootIds[0],
      structureIds: allStructureIds,
      rollupBaseline,
      normOverrides,
      costOf,
      fact: factInput,
      concreteProgress: objectProgress,
      concreteDesignCompleted: objectCompleted,
      concreteDesignTotal: objectConcreteDesign,
      allDeliveriesByMaterial: deliveriesByMaterial,
    });
    if (cell) totals.push(cell);
  }

  // ── Разрез по ярусам — лист «приходы» ───────────────────────────────────
  const latestProject = (entries: { revision: string; effectiveFrom: string; designQuantity: string | null }[]) =>
    entries.reduce<(typeof entries)[number] | null>(
      (acc, b) => (acc == null || b.effectiveFrom.localeCompare(acc.effectiveFrom) > 0 ? b : acc),
      null,
    );
  const projectBy = new Map<string, typeof baselineRows>();
  for (const b of baselineRows) {
    if (b.source !== 'project') continue;
    push(projectBy, b.structureId != null ? `s${b.structureId}:${b.materialId}` : `t${b.tierId}:${b.materialId}`, b);
  }
  /** Проект по последнему выпуску КЖ; у агрегата арматуры при отсутствии своей строки — сумма SKU. */
  const projectOf = (prefix: string, m: MaterialInfo): { value: number; revision: string } | null => {
    const own = latestProject(projectBy.get(`${prefix}:${m.id}`) ?? []);
    if (own) return { value: n(own.designQuantity), revision: own.revision };
    if (!m.isAggregate) return null;
    let total: number | null = null;
    let revision: string | null = null;
    for (const skuId of skusOf.get(m.id) ?? []) {
      const sku = latestProject(projectBy.get(`${prefix}:${skuId}`) ?? []);
      if (!sku) continue;
      total = (total ?? 0) + n(sku.designQuantity);
      revision = sku.revision;
    }
    return total != null ? { value: total, revision: revision! } : null;
  };

  const kOf = (m: MaterialInfo) => kNorm(m.kind, undefined, normOverrides);
  const sumQty = (rows: { quantity: string }[] | undefined) => (rows ?? []).reduce((a, r) => a + n(r.quantity), 0);

  const byTier: TierReport[] = tierList.map((tier) => {
    const members = structureList.filter((s) => s.tierId === tier.id);
    const memberIds = new Set(members.map((s) => s.id));

    const tierDeliveries = deliveryRows.filter((d) => deliveryTier(d) === tier.id);
    const tierOnlyIncoming = new Map<number, number>();
    for (const d of tierDeliveries) {
      const sid = deliveryStructure(d);
      if (sid != null && memberIds.has(sid)) continue;
      tierOnlyIncoming.set(d.materialId, (tierOnlyIncoming.get(d.materialId) ?? 0) + n(d.quantity));
    }

    const blockRows = (s: StructureInfo): TierRow[] =>
      materialList
        .map((m) => {
          const ids = factMaterialIds(m);
          const project = projectOf(`s${s.id}`, m);
          const incomingQty = ids.reduce((a, id) => a + sumQty(deliveriesByStructureMaterial.get(`${s.id}:${id}`)), 0);
          const closedQty = ids.reduce((a, id) => a + sumQty(closingsByStructureMaterial.get(`${s.id}:${id}`)), 0);
          return {
            material: m,
            project: project?.value ?? null,
            projectRevision: project?.revision ?? null,
            projectWithK: project ? project.value * kOf(m) : null,
            incoming: incomingQty,
            closed: closedQty,
          };
        })
        .filter((r) => r.project != null || r.incoming !== 0 || r.closed !== 0);

    const blocks = members.map((s) => ({ structure: s, rows: blockRows(s) }));

    const rows: TierRow[] = materialList
      .map((m) => {
        const ids = factMaterialIds(m);
        // Ярусная база (проект КЖ0 с листа) важнее суммы захваток: она полная,
        // а захватки КЖ0 своих ведомостей не имеют.
        let project = projectOf(`t${tier.id}`, m);
        if (!project) {
          let total: number | null = null;
          let revision: string | null = null;
          for (const b of blocks) {
            const r = b.rows.find((x) => x.material.id === m.id);
            if (r?.project == null) continue;
            total = (total ?? 0) + r.project;
            revision = r.projectRevision;
          }
          project = total != null ? { value: total, revision: revision! } : null;
        }
        const incomingQty = tierDeliveries
          .filter((d) => ids.includes(d.materialId))
          .reduce((a, d) => a + n(d.quantity), 0);
        const closedQty = blocks.reduce((a, b) => a + (b.rows.find((x) => x.material.id === m.id)?.closed ?? 0), 0);
        return {
          material: m,
          project: project?.value ?? null,
          projectRevision: project?.revision ?? null,
          projectWithK: project ? project.value * kOf(m) : null,
          incoming: incomingQty,
          closed: closedQty,
        };
      })
      .filter((r) => r.project != null || r.incoming !== 0 || r.closed !== 0);

    return { tier, rows, tierOnlyIncoming, blocks };
  });

  // Поиск конфликтов класса: проектная база дочернего конструктива против
  // договорной базы родителя.
  const classConflicts: ClassConflict[] = [];
  for (const s of structureList) {
    const projectConcrete = structureBaselines.filter(
      (b) =>
        b.structureId === s.id && b.source === 'project' && materialById.get(b.materialId)?.kind === 'concrete',
    );
    if (projectConcrete.length === 0 || s.parentId == null) continue;
    const parentContract = contractShares(s.parentId);
    if (parentContract.size === 0) continue;
    const parent = structureList.find((x) => x.id === s.parentId);
    // Конфликт — только по последнему выпуску КЖ: исправленный проектом класс
    // в прошлых выпусках конфликтом уже не является.
    const latest = latestProject(projectConcrete);
    for (const b of projectConcrete.filter((x) => x.revision === latest?.revision)) {
      if (parentContract.has(b.materialId)) continue;
      for (const contractMaterialId of parentContract.keys()) {
        classConflicts.push({
          structureCode: s.code,
          structureName: s.name,
          parentCode: parent?.code ?? null,
          projectMaterial: materialById.get(b.materialId)?.name ?? '—',
          contractMaterial: materialById.get(contractMaterialId)?.name ?? '—',
          revision: b.revision,
        });
      }
    }
  }

  return {
    structures: structureList,
    tiers: tierList,
    byStructure,
    byTier,
    totals,
    materials: materialList,
    unallocatedIncoming,
    classConflicts,
    generatedAt: new Date(),
  };
}

interface FactIndex {
  deliveriesByStructureMaterial: Map<string, { quantity: string }[]>;
  issuesByStructureMaterial: Map<string, { quantity: string }[]>;
  closingsByStructureMaterial: Map<string, { quantity: string }[]>;
  completedOwn: (structureId: number, materialId: number) => number;
  concreteCompletedOwn: (structureId: number) => number;
  rebarPerConcrete: (structureId: number) => number | null;
  factMaterialIds: (m: MaterialInfo) => number[];
}

interface CellInput {
  material: MaterialInfo;
  /** Узел, для которого собирается строка. */
  rootId: number;
  /** Узел и все вложенные — по ним агрегируется факт. */
  structureIds: number[];
  rollupBaseline: (
    structureId: number,
    materialId: number,
    k: number,
  ) => {
    resolved: ResolvedBaseline | null;
    design: number | null;
    purchase: number | null;
    estimate: number | null;
    estimateOriginal: number | null;
    project: number | null;
    superseded: boolean;
  };
  normOverrides: { materialKind: MaterialKind; structureKind: StructureKind | null; kLoss: number }[];
  costOf: Map<number, number>;
  fact: FactIndex;
  concreteProgress: number | null;
  /** Полный конструктивный объём бетона узла — знаменатель проектного кг/м3. */
  concreteDesignTotal: number;
  /** Забетонированный объём узла по всем классам — для удельного армирования. */
  concreteDesignCompleted: number;
  /** Весь приход по материалам — только у сводки по объекту. */
  allDeliveriesByMaterial?: Map<number, { quantity: string; structureId: number | null; pourId: number | null }[]>;
}

function buildCell(input: CellInput): Cell | null {
  const {
    material,
    rootId,
    structureIds,
    rollupBaseline,
    normOverrides,
    costOf,
    fact,
    concreteProgress,
    concreteDesignCompleted,
    concreteDesignTotal,
    allDeliveriesByMaterial,
  } = input;

  const k = kNorm(material.kind, undefined, normOverrides);
  const base = rollupBaseline(rootId, material.id, k);
  // Арматура приходит и списывается по SKU (12-А500, 25-А500…), а сравнивается
  // со сметой общим тоннажом: факт агрегатной позиции — сумма её SKU.
  const ids = fact.factMaterialIds(material);

  const own = (sid: number) => ({
    deliveries: ids.flatMap((id) => fact.deliveriesByStructureMaterial.get(`${sid}:${id}`) ?? []),
    issues: ids.flatMap((id) => fact.issuesByStructureMaterial.get(`${sid}:${id}`) ?? []),
    closings: ids.flatMap((id) => fact.closingsByStructureMaterial.get(`${sid}:${id}`) ?? []),
  });
  const perStructure = structureIds.map((sid) => ({ sid, ...own(sid) }));

  const allocated = perStructure.flatMap((p) => p.deliveries);
  const issueRecords = perStructure.flatMap((p) => p.issues);
  const closed = perStructure.flatMap((p) => p.closings).reduce((a, c) => a + n(c.quantity), 0);

  // У сводки по объекту берётся весь приход материала — иначе непривязанные
  // поставки исчезнут из таблицы вместе с неподтверждённым расходом.
  const objectDeliveries = allDeliveriesByMaterial
    ? ids.flatMap((id) => allDeliveriesByMaterial.get(id) ?? [])
    : null;

  // Позиции без базы и без движения в отчёт не попадают, иначе таблица
  // забивается пустыми строками справочника. Вытесненные строки остаются
  // видимыми: у них есть сметный лимит, и его переезд в другой класс нужно
  // показать, а не спрятать.
  if (
    base.design == null &&
    base.estimate == null &&
    (objectDeliveries ?? allocated).length === 0 &&
    issueRecords.length === 0 &&
    closed === 0
  ) {
    return null;
  }

  const balance = objectDeliveries
    ? computeBalance({
        materialKind: material.kind,
        deliveries: objectDeliveries.map((d) => ({
          quantity: n(d.quantity),
          allocated: d.structureId != null || d.pourId != null,
        })),
        issues: issueRecords.map((i) => ({ quantity: n(i.quantity) })),
      })
    : computeBalance({
        materialKind: material.kind,
        scope: 'structure',
        deliveries: allocated.map((d) => ({ quantity: n(d.quantity), allocated: true })),
        issues: issueRecords.map((i) => ({ quantity: n(i.quantity) })),
      });

  // Выполненная часть считается в единицах самого материала.
  // Бетон: выполненный объём именно этого класса — делить списанный В7,5 на
  // весь забетонированный объём объекта нельзя.
  // Арматура общим тоннажом: забетонированный объём каждого конструктива,
  // умноженный на его проектную армированность. По отдельным диаметрам —
  // проектная масса, приходящаяся на забетонированную долю.
  let completedDesign = 0;
  if (material.kind === 'concrete') {
    completedDesign = structureIds.reduce((acc, sid) => acc + fact.completedOwn(sid, material.id), 0);
  } else if (material.isAggregate) {
    completedDesign = structureIds.reduce(
      (acc, sid) => acc + fact.concreteCompletedOwn(sid) * (fact.rebarPerConcrete(sid) ?? 0),
      0,
    );
  } else if (base.design != null && concreteProgress != null) {
    completedDesign = base.design * concreteProgress;
  }

  // Списание на конструктивы, где выполнения ещё нет, в К_факт не идёт.
  const hasCompletion = (sid: number) =>
    material.kind === 'concrete' ? fact.completedOwn(sid, material.id) > 0 : fact.concreteCompletedOwn(sid) > 0;
  const consumedCompleted = perStructure
    .filter((p) => hasCompletion(p.sid))
    .reduce((acc, p) => acc + [...p.deliveries, ...p.issues].reduce((a, r) => a + n(r.quantity), 0), 0);
  const inProgress = balance.consumed - consumedCompleted;
  const forecastBalance: Balance = { ...balance, consumed: consumedCompleted };

  const variance = computeVariance({
    projectPurchase: base.project,
    estimatePurchase: base.estimate,
    completedDesign,
    k,
    balance: forecastBalance,
  });

  // Прогноз строится только там, где списание вообще отслеживается: для бетона
  // и для арматуры в целом. По отдельным диаметрам КС-6а не закрывает, поэтому
  // SKU показываются как складские позиции: приход, склад, проектная потребность.
  const forecastable = (material.kind === 'concrete' || material.isAggregate) && !base.superseded;

  const forecast = forecastable
    ? computeForecast({
        baseDesign: base.design,
        completedDesign,
        estimatePurchase: base.estimate,
        k,
        balance: forecastBalance,
        unitCost: costOf.get(material.id) ?? null,
      })
    : {
        progress: null,
        kActual: null,
        total: null,
        overrunVsEstimate: null,
        overrunVsNorm: null,
        overrunCost: null,
        verdict: 'unknown' as const,
        confidence: 'preliminary' as const,
      };

  const specificKgPerM3 =
    material.kind === 'rebar' && concreteDesignCompleted > 0
      ? specificReinforcement(consumedCompleted, concreteDesignCompleted)
      : null;
  const designSpecificKgPerM3 =
    material.kind === 'rebar' && base.design != null && concreteDesignTotal > 0
      ? specificReinforcement(base.design, concreteDesignTotal)
      : null;

  return {
    material,
    base: base.resolved,
    superseded: base.superseded,
    baseDesign: base.design,
    basePurchase: base.purchase,
    estimatePurchase: base.estimate,
    estimateOriginal: base.estimateOriginal ?? base.estimate,
    projectPurchase: base.project,
    completedDesign,
    k,
    unitCost: costOf.get(material.id) ?? null,
    balance,
    closed,
    inProgress,
    variance,
    forecast,
    specificKgPerM3,
    designSpecificKgPerM3,
    specificRatio: reinforcementRatio(specificKgPerM3, designSpecificKgPerM3),
  };
}
