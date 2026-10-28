/**
 * Полный импорт исходных данных объекта.
 *
 * Идемпотентен: перезапускается после каждого нового ДС или выпуска КЖ.
 * Ручной ввод (приходы, захватки, акты монтажа, процентовка) не затрагивается —
 * удаляются и создаются заново только записи с source = 'ks6a' / 'prihody'.
 *
 * Порядок важен: импортированный факт → материалы → ярусы и конструктивы →
 * базы сравнения → процентовка → приходы → сверка.
 */
import '../env';
import { eq, inArray } from 'drizzle-orm';
import { db, sql } from '../../src/db';
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
} from '../../src/db/schema';
import { K_CONCRETE, K_REBAR } from '../../src/domain/norms';
import {
  findKs6aRow,
  fmt,
  loadDeliveries,
  loadKj,
  loadKs6a,
  loadMapping,
  loadResource,
  normalizeName,
  round,
  splitFactAndPlan,
  type DeliveryTarget,
  type Ks6aRow,
  type Mapping,
  type ResourceRow,
} from './lib';

const IMPORTED_SOURCES = ['ks6a', 'prihody'];

type Check = { label: string; expected: number; actual: number; unit: string; fatal: boolean; tolerance?: number };

async function main() {
  const mapping = loadMapping();
  const ks6a = loadKs6a();
  const resource = loadResource();
  const incoming = loadDeliveries();
  const kj = loadKj();

  const warnings: string[] = [];
  const checks: Check[] = [];

  const currentRev = mapping.revisions.sheets.find((s) => s.revision === mapping.revisions.current);
  if (!currentRev) throw new Error(`Нет листа для редакции ${mapping.revisions.current}`);
  const currentRows = ks6a[currentRev.sheet]?.rows;
  if (!currentRows) throw new Error(`Лист «${currentRev.sheet}» не найден в выгрузке`);

  const inRevision = (s: Mapping['structures'][number], revision: string) =>
    !s.revisions || s.revisions.includes(revision);

  console.log('\n=== 0. Удаление импортированного факта ===');
  // Сначала записи, ссылающиеся на захватки и конструктивы, потом сами захватки.
  // Ручной ввод не трогаем — у него source='manual'.
  await db.delete(issues).where(inArray(issues.source, IMPORTED_SOURCES));
  await db.delete(deliveries).where(inArray(deliveries.source, IMPORTED_SOURCES));
  await db.delete(closings).where(inArray(closings.source, IMPORTED_SOURCES));
  // Псевдозахватки «КС-6а <месяц>» прежнего импорта: выполнение теперь берётся
  // из процентовки, а не из захваток.
  await db.delete(pours).where(eq(pours.note, 'ks6a'));

  console.log('\n=== 1. Материалы и цены ===');

  await db.delete(prices);
  const materialId = new Map<string, number>();

  for (const c of mapping.materials.concrete) {
    const [row] = await db
      .insert(materials)
      .values({ code: c.code, name: c.name, kind: 'concrete', unit: 'м3', concreteClass: c.class })
      .onConflictDoUpdate({ target: materials.code, set: { name: c.name, concreteClass: c.class } })
      .returning({ id: materials.id });
    materialId.set(c.code, row.id);
  }

  const agg = mapping.materials.rebarAggregate;
  const [aggRow] = await db
    .insert(materials)
    .values({ code: agg.code, name: agg.name, kind: 'rebar', unit: 'т', isAggregate: true })
    .onConflictDoUpdate({ target: materials.code, set: { name: agg.name, isAggregate: true } })
    .returning({ id: materials.id });
  materialId.set(agg.code, aggRow.id);

  for (const s of mapping.materials.rebarSkus) {
    const [row] = await db
      .insert(materials)
      .values({
        code: s.code,
        name: `Арматура ⌀${s.diameter} ${s.class}`,
        kind: 'rebar',
        unit: 'т',
        rebarDiameter: s.diameter,
        rebarClass: s.class,
        aggregateId: aggRow.id,
      })
      .onConflictDoUpdate({
        target: materials.code,
        set: { rebarDiameter: s.diameter, rebarClass: s.class, aggregateId: aggRow.id },
      })
      .returning({ id: materials.id });
    materialId.set(s.code, row.id);
  }
  console.log(`  материалов: ${materialId.size}`);

  // Договорные цены — из строк поставки КС-6а действующей редакции.
  const contractPrice = new Map<string, number>();
  for (const s of mapping.structures) {
    if (!inRevision(s, currentRev.revision)) continue;
    for (const sup of s.supply) {
      const row = findKs6aRow(currentRows, sup.code);
      if (!row) {
        warnings.push(`КС-6а ${currentRev.revision}: строка ${sup.code} не найдена (${s.code})`);
        continue;
      }
      const material = sup.materialByRevision?.[currentRev.revision] ?? sup.material;
      if (row.unitPrice) contractPrice.set(material, row.unitPrice);
    }
  }

  // Себестоимость — из ресурсной, строки «Стоимость бетона В…» / «Стоимость арматуры…».
  const costPrice = new Map<string, number>();
  for (const r of resource.rows) {
    if (!r.work || !r.resourcePrice) continue;
    const concrete = /^Стоимость бетона (В[\d,]+)/i.exec(r.work);
    if (concrete) {
      const m = mapping.materials.concrete.find((c) => c.class === concrete[1]);
      if (m) costPrice.set(m.code, r.resourcePrice);
      continue;
    }
    if (/^Стоимость арматуры/i.test(r.work)) costPrice.set('REBAR', r.resourcePrice);
  }

  for (const [code, value] of contractPrice) {
    await db.insert(prices).values({
      materialId: materialId.get(code)!,
      layer: 'contract',
      value: String(value),
      revision: currentRev.revision,
    });
  }
  for (const [code, value] of costPrice) {
    // Себестоимость арматуры одинакова для всех диаметров: смета не различает SKU.
    const codes = code === 'REBAR' ? [code, ...mapping.materials.rebarSkus.map((s) => s.code)] : [code];
    for (const c of codes) {
      await db.insert(prices).values({
        materialId: materialId.get(c)!,
        layer: 'cost',
        value: String(value),
        revision: 'ресурсная',
      });
    }
  }
  console.log(`  цены: себестоимость ${costPrice.size}, договорные ${contractPrice.size} позиций`);

  console.log('\n=== 2. Этажи и конструктивы ===');

  const tierId = new Map<string, number>();
  const tierSpec = new Map(mapping.tiers.map((t) => [t.code, t]));
  let tierOrder = 0;
  for (const t of mapping.tiers) {
    const values = {
      code: t.code,
      name: t.name,
      stage: t.stage,
      levelFrom: t.levelFrom,
      levelTo: t.levelTo,
      consumptionFromClosings: t.consumptionFromClosings ?? false,
      sortOrder: ++tierOrder,
    };
    const [row] = await db
      .insert(tiers)
      .values(values)
      .onConflictDoUpdate({ target: tiers.code, set: values })
      .returning({ id: tiers.id });
    tierId.set(t.code, row.id);
  }
  console.log(`  этажей: ${tierId.size}`);

  const structureId = new Map<string, number>();
  const structureTier = new Map<string, string | null>();

  const upsertStructure = async (v: {
    code: string;
    name: string;
    kind: string;
    parent?: string | null;
    level?: string | null;
    tier?: string | null;
    sortOrder: number;
  }) => {
    const parentId = v.parent ? (structureId.get(v.parent) ?? null) : null;
    const tid = v.tier ? (tierId.get(v.tier) ?? null) : null;
    if (v.tier && tid == null) warnings.push(`Этаж ${v.tier} не описан (${v.code})`);
    const set = {
      name: v.name,
      kind: v.kind,
      parentId,
      level: v.level ?? null,
      tierId: tid,
      sortOrder: v.sortOrder,
    };
    const [row] = await db
      .insert(structures)
      .values({ code: v.code, ...set })
      .onConflictDoUpdate({ target: structures.code, set })
      .returning({ id: structures.id });
    structureId.set(v.code, row.id);
    structureTier.set(v.code, v.tier ?? null);
    return row.id;
  };

  await upsertStructure({ ...mapping.object, parent: null, sortOrder: 0 });

  let order = 0;
  for (const s of mapping.sections) {
    await upsertStructure({ ...s, kind: 'section', sortOrder: ++order });
  }
  for (const s of mapping.structures) {
    await upsertStructure({ ...s, sortOrder: ++order });
    // Захватки ярусов — дочерние конструктивы строк КС-6а на несколько этажей.
    for (const b of s.blocks ?? []) {
      await upsertStructure({
        code: b.code,
        name: b.name,
        kind: s.kind,
        parent: s.code,
        level: b.level ?? null,
        tier: b.tier,
        sortOrder: ++order,
      });
    }
  }

  // Конструктивы прежних версий маппинга (отметки перекрытий '-L+5,900',
  // 'Колонны на отм. −0,080' без яруса) удаляются, если на них нет ручного ввода.
  const known = new Set(structureId.keys());
  const stale = (await db.select({ id: structures.id, code: structures.code }).from(structures)).filter(
    (s) => !known.has(s.code),
  );
  for (const s of stale) {
    try {
      await db.delete(structures).where(eq(structures.id, s.id));
    } catch {
      warnings.push(`Конструктив ${s.code} больше не в маппинге, но на него есть ручные записи — оставлен`);
    }
  }
  console.log(`  конструктивов: ${structureId.size}${stale.length ? `, удалено устаревших: ${stale.length}` : ''}`);

  console.log('\n=== 3. Нормативные коэффициенты ===');
  await db.delete(norms);
  await db.insert(norms).values([
    {
      materialKind: 'concrete',
      structureKind: null,
      kLoss: String(K_CONCRETE),
      source: 'ресурсная',
      note: 'Отношение объёма закупки к конструктивному: плита 1736/(1580+73), колонны 854,4/813,75, перекрытия 5067/4826.',
    },
    {
      materialKind: 'rebar',
      structureKind: null,
      kLoss: String(K_REBAR),
      source: 'ресурсная',
      note: 'Указано в ресурсной прямым текстом: «Стоимость арматуры (Красх = 1,1)».',
    },
  ]);
  console.log(`  бетон К=${K_CONCRETE}, арматура К=${K_REBAR}`);

  console.log('\n=== 4. Базы сравнения ===');
  await db.delete(baselines);
  let baselineCount = 0;

  const kOf = (material: string) => (material.startsWith('CONCRETE') ? K_CONCRETE : K_REBAR);

  const insertBaseline = async (v: {
    structureCode?: string;
    tierCode?: string;
    material: string;
    source: 'estimate' | 'contract' | 'project';
    revision: string;
    designQuantity?: number | null;
    purchaseQuantity?: number | null;
    effectiveFrom: string;
  }) => {
    const sid = v.structureCode ? structureId.get(v.structureCode) : null;
    const tid = v.tierCode ? tierId.get(v.tierCode) : null;
    const mid = materialId.get(v.material);
    if ((v.structureCode && !sid) || (v.tierCode && !tid) || !mid) {
      warnings.push(`База пропущена: ${v.structureCode ?? v.tierCode} / ${v.material}`);
      return;
    }
    await db.insert(baselines).values({
      structureId: sid ?? null,
      tierId: tid ?? null,
      materialId: mid,
      source: v.source,
      revision: v.revision,
      designQuantity: v.designQuantity != null ? String(round(v.designQuantity)) : null,
      purchaseQuantity: v.purchaseQuantity != null ? String(round(v.purchaseQuantity)) : null,
      effectiveFrom: v.effectiveFrom,
    });
    baselineCount++;
  };

  // Договорные базы — по каждому листу КС-6а, то есть по каждой редакции ДС.
  for (const rev of mapping.revisions.sheets) {
    const rows = ks6a[rev.sheet]?.rows;
    if (!rows) {
      warnings.push(`Лист «${rev.sheet}» отсутствует в выгрузке — редакция ${rev.revision} пропущена`);
      continue;
    }
    for (const s of mapping.structures) {
      if (!inRevision(s, rev.revision)) continue;
      const design = s.workCodes.reduce((acc, ref) => acc + (findKs6aRow(rows, ref)?.quantity ?? 0), 0);
      for (const sup of s.supply) {
        const row = findKs6aRow(rows, sup.code);
        if (!row?.quantity) continue;
        // Класс бетона мог отличаться в этой редакции: плита ЛПК проходила как
        // В25 до ДС3 и как В30 начиная с ДС3. Пишем базу под тем классом,
        // под которым конструктив шёл тогда, иначе сверка даст ложный перерасход.
        const material = sup.materialByRevision?.[rev.revision] ?? sup.material;
        await insertBaseline({
          structureCode: s.code,
          material,
          source: 'contract',
          revision: rev.revision,
          // Арматура в КС-6а идёт в тоннах закупки; конструктивная масса — закупка / К.
          designQuantity: design > 0 && material !== 'REBAR' ? design : row.quantity / kOf(material),
          purchaseQuantity: row.quantity,
          effectiveFrom: rev.effectiveFrom,
        });
      }
    }
  }

  // Сметные базы — из матрицы материалов ресурсной. Итоговая строка ресурсной
  // (код «1.») содержит суммы по объекту в разрезе материалов.
  const estimateTotals = new Map<string, number>();
  const totalRow = resource.rows.find((r) => r.code === '1.' && Object.keys(r.matrix).length > 0);
  if (totalRow) {
    const labelToCode: Record<string, string> = {
      'Бетон В7,5': 'CONCRETE_B7_5',
      'Бетон В25 (М3)': 'CONCRETE_B25',
      'Бетон В30': 'CONCRETE_B30',
      'Арматура (Тн)': 'REBAR',
    };
    for (const [label, value] of Object.entries(totalRow.matrix)) {
      const code = labelToCode[label];
      if (code) estimateTotals.set(code, value);
    }
  } else {
    warnings.push('Ресурсная: итоговая строка с матрицей материалов не найдена');
  }

  // Сметные базы берутся из самой ресурсной, а не из первой редакции КС-6а:
  // объёмы там уже расходятся (фундамент БК — 80,1 м3 бетона по смете против
  // 100,4 по ДС). У ресурсной своя нумерация: плита ЛПК это 1.3.1.x, а не 3.1.x.
  const resourceByCode = new Map<string, ResourceRow>();
  for (const r of resource.rows) {
    if (r.code && r.workQuantity != null) resourceByCode.set(r.code.trim(), r);
  }
  const estimateTotalsByMaterial = new Map<string, number>();

  for (const s of mapping.structures) {
    const design = (s.workCodesResource ?? []).reduce(
      (acc, code) => acc + (resourceByCode.get(code)?.workQuantity ?? 0),
      0,
    );
    for (const sup of s.supply) {
      if (!sup.estimate) {
        // Строки, добавленные допсоглашениями (колодец БК, разбивка стен в ДС5),
        // в ресурсной не существуют — это ожидаемо и не предупреждение.
        if (!s.revisions) warnings.push(`Ресурсная: нет сметной привязки для ${s.code} / ${sup.material}`);
        continue;
      }
      const row = resourceByCode.get(sup.estimate.code);
      if (!row?.workQuantity) {
        warnings.push(`Ресурсная: строка ${sup.estimate.code} не найдена (${s.code})`);
        continue;
      }
      const material = sup.estimate.material;
      await insertBaseline({
        structureCode: s.code,
        material,
        source: 'estimate',
        revision: 'ресурсная',
        designQuantity: design > 0 && material !== 'REBAR' ? design : row.workQuantity / kOf(material),
        purchaseQuantity: row.workQuantity,
        effectiveFrom: '2026-06-09',
      });
      estimateTotalsByMaterial.set(material, (estimateTotalsByMaterial.get(material) ?? 0) + row.workQuantity);
    }
  }

  // Проектные базы — ведомости КЖ, привязанные к захваткам ярусов.
  for (const sheet of kj.sheets) {
    for (const c of sheet.concrete) {
      await insertBaseline({
        structureCode: c.structureCode,
        material: c.material,
        source: 'project',
        revision: sheet.revision,
        designQuantity: c.designM3,
        purchaseQuantity: c.designM3 * K_CONCRETE,
        effectiveFrom: sheet.issuedAt,
      });
    }
    for (const st of sheet.steel.byStructure) {
      // Ведомость расхода стали — в килограммах, учёт арматуры ведётся в тоннах.
      for (const d of [{ material: 'REBAR', kg: st.totalKg }, ...st.byDiameter]) {
        await insertBaseline({
          structureCode: st.structureCode,
          material: d.material,
          source: 'project',
          revision: sheet.revision,
          designQuantity: d.kg / 1000,
          purchaseQuantity: (d.kg / 1000) * K_REBAR,
          effectiveFrom: sheet.issuedAt,
        });
      }
    }
    for (const t of sheet.tierLevel ?? []) {
      await insertBaseline({
        tierCode: t.tier,
        material: t.material,
        source: 'project',
        revision: sheet.revision,
        designQuantity: t.design,
        purchaseQuantity: t.design * kOf(t.material),
        effectiveFrom: sheet.issuedAt,
      });
    }
  }
  console.log(`  записей базы сравнения: ${baselineCount}`);

  console.log(`\n=== 5. Процентовка по КС-6а ${currentRev.revision} ===`);

  // Закрытый за месяц объём пишется на захватку яруса, если её удаётся
  // определить (closingBlocks), иначе на сам конструктив.
  const closedByMaterial = new Map<string, number>();
  let closingCount = 0;
  let proxyCount = 0;

  for (const s of mapping.structures) {
    if (!inRevision(s, currentRev.revision)) continue;
    const workRows = s.workCodes
      .map((ref) => findKs6aRow(currentRows, ref))
      .filter((r): r is Ks6aRow => r != null);

    const monthlyDesign = new Map<string, number>();
    for (const wr of workRows) {
      for (const f of splitFactAndPlan(wr.monthly, currentRev.factThrough).fact) {
        monthlyDesign.set(f.date, (monthlyDesign.get(f.date) ?? 0) + f.volume);
      }
    }

    for (const sup of s.supply) {
      const row = findKs6aRow(currentRows, sup.code);
      if (!row) continue;
      const material = sup.materialByRevision?.[currentRev.revision] ?? sup.material;
      const isRebar = material === 'REBAR';

      for (const f of splitFactAndPlan(row.monthly, currentRev.factThrough).fact) {
        const target = s.closingBlocks?.[f.date] ?? s.code;
        const tier = structureTier.get(target) ?? null;
        if (s.blocks?.length && !s.closingBlocks?.[f.date]) {
          warnings.push(`Процентовка ${s.code} за ${f.date}: не указана захватка этажа (closingBlocks)`);
        }
        // У стяжки нет строки работ в м3: конструктивный объём — закупка / К.
        const design = isRebar
          ? null
          : (monthlyDesign.get(f.date) ?? (workRows.length === 0 ? f.volume / K_CONCRETE : null));

        await db.insert(closings).values({
          period: f.date,
          structureId: structureId.get(target)!,
          materialId: materialId.get(material)!,
          quantity: String(round(f.volume)),
          designQuantity: design != null ? String(round(design)) : null,
          revision: currentRev.revision,
          document: `КС-6а ${currentRev.revision}`,
          source: 'ks6a',
        });
        closingCount++;
        closedByMaterial.set(material, (closedByMaterial.get(material) ?? 0) + f.volume);

        // В ярусах, где приход разнесён только на ярус целиком, другого источника
        // «сколько ушло в этот конструктив» нет — списание берётся по процентовке.
        if (tier && tierSpec.get(tier)?.consumptionFromClosings) {
          await db.insert(issues).values({
            date: f.date,
            materialId: materialId.get(material)!,
            quantity: String(round(f.volume)),
            structureId: structureId.get(target)!,
            document: `КС-6а ${currentRev.revision}`,
            source: 'ks6a',
            note: 'Списание по процентовке: приход этажа не разнесён по конструктивам.',
          });
          proxyCount++;
        } else if (!tier) {
          warnings.push(`Процентовка ${target} за ${f.date}: конструктив без этажа`);
        }
      }
    }
  }
  console.log(`  записей процентовки: ${closingCount}, из них списано по процентовке: ${proxyCount}`);

  console.log('\n=== 6. Приходы с листа «приходы» ===');

  const deliveryRowToMaterial = new Map<string, string>();
  for (const c of mapping.materials.concrete) {
    for (const name of [c.deliveryRow, ...(c.aliases ?? [])]) deliveryRowToMaterial.set(normalizeName(name), c.code);
  }
  for (const s of mapping.materials.rebarSkus) {
    for (const name of [s.deliveryRow, ...(s.aliases ?? [])]) deliveryRowToMaterial.set(normalizeName(name), s.code);
  }
  const headerTarget = new Map<string, DeliveryTarget>(
    mapping.deliveryBlocks.headers.map((h) => [normalizeName(h.header), h.target]),
  );
  const describe = (t: DeliveryTarget) =>
    t == null ? 'вне охвата' : 'structure' in t ? t.structure : `этаж ${t.tier}`;

  let target: DeliveryTarget = mapping.deliveryBlocks.initial;
  let deliveryCount = 0;
  const incomingByMaterial = new Map<string, number>();
  // Сводка для сверки проекта на листе с ведомостями КЖ: (блок, материал) → объём.
  const sheetProject = new Map<string, { target: DeliveryTarget; material: string; project: number }>();
  const skipped = new Set<string>();

  for (const row of incoming.rows) {
    const name = normalizeName(row.name);
    if (headerTarget.has(name)) {
      target = headerTarget.get(name)!;
      continue;
    }
    if (/^КЖ\d/.test(name)) {
      warnings.push(`Лист «приходы», строка ${row.row + 1}: заголовок блока «${row.name}» не описан в deliveryBlocks`);
      target = null;
      continue;
    }
    const code = deliveryRowToMaterial.get(name);
    if (!code) {
      if (row.daily.length > 0) skipped.add(row.name);
      continue;
    }
    if (target == null) continue;

    const sum = row.daily.reduce((acc, d) => acc + d.quantity, 0);
    if (row.incoming != null && Math.abs(sum - row.incoming) > 0.005) {
      warnings.push(
        `Лист «приходы», строка ${row.row + 1} (${row.name}, ${describe(target)}): ` +
          `сумма по дням ${fmt(sum, 3)}, а в колонке «Приход» ${fmt(row.incoming, 3)} — импортированы дни`,
      );
    }
    if (row.project != null) {
      const key = `${describe(target)}|${code}`;
      const prev = sheetProject.get(key);
      sheetProject.set(key, { target, material: code, project: (prev?.project ?? 0) + row.project });
    }

    const sid = 'structure' in target ? structureId.get(target.structure) : undefined;
    const tierCode = 'structure' in target ? structureTier.get(target.structure) : target.tier;
    if ('structure' in target && sid == null) {
      warnings.push(`Блок листа «приходы» ссылается на неизвестный конструктив ${target.structure}`);
      continue;
    }
    for (const d of row.daily) {
      await db.insert(deliveries).values({
        date: d.date,
        materialId: materialId.get(code)!,
        quantity: String(round(d.quantity)),
        structureId: sid ?? null,
        tierId: tierCode ? (tierId.get(tierCode) ?? null) : null,
        pourId: null,
        // Разнесено на ярус или конструктив — значит, не «неподтверждённый расход».
        needsAllocation: false,
        source: 'prihody',
        note: `Лист «приходы»: ${describe(target)}`,
      });
      deliveryCount++;
      incomingByMaterial.set(code, (incomingByMaterial.get(code) ?? 0) + d.quantity);
    }
  }
  for (const c of mapping.deliveryBlocks.corrections ?? []) {
    if (c.target == null) continue;
    const sid = 'structure' in c.target ? structureId.get(c.target.structure) : undefined;
    const tierCode = 'structure' in c.target ? structureTier.get(c.target.structure) : c.target.tier;
    await db.insert(deliveries).values({
      date: c.date,
      materialId: materialId.get(c.material)!,
      quantity: String(c.quantity),
      structureId: sid ?? null,
      tierId: tierCode ? (tierId.get(tierCode) ?? null) : null,
      needsAllocation: false,
      source: 'prihody',
      note: `Корректировка: ${c.note}`,
    });
    deliveryCount++;
    incomingByMaterial.set(c.material, (incomingByMaterial.get(c.material) ?? 0) + c.quantity);
    warnings.push(`Восстановлена поставка ${c.date} ${c.material} ${fmt(c.quantity)} — ${describe(c.target)}`);
  }
  console.log(`  записей прихода: ${deliveryCount}`);
  if (skipped.size > 0) console.log(`  вне охвата пилота: ${[...skipped].join(', ')}`);

  console.log('\n=== 7. Сверка ===');

  // Сумма сметных баз по каждому материалу обязана совпасть с итоговой строкой
  // матрицы ресурсной — это сквозная проверка всей сметной привязки конструктивов.
  for (const [code, expected] of estimateTotals) {
    checks.push({
      label: `Смета по ресурсной: ${code}`,
      expected,
      actual: estimateTotalsByMaterial.get(code) ?? 0,
      unit: code === 'REBAR' ? 'т' : 'м3',
      fatal: true,
    });
  }

  // Полнота маппинга: всё, что закрыто в КС-6а по строкам «Поставка бетона/арматуры»,
  // должно попасть в процентовку. Пропущенная строка ДС здесь и всплывёт.
  const supplyPatterns: [string, RegExp][] = [
    ['CONCRETE_B7_5', /^Поставка бетона В7,5/],
    ['CONCRETE_B15', /^Поставка бетона В15/],
    ['CONCRETE_B25', /^Поставка бетона В25/],
    ['CONCRETE_B30', /^Поставка бетона В30/],
    ['REBAR', /^Поставка арматуры/],
  ];
  for (const [code, re] of supplyPatterns) {
    const expected = currentRows
      .filter((r) => re.test(r.name))
      .reduce(
        (acc, r) => acc + splitFactAndPlan(r.monthly, currentRev.factThrough).fact.reduce((a, f) => a + f.volume, 0),
        0,
      );
    checks.push({
      label: `Процентовка ${currentRev.revision} против строк «Поставка…»: ${code}`,
      expected,
      actual: closedByMaterial.get(code) ?? 0,
      unit: code === 'REBAR' ? 'т' : 'м3',
      fatal: true,
    });
  }

  // Сверка с колонкой «Запроцентовано» листа: лист ведут руками, расхождение на
  // десятые доли кубометра — это ручной ввод, а не ошибка импорта.
  const closedOnSheet = new Map<string, number>();
  for (const row of incoming.rows) {
    const code = deliveryRowToMaterial.get(normalizeName(row.name));
    if (code && row.closed) closedOnSheet.set(code, (closedOnSheet.get(code) ?? 0) + row.closed);
  }
  const rebarClosedOnSheet = incoming.rows
    .filter((r) => normalizeName(r.name) === agg.deliveryRow && r.closed)
    .reduce((acc, r) => acc + r.closed!, 0);
  for (const [code, expected] of [...closedOnSheet, ['REBAR', rebarClosedOnSheet] as const]) {
    checks.push({
      label: `Процентовка против колонки «Запроцентовано» листа: ${code}`,
      expected,
      actual: closedByMaterial.get(code) ?? 0,
      unit: code === 'REBAR' ? 'т' : 'м3',
      fatal: false,
      tolerance: 0.5,
    });
  }

  let allOk = true;
  for (const c of checks) {
    const diff = c.actual - c.expected;
    const ok = Math.abs(diff) < (c.tolerance ?? 0.02);
    if (!ok && c.fatal) allOk = false;
    console.log(
      `  ${ok ? '✓' : c.fatal ? '✗' : '~'} ${c.label}: ${fmt(c.actual)} ${c.unit} ` +
        `(ожидалось ${fmt(c.expected)}, расхождение ${fmt(diff)})`,
    );
  }

  // Проект на листе против ведомостей КЖ. Лист ведётся руками и местами отстаёт
  // от последнего изменения КЖ — система берёт КЖ, а расхождения показывает.
  const latestProject = new Map<string, { revision: string; design: number; from: string }>();
  for (const sheet of kj.sheets) {
    const put = (key: string, design: number) => {
      const prev = latestProject.get(key);
      if (!prev || sheet.issuedAt > prev.from) latestProject.set(key, { revision: sheet.revision, design, from: sheet.issuedAt });
    };
    for (const c of sheet.concrete) put(`${c.structureCode}|${c.material}`, c.designM3);
    for (const st of sheet.steel.byStructure) for (const d of st.byDiameter) put(`${st.structureCode}|${d.material}`, d.kg / 1000);
  }
  const blockTargets = new Set(
    mapping.deliveryBlocks.headers.flatMap((h) => (h.target && 'structure' in h.target ? [h.target.structure] : [])),
  );
  const projectDiffs: string[] = [];
  for (const { target: t, material, project } of sheetProject.values()) {
    if (t == null) continue;
    let kjValue = 0;
    let found = false;
    if ('structure' in t) {
      const p = latestProject.get(`${t.structure}|${material}`);
      if (p) ((kjValue = p.design), (found = true));
    } else {
      // Блок на ярус целиком: сумма захваток яруса, у которых нет своего блока на листе.
      for (const [code, tier] of structureTier) {
        if (tier !== t.tier || blockTargets.has(code)) continue;
        const p = latestProject.get(`${code}|${material}`);
        if (p) ((kjValue += p.design), (found = true));
      }
    }
    if (!found) continue;
    if (Math.abs(kjValue - project) > 0.01) {
      projectDiffs.push(
        `${describe(t)} · ${material}: на листе ${fmt(project, 3)}, по КЖ ${fmt(kjValue, 3)} (${fmt(kjValue - project, 3)})`,
      );
    }
  }
  if (projectDiffs.length > 0) {
    console.log('\n=== Проект на листе «приходы» против КЖ (в расчёт идёт КЖ) ===');
    for (const d of projectDiffs) console.log(`  · ${d}`);
  }

  if (warnings.length > 0) {
    console.log('\n=== Предупреждения ===');
    for (const w of warnings) console.log(`  ! ${w}`);
  }

  const [{ count: leftovers }] = await sql<{ count: string }[]>`
    select count(*)::text as count from deliveries where source = 'manual' and needs_allocation`;
  console.log(
    allOk
      ? `\nИмпорт завершён, контрольные суммы сходятся. Ручных приходов, ждущих разнесения: ${leftovers}.`
      : '\nИмпорт завершён С РАСХОЖДЕНИЯМИ.',
  );
  await sql.end();
  if (!allOk) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await sql.end().catch(() => {});
  process.exit(1);
});
