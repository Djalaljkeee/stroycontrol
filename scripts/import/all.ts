/**
 * Полный импорт исходных данных объекта.
 *
 * Идемпотентен: перезапускается после каждого нового ДС или выпуска КЖ.
 * Ручной ввод (захватки прораба, ТТН, акты монтажа) не затрагивается —
 * удаляются и создаются заново только записи с source = 'ks6a' / 'prihody'.
 *
 * Порядок важен: материалы → конструктивы → базы сравнения → факт.
 */
import '../env';
import { and, eq, inArray, sql as raw } from 'drizzle-orm';
import { db, sql } from '../../src/db';
import {
  baselines,
  deliveries,
  issues,
  materials,
  norms,
  pours,
  prices,
  structures,
} from '../../src/db/schema';
import { K_CONCRETE, K_REBAR } from '../../src/domain/norms';
import {
  fmt,
  loadDeliveries,
  loadKj,
  loadKs6a,
  loadMapping,
  loadResource,
  round,
  splitFactAndPlan,
  type Ks6aRow,
  type ResourceRow,
} from './lib';

const IMPORTED_SOURCES = ['ks6a', 'prihody'];

async function main() {
  const mapping = loadMapping();
  const ks6a = loadKs6a();
  const resource = loadResource();
  const incoming = loadDeliveries();
  const kj = loadKj();

  const warnings: string[] = [];
  const checks: { label: string; expected: number; actual: number; unit: string }[] = [];

  console.log('\n=== 1. Материалы и цены ===');

  await db.delete(prices);
  const materialId = new Map<string, number>();

  for (const c of mapping.materials.concrete) {
    const [row] = await db
      .insert(materials)
      .values({
        code: c.code,
        name: c.name,
        kind: 'concrete',
        unit: 'м3',
        concreteClass: c.class,
      })
      .onConflictDoUpdate({
        target: materials.code,
        set: { name: c.name, concreteClass: c.class },
      })
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
  const currentRev = mapping.revisions.sheets.find(
    (s) => s.revision === mapping.revisions.current,
  );
  if (!currentRev) throw new Error(`Нет листа для редакции ${mapping.revisions.current}`);
  const currentSheet = ks6a[currentRev.sheet];
  if (!currentSheet) throw new Error(`Лист «${currentRev.sheet}» не найден в выгрузке`);

  const byCode = (sheet: string) => {
    const map = new Map<string, Ks6aRow>();
    for (const r of ks6a[sheet]?.rows ?? []) if (r.code) map.set(r.code.trim(), r);
    return map;
  };
  const currentRows = byCode(currentRev.sheet);

  const contractPrice = new Map<string, number>();
  for (const s of mapping.structures) {
    for (const sup of s.supply) {
      const row = currentRows.get(sup.code);
      if (!row) {
        warnings.push(`КС-6а ${currentRev.revision}: строка ${sup.code} не найдена (${s.code})`);
        continue;
      }
      if (row.unitPrice) contractPrice.set(sup.material, row.unitPrice);
    }
  }

  // Себестоимость — из ресурсной, строки «Стоимость бетона В…» / «Стоимость арматуры…».
  const costPrice = new Map<string, number>();
  for (const r of resource.rows) {
    if (!r.work || !r.resourcePrice) continue;
    const concrete = /^Стоимость бетона (В[\d,]+)/i.exec(r.work);
    if (concrete) {
      const cls = concrete[1];
      const m = mapping.materials.concrete.find((c) => c.class === cls);
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
    await db.insert(prices).values({
      materialId: materialId.get(code)!,
      layer: 'cost',
      value: String(value),
      revision: 'ресурсная',
    });
    // Себестоимость арматуры одинакова для всех диаметров: смета не различает SKU.
    if (code === 'REBAR') {
      for (const s of mapping.materials.rebarSkus) {
        await db.insert(prices).values({
          materialId: materialId.get(s.code)!,
          layer: 'cost',
          value: String(value),
          revision: 'ресурсная',
        });
      }
    }
  }
  console.log(
    `  цены: себестоимость ${costPrice.size}, договорные ${contractPrice.size} позиций`,
  );

  console.log('\n=== 2. Конструктивы ===');

  const structureId = new Map<string, number>();

  const upsertStructure = async (v: {
    code: string;
    name: string;
    kind: string;
    parent?: string | null;
    level?: string | null;
    sortOrder: number;
  }) => {
    const parentId = v.parent ? (structureId.get(v.parent) ?? null) : null;
    const [row] = await db
      .insert(structures)
      .values({
        code: v.code,
        name: v.name,
        kind: v.kind,
        parentId,
        level: v.level ?? null,
        sortOrder: v.sortOrder,
      })
      .onConflictDoUpdate({
        target: structures.code,
        set: { name: v.name, kind: v.kind, parentId, level: v.level ?? null, sortOrder: v.sortOrder },
      })
      .returning({ id: structures.id });
    structureId.set(v.code, row.id);
    return row.id;
  };

  await upsertStructure({ ...mapping.object, parent: null, sortOrder: 0 });

  let order = 0;
  for (const s of mapping.sections) {
    await upsertStructure({ ...s, kind: 'section', sortOrder: ++order });
  }
  for (const s of mapping.structures) {
    await upsertStructure({ ...s, sortOrder: ++order });
    // Отметки перекрытий — дочерние конструктивы без своей базы сравнения:
    // делить общий объём между отметками поровну нельзя, площади разные.
    for (const level of s.levels ?? []) {
      await upsertStructure({
        code: `${s.code}-L${level}`,
        name: `${s.name}, отм. ${level}`,
        kind: s.kind,
        parent: s.code,
        level,
        sortOrder: ++order,
      });
    }
  }
  console.log(`  конструктивов: ${structureId.size}`);

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

  const insertBaseline = async (v: {
    structureCode: string;
    material: string;
    source: 'estimate' | 'contract' | 'project';
    revision: string;
    designQuantity?: number | null;
    purchaseQuantity?: number | null;
    effectiveFrom: string;
    note?: string | null;
  }) => {
    const sid = structureId.get(v.structureCode);
    const mid = materialId.get(v.material);
    if (!sid || !mid) {
      warnings.push(`База пропущена: ${v.structureCode} / ${v.material}`);
      return;
    }
    await db.insert(baselines).values({
      structureId: sid,
      materialId: mid,
      source: v.source,
      revision: v.revision,
      designQuantity: v.designQuantity != null ? String(round(v.designQuantity)) : null,
      purchaseQuantity: v.purchaseQuantity != null ? String(round(v.purchaseQuantity)) : null,
      effectiveFrom: v.effectiveFrom,
      note: v.note ?? null,
    });
    baselineCount++;
  };

  // Договорные базы — по каждому листу КС-6а, то есть по каждой редакции ДС.
  for (const rev of mapping.revisions.sheets) {
    const rows = byCode(rev.sheet);
    if (rows.size === 0) {
      warnings.push(`Лист «${rev.sheet}» отсутствует в выгрузке — редакция ${rev.revision} пропущена`);
      continue;
    }
    for (const s of mapping.structures) {
      const design = s.workCodes.reduce((acc, code) => {
        const row = rows.get(code);
        return acc + (row?.quantity ?? 0);
      }, 0);
      for (const sup of s.supply) {
        const row = rows.get(sup.code);
        if (!row?.quantity) continue;
        // Класс бетона мог отличаться в этой редакции: плита ЛПК проходила как
        // В25 до ДС3 и как В30 начиная с ДС3. Пишем базу под тем классом,
        // под которым конструктив шёл тогда, иначе сверка даст ложный перерасход.
        const material = sup.materialByRevision?.[rev.revision] ?? sup.material;
        const k = material === 'REBAR' ? K_REBAR : K_CONCRETE;
        await insertBaseline({
          structureCode: s.code,
          material,
          source: 'contract',
          revision: rev.revision,
          // Арматура в КС-6а идёт в тоннах закупки; конструктивная масса — закупка / К.
          designQuantity: design > 0 && material !== 'REBAR' ? design : row.quantity / k,
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
        warnings.push(`Ресурсная: нет сметной привязки для ${s.code} / ${sup.material}`);
        continue;
      }
      const row = resourceByCode.get(sup.estimate.code);
      if (!row?.workQuantity) {
        warnings.push(`Ресурсная: строка ${sup.estimate.code} не найдена (${s.code})`);
        continue;
      }
      const material = sup.estimate.material;
      const k = material === 'REBAR' ? K_REBAR : K_CONCRETE;
      await insertBaseline({
        structureCode: s.code,
        material,
        source: 'estimate',
        revision: 'ресурсная',
        designQuantity: design > 0 && material !== 'REBAR' ? design : row.workQuantity / k,
        purchaseQuantity: row.workQuantity,
        effectiveFrom: '2026-06-09',
      });
      estimateTotalsByMaterial.set(
        material,
        (estimateTotalsByMaterial.get(material) ?? 0) + row.workQuantity,
      );
    }
  }

  // Проектные базы — ведомости КЖ, привязанные к отметкам.
  for (const sheet of kj.sheets) {
    for (const c of sheet.concrete) {
      await upsertStructure({
        code: c.structureCode,
        name: c.name,
        kind: c.kind,
        parent: c.parent,
        level: c.level,
        sortOrder: ++order,
      });
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
      await insertBaseline({
        structureCode: st.structureCode,
        material: 'REBAR',
        source: 'project',
        revision: sheet.revision,
        designQuantity: st.totalKg / 1000,
        purchaseQuantity: (st.totalKg / 1000) * K_REBAR,
        effectiveFrom: sheet.issuedAt,
      });
      for (const d of st.byDiameter) {
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
  }
  console.log(`  записей базы сравнения: ${baselineCount}`);

  console.log('\n=== 5. Факт: захватки и закрытые объёмы КС-6а ===');

  // Порядок удаления важен: сначала записи, ссылающиеся на захватки, потом сами
  // захватки. Ручной ввод не трогаем — у него source='manual' и note != 'ks6a'.
  await db.delete(issues).where(inArray(issues.source, IMPORTED_SOURCES));
  await db.delete(deliveries).where(inArray(deliveries.source, IMPORTED_SOURCES));
  await db.delete(pours).where(eq(pours.note, 'ks6a'));

  let pourCount = 0;
  let issueCount = 0;

  for (const s of mapping.structures) {
    const sid = structureId.get(s.code)!;

    // Захватка на каждый закрытый месяц: это не настоящая захватка, а свёртка
    // журнала за месяц. Настоящие захватки прораб заводит вручную.
    for (const sup of s.supply) {
      if (sup.material === 'REBAR') continue;
      const workRows = s.workCodes.map((c) => currentRows.get(c)).filter(Boolean) as Ks6aRow[];
      const monthlyDesign = new Map<string, number>();
      for (const wr of workRows) {
        const { fact } = splitFactAndPlan(wr.monthly, currentRev.factThrough);
        for (const f of fact) {
          monthlyDesign.set(f.date, (monthlyDesign.get(f.date) ?? 0) + f.volume);
        }
      }

      const supplyRow = currentRows.get(sup.code);
      const monthlySupply = new Map<string, number>();
      if (supplyRow) {
        const { fact } = splitFactAndPlan(supplyRow.monthly, currentRev.factThrough);
        for (const f of fact) monthlySupply.set(f.date, f.volume);
      }

      for (const [date, designVolume] of monthlyDesign) {
        const [pour] = await db
          .insert(pours)
          .values({
            structureId: sid,
            label: `КС-6а ${date}`,
            pouredAt: date,
            designVolumeM3: String(round(designVolume)),
            concreteMaterialId: materialId.get(sup.material)!,
            status: 'done',
            note: 'ks6a',
          })
          .returning({ id: pours.id });
        pourCount++;

        const written = monthlySupply.get(date);
        if (written) {
          await db.insert(issues).values({
            date,
            materialId: materialId.get(sup.material)!,
            quantity: String(round(written)),
            structureId: sid,
            pourId: pour.id,
            document: `КС-6а ${currentRev.revision}`,
            source: 'ks6a',
            note: 'Закрытый объём по журналу учёта выполненных работ.',
          });
          issueCount++;
        }
      }
    }

    // Арматура: закрытый тоннаж по КС-6а — списание на конструктив.
    const rebarSupply = s.supply.find((x) => x.material === 'REBAR');
    if (rebarSupply) {
      const row = currentRows.get(rebarSupply.code);
      if (row) {
        const { fact } = splitFactAndPlan(row.monthly, currentRev.factThrough);
        for (const f of fact) {
          await db.insert(issues).values({
            date: f.date,
            materialId: materialId.get('REBAR')!,
            quantity: String(round(f.volume)),
            structureId: sid,
            document: `КС-6а ${currentRev.revision}`,
            source: 'ks6a',
            note: 'Закрытый тоннаж по журналу учёта выполненных работ.',
          });
          issueCount++;
        }
      }
    }
  }
  console.log(`  захваток из КС-6а: ${pourCount}, списаний: ${issueCount}`);

  console.log('\n=== 6. Приходы с листа «приходы» ===');

  const deliveryRowToMaterial = new Map<string, string>();
  for (const c of mapping.materials.concrete) deliveryRowToMaterial.set(c.deliveryRow, c.code);
  for (const s of mapping.materials.rebarSkus) deliveryRowToMaterial.set(s.deliveryRow, s.code);

  let deliveryCount = 0;
  const incomingByMaterial = new Map<string, number>();
  const skipped: string[] = [];

  for (const row of incoming.rows) {
    const code = deliveryRowToMaterial.get(row.name);
    if (!code) {
      if (row.daily.length > 0) skipped.push(row.name);
      continue;
    }
    const mid = materialId.get(code)!;
    const isConcrete = code.startsWith('CONCRETE');
    for (const d of row.daily) {
      await db.insert(deliveries).values({
        date: d.date,
        materialId: mid,
        quantity: String(round(d.quantity)),
        // Ни одна поставка в исходных данных не привязана к конструкции —
        // это и есть та дыра, которую пилот закрывает. Бетон помечается
        // как требующий разнесения, арматура просто ложится на склад.
        pourId: null,
        needsAllocation: isConcrete,
        source: 'prihody',
        note: 'Импорт листа «приходы»',
      });
      deliveryCount++;
      incomingByMaterial.set(code, (incomingByMaterial.get(code) ?? 0) + d.quantity);
    }
  }
  console.log(`  записей прихода: ${deliveryCount}`);
  if (skipped.length > 0) {
    console.log(`  вне охвата пилота (бетон и арматура): ${skipped.join(', ')}`);
  }

  console.log('\n=== 7. Сверка контрольных сумм ===');

  // Сумма сметных баз по каждому материалу обязана совпасть с итоговой строкой
  // матрицы ресурсной — она же колонка «Кол-во по ресурсной (смете)» на листе
  // «приходы». Это сквозная проверка всей сметной привязки конструктивов.
  for (const [code, expected] of estimateTotals) {
    checks.push({
      label: `Смета по ресурсной: ${code}`,
      expected,
      actual: estimateTotalsByMaterial.get(code) ?? 0,
      unit: code === 'REBAR' ? 'т' : 'м3',
    });
  }

  const b30 = incoming.rows.find((r) => r.name === 'Бетон В30');
  if (b30?.incoming != null) {
    checks.push({
      label: 'Приход бетона В30',
      expected: b30.incoming,
      actual: incomingByMaterial.get('CONCRETE_B30') ?? 0,
      unit: 'м3',
    });
  }

  const rebarAggRow = incoming.rows.find((r) => r.name === agg.deliveryRow);
  const skuSum = mapping.materials.rebarSkus.reduce(
    (acc, s) => acc + (incomingByMaterial.get(s.code) ?? 0),
    0,
  );
  if (rebarAggRow?.incoming != null) {
    checks.push({
      label: 'Приход арматуры (агрегат против суммы SKU)',
      expected: rebarAggRow.incoming,
      actual: skuSum,
      unit: 'т',
    });
  }

  const [{ consumedB30 }] = await db
    .select({ consumedB30: raw<string>`coalesce(sum(${issues.quantity}), 0)` })
    .from(issues)
    .where(and(eq(issues.materialId, materialId.get('CONCRETE_B30')!), eq(issues.source, 'ks6a')));
  checks.push({
    label: 'Списано бетона В30 по КС-6а',
    expected: 1275.11,
    actual: Number(consumedB30),
    unit: 'м3',
  });

  let allOk = true;
  for (const c of checks) {
    const diff = c.actual - c.expected;
    const ok = Math.abs(diff) < 0.02;
    if (!ok) allOk = false;
    console.log(
      `  ${ok ? '✓' : '✗'} ${c.label}: ${fmt(c.actual)} ${c.unit} ` +
        `(ожидалось ${fmt(c.expected)}, расхождение ${fmt(diff)})`,
    );
  }

  const unconfirmed =
    (incomingByMaterial.get('CONCRETE_B30') ?? 0) - Number(consumedB30);
  console.log(
    `\n  Неподтверждённый расход В30: ${fmt(unconfirmed)} м3 ` +
      '— приход без привязки к конструкции.',
  );

  if (warnings.length > 0) {
    console.log('\n=== Предупреждения ===');
    for (const w of warnings) console.log(`  ! ${w}`);
  }

  console.log(allOk ? '\nИмпорт завершён, контрольные суммы сходятся.' : '\nИмпорт завершён С РАСХОЖДЕНИЯМИ.');
  await sql.end();
  if (!allOk) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await sql.end().catch(() => {});
  process.exit(1);
});
