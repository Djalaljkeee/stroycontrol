// Без 'server-only': модуль используется и серверными компонентами, и скриптами
// проверки/экспорта, запускаемыми через tsx. От попадания в клиентский бандл
// защищает импорт '@/db', который требует DATABASE_URL.
import { db } from '@/db';
import {
  baselines,
  deliveries,
  issues,
  materials,
  norms,
  pours,
  prices,
  structures,
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

export interface StructureInfo {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  kind: StructureKind;
  level: string | null;
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

export interface Report {
  structures: StructureInfo[];
  byStructure: Map<number, StructureReport>;
  /** Сводка по объекту целиком — она же остаточная таблица. */
  totals: Cell[];
  materials: MaterialInfo[];
  /**
   * Проект задаёт конструктиву один класс бетона, а действующий ДС закупает
   * другой. Пример: КЖ1-01 задаёт стенам на отм. −0,080 класс В25, а строка
   * 3.2.8 КС-6а закупает на стены ЛК/ЛШ В30. Такие расхождения нельзя
   * разрешить автоматически — их подтверждает сметчик.
   */
  classConflicts: ClassConflict[];
  generatedAt: Date;
}

/** Загружает всё и считает отчёт целиком: объём данных пилота это позволяет. */
export async function buildReport(): Promise<Report> {
  const [
    structureRows,
    materialRows,
    baselineRows,
    normRows,
    priceRows,
    pourRows,
    deliveryRows,
    issueRows,
  ] = await Promise.all([
    db.select().from(structures).orderBy(structures.sortOrder),
    db.select().from(materials).orderBy(materials.id),
    db.select().from(baselines),
    db.select().from(norms),
    db.select().from(prices),
    db.select().from(pours),
    db.select().from(deliveries),
    db.select().from(issues),
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

  // Какие SKU сворачиваются в агрегатную позицию арматуры.
  const skusOf = new Map<number, number[]>();
  for (const m of materialList) {
    if (m.aggregateId == null) continue;
    const list = skusOf.get(m.aggregateId) ?? [];
    list.push(m.id);
    skusOf.set(m.aggregateId, list);
  }

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
    sortOrder: s.sortOrder,
    depth: depth(s.id),
    subtree: subtreeOf(s.id),
  }));

  // ── Индексы факта ───────────────────────────────────────────────────────
  const normOverrides = normRows.map((r) => ({
    materialKind: r.materialKind as MaterialKind,
    structureKind: (r.structureKind as StructureKind | null) ?? null,
    kLoss: n(r.kLoss),
  }));

  const costOf = new Map<number, number>();
  for (const p of priceRows) {
    if (p.layer === 'cost') costOf.set(p.materialId, n(p.value));
  }

  // Договорная база берётся только из действующей редакции ДС. Прошлые редакции
  // остаются в базе для экрана «Редакции», но в расчёт не идут: иначе плита ЛПК
  // учитывается дважды — как В25 по ДС2 и как В30 по ДС3.
  const currentContractRevision = baselineRows
    .filter((b) => b.source === 'contract')
    .reduce<{ revision: string; effectiveFrom: string } | null>(
      (acc, b) =>
        acc == null || b.effectiveFrom.localeCompare(acc.effectiveFrom) > 0
          ? { revision: b.revision, effectiveFrom: b.effectiveFrom }
          : acc,
      null,
    )?.revision ?? null;

  const baselineIndex = new Map<string, BaselineEntry[]>();
  for (const b of baselineRows) {
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
   * База сравнения узла: собственная, если она есть, иначе сумма дочерних.
   *
   * Складывать узел с его детьми нельзя: КЖ1-01 задаёт 'Колонны на отм. −0,080'
   * (75,66 м3) как дочерний конструктив колонн, у которых по ДС3 своя база
   * 813,75 м3. Сумма дала бы 889,41 м3 — конструктив, которого не существует.
   */
  /**
   * Класс бетона, которым конструктив закрывается по действующему ДС.
   * Если действующая редакция назначила конструктиву В30, то его же строка
   * под В25 — история: лимит никуда не делся, он переехал в другой класс.
   */
  const currentConcreteMaterials = (structureId: number): Set<number> => {
    const set = new Set<number>();
    for (const b of baselineRows) {
      if (b.structureId !== structureId) continue;
      if (b.source !== 'contract' || b.revision !== currentContractRevision) continue;
      const m = materialById.get(b.materialId);
      if (m?.kind === 'concrete') set.add(b.materialId);
    }
    return set;
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
    const current = material?.kind === 'concrete' ? currentConcreteMaterials(structureId) : null;
    const superseded = current != null && current.size > 0 && !current.has(materialId);
    // Лимит вытесненной строки не исчезает, а переезжает в класс, которым
    // конструктив закрывается по действующему ДС.
    const transferTo = superseded && current != null ? [...current] : [];

    return {
      superseded,
      transferTo,
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
   * Конструктивный объём бетона узла.
   *
   * Считается по конструктивам, а не по классам бетона: у одной и той же плиты
   * ЛПК в смете стоит В25, а в ДС3 — В30, и суммирование по классам удвоило бы
   * её объём. Физический объём конструкции один, каким бы классом он ни закрывался.
   */
  const ownConcreteDesign = (structureId: number, k: number): number | null => {
    let best: number | null = null;
    for (const m of materialList) {
      if (m.kind !== 'concrete') continue;
      const own = ownBaseline(structureId, m.id, k);
      if (own?.superseded) continue;
      const design = own?.design ?? null;
      if (design != null && (best == null || design > best)) best = design;
    }
    return best;
  };

  const concreteDesignOf = (structureId: number, k: number): number => {
    const own = ownConcreteDesign(structureId, k);
    if (own != null) return own;
    let total = 0;
    for (const child of childrenOf.get(structureId) ?? []) total += concreteDesignOf(child, k);
    return total;
  };

  /**
   * Сметный лимит, переехавший в этот класс с вытесненных строк того же
   * конструктива. Плита ЛПК: в ресурсной её 1736 м3 записаны как В25, а по ДС3
   * она заливается В30 — значит лимит В25 надо читать как лимит В30, иначе по
   * одному классу нарисуется экономия 1736 м3, а по другому — такой же
   * перерасход, которых в действительности нет.
   */
  const incomingTransfer = (structureId: number, materialId: number, k: number): number => {
    let total = 0;
    for (const m of materialList) {
      if (m.kind !== 'concrete' || m.id === materialId) continue;
      const other = ownBaseline(structureId, m.id, k);
      if (!other?.superseded) continue;
      if (!other.transferTo.includes(materialId)) continue;
      total += other.estimate ?? 0;
    }
    return total;
  };

  const rollupBaseline = (
    structureId: number,
    materialId: number,
    k: number,
  ): {
    resolved: ResolvedBaseline | null;
    design: number | null;
    purchase: number | null;
    estimate: number | null;
    estimateOriginal: number | null;
    project: number | null;
    superseded: boolean;
  } => {
    const own = ownBaseline(structureId, materialId, k);
    if (own) {
      // Своя строка есть. Если она вытеснена, её сметный лимит уходит в другой
      // класс, поэтому в расчёт он не идёт — но остаётся в estimateOriginal
      // для сверки с ресурсной.
      const incoming = incomingTransfer(structureId, materialId, k);
      return {
        ...own,
        estimate: own.superseded ? incoming : (own.estimate ?? 0) + incoming || own.estimate,
        estimateOriginal: own.estimate,
      };
    }

    // Своей строки нет — но переехавший лимит мог прийти именно сюда.
    const incoming = incomingTransfer(structureId, materialId, k);

    let anyLive = false;
    let anyAtAll = false;
    let design: number | null = null;
    let purchase: number | null = null;
    let estimate: number | null = incoming > 0 ? incoming : null;
    let estimateOriginal: number | null = null;
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
    return {
      resolved,
      design,
      purchase,
      estimate,
      estimateOriginal,
      project,
      superseded: anyAtAll && !anyLive,
    };
  };

  const poursByStructure = new Map<number, typeof pourRows>();
  for (const p of pourRows) {
    const list = poursByStructure.get(p.structureId) ?? [];
    list.push(p);
    poursByStructure.set(p.structureId, list);
  }

  // Приход материала к конструктиву привязывается только через захватку:
  // ТТН адресуется захватке, а не конструкции напрямую.
  const pourStructure = new Map(pourRows.map((p) => [p.id, p.structureId]));
  const deliveriesByStructureMaterial = new Map<string, typeof deliveryRows>();
  const deliveriesByMaterial = new Map<number, typeof deliveryRows>();
  for (const d of deliveryRows) {
    const byMat = deliveriesByMaterial.get(d.materialId) ?? [];
    byMat.push(d);
    deliveriesByMaterial.set(d.materialId, byMat);

    const sid = d.pourId != null ? pourStructure.get(d.pourId) : undefined;
    if (sid == null) continue;
    const key = `${sid}:${d.materialId}`;
    const list = deliveriesByStructureMaterial.get(key) ?? [];
    list.push(d);
    deliveriesByStructureMaterial.set(key, list);
  }

  const issuesByStructureMaterial = new Map<string, typeof issueRows>();
  for (const i of issueRows) {
    const key = `${i.structureId}:${i.materialId}`;
    const list = issuesByStructureMaterial.get(key) ?? [];
    list.push(i);
    issuesByStructureMaterial.set(key, list);
  }

  // ── Сборка отчёта по конструктивам ──────────────────────────────────────
  const byStructure = new Map<number, StructureReport>();

  for (const s of structureList) {
    // Прогресс по бетону — общая для узла доля выполнения. Арматура опирается
    // на неё же: каркас вяжется под тот объём, который бетонируется.
    let concreteDesignTotal = 0;
    let concreteDesignCompleted = 0;
    const kConcrete = kNorm('concrete', undefined, normOverrides);

    for (const sid of s.subtree) {
      for (const p of poursByStructure.get(sid) ?? []) {
        if (p.status === 'done') concreteDesignCompleted += n(p.designVolumeM3);
      }
    }
    concreteDesignTotal = concreteDesignOf(s.id, kConcrete);

    const concreteProgress =
      concreteDesignTotal > 0
        ? Math.min(concreteDesignCompleted / concreteDesignTotal, 1)
        : null;

    const cells: Cell[] = [];
    for (const material of materialList) {
      const cell = buildCell({
        material,
        rootId: s.id,
        structureIds: s.subtree,
        rollupBaseline,
        normOverrides,
        costOf,
        poursByStructure,
        deliveriesByStructureMaterial,
        issuesByStructureMaterial,
        skuIdsOfAggregate: skusOf.get(material.id) ?? [],
        concreteProgress,
        concreteDesignCompleted,
        concreteDesignTotal,
      });
      if (cell) cells.push(cell);
    }

    byStructure.set(s.id, {
      structure: s,
      concreteProgress,
      concreteDesignTotal,
      concreteDesignCompleted,
      cells,
    });
  }

  // ── Сводка по объекту (остаточная таблица) ──────────────────────────────
  const allStructureIds = structureList.map((s) => s.id);
  const objectCompleted = pourRows
    .filter((p) => p.status === 'done')
    .reduce((acc, p) => acc + n(p.designVolumeM3), 0);
  const rootIds = structureList.filter((s) => s.parentId == null).map((s) => s.id);
  const kConcreteObject = kNorm('concrete', undefined, normOverrides);
  const objectConcreteDesign = rootIds.reduce(
    (acc, rootId) => acc + concreteDesignOf(rootId, kConcreteObject),
    0,
  );
  const objectProgress =
    objectConcreteDesign > 0 ? Math.min(objectCompleted / objectConcreteDesign, 1) : null;

  const totals: Cell[] = [];
  for (const material of materialList) {
    const cell = buildCell({
      material,
      rootId: rootIds[0],
      structureIds: allStructureIds,
      rollupBaseline,
      normOverrides,
      costOf,
      poursByStructure,
      deliveriesByStructureMaterial,
      issuesByStructureMaterial,
      skuIdsOfAggregate: skusOf.get(material.id) ?? [],
      concreteProgress: objectProgress,
      concreteDesignCompleted: objectCompleted,
      concreteDesignTotal: objectConcreteDesign,
      allDeliveriesByMaterial: deliveriesByMaterial,
    });
    if (cell) totals.push(cell);
  }

  // Поиск конфликтов класса: проектная база дочернего конструктива против
  // договорной базы родителя.
  const classConflicts: ClassConflict[] = [];
  for (const s of structureList) {
    const projectConcrete = baselineRows.filter(
      (b) =>
        b.structureId === s.id &&
        b.source === 'project' &&
        materialById.get(b.materialId)?.kind === 'concrete',
    );
    if (projectConcrete.length === 0 || s.parentId == null) continue;
    const parentContract = currentConcreteMaterials(s.parentId);
    if (parentContract.size === 0) continue;
    for (const b of projectConcrete) {
      if (parentContract.has(b.materialId)) continue;
      const parent = structureList.find((x) => x.id === s.parentId);
      for (const contractMaterialId of parentContract) {
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
    byStructure,
    totals,
    materials: materialList,
    classConflicts,
    generatedAt: new Date(),
  };
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
  poursByStructure: Map<number, { id: number; status: string; designVolumeM3: string | null; concreteMaterialId: number }[]>;
  deliveriesByStructureMaterial: Map<string, { quantity: string | null; pourId: number | null }[]>;
  issuesByStructureMaterial: Map<string, { quantity: string | null }[]>;
  /** Приход по SKU, сворачиваемый в агрегатную позицию арматуры. */
  skuIdsOfAggregate: number[];
  concreteProgress: number | null;
  /** Полный конструктивный объём бетона узла — знаменатель проектного кг/м3. */
  concreteDesignTotal: number;
  /** Забетонированный объём узла по всем классам — для удельного армирования. */
  concreteDesignCompleted: number;
  allDeliveriesByMaterial?: Map<number, { quantity: string | null; pourId: number | null }[]>;
}

function buildCell(input: CellInput): Cell | null {
  const {
    material,
    rootId,
    structureIds,
    rollupBaseline,
    normOverrides,
    costOf,
    poursByStructure,
    deliveriesByStructureMaterial,
    issuesByStructureMaterial,
    skuIdsOfAggregate,
    concreteProgress,
    concreteDesignCompleted,
    concreteDesignTotal,
    allDeliveriesByMaterial,
  } = input;

  const k = kNorm(material.kind, undefined, normOverrides);
  const base = rollupBaseline(rootId, material.id, k);

  // Приход. Обычно он привязан к конструктиву через захватку, но у сводки по
  // объекту берётся весь приход материала — иначе непривязанные поставки
  // исчезнут из таблицы вместе с неподтверждённым расходом, ради которого
  // всё и затевалось.
  const collectDeliveries = (materialId: number) =>
    allDeliveriesByMaterial
      ? (allDeliveriesByMaterial.get(materialId) ?? [])
      : structureIds.flatMap(
          (sid) => deliveriesByStructureMaterial.get(`${sid}:${materialId}`) ?? [],
        );

  // Арматура приходит по SKU (12-А500, 25-А500…), а списывается и сравнивается
  // со сметой в тоннаже без разбивки. Поэтому приход агрегатной позиции — это
  // сумма прихода её SKU.
  const deliveryRecords = material.isAggregate
    ? [...collectDeliveries(material.id), ...skuIdsOfAggregate.flatMap(collectDeliveries)]
    : collectDeliveries(material.id);

  const issueRecords = structureIds.flatMap(
    (sid) => issuesByStructureMaterial.get(`${sid}:${material.id}`) ?? [],
  );

  // Позиции без базы и без движения в отчёт не попадают, иначе таблица
  // забивается пустыми строками справочника. Вытесненные строки остаются
  // видимыми: у них есть сметный лимит, и его переезд в другой класс нужно
  // показать, а не спрятать.
  if (
    base.design == null &&
    base.estimate == null &&
    deliveryRecords.length === 0 &&
    issueRecords.length === 0
  ) {
    return null;
  }

  const balance = computeBalance({
    materialKind: material.kind,
    deliveries: deliveryRecords.map((d) => ({ quantity: n(d.quantity), pourId: d.pourId })),
    issues: issueRecords.map((i) => ({ quantity: n(i.quantity) })),
  });

  // Выполненная часть считается в единицах самого материала.
  // Бетон: сумма проектных объёмов залитых захваток именно этого класса —
  // делить списанный В7,5 на весь забетонированный объём объекта нельзя.
  // Арматура: проектная масса, приходящаяся на забетонированную долю.
  let completedDesign = 0;
  if (material.kind === 'concrete') {
    for (const sid of structureIds) {
      for (const p of poursByStructure.get(sid) ?? []) {
        if (p.status === 'done' && p.concreteMaterialId === material.id) {
          completedDesign += n(p.designVolumeM3);
        }
      }
    }
  } else if (base.design != null && concreteProgress != null) {
    completedDesign = base.design * concreteProgress;
  }

  const variance = computeVariance({
    projectPurchase: base.project,
    estimatePurchase: base.estimate,
    completedDesign,
    k,
    balance,
  });

  // Прогноз строится только там, где списание вообще отслеживается: для бетона
  // и для арматуры в целом. По отдельным диаметрам актов монтажа нет — КС-6а
  // закрывает арматуру общим тоннажом, — поэтому SKU показываются как складские
  // позиции: приход, склад, проектная потребность по КЖ. Иначе К_факт вышел бы
  // нулевым, а вердикт — обманчиво благополучным.
  const forecastable =
    (material.kind === 'concrete' || material.isAggregate) && !base.superseded;

  const forecast = forecastable
    ? computeForecast({
        baseDesign: base.design,
        completedDesign,
        estimatePurchase: base.estimate,
        k,
        balance,
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
      ? specificReinforcement(balance.consumed, concreteDesignCompleted)
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
    variance,
    forecast,
    specificKgPerM3,
    designSpecificKgPerM3,
    specificRatio: reinforcementRatio(specificKgPerM3, designSpecificKgPerM3),
  };
}
