import ExcelJS from 'exceljs';
import { asc } from 'drizzle-orm';
import { db } from '@/db';
import { deliveries, issues, materials, pours, structures } from '@/db/schema';
import { buildReport } from '@/lib/report';
import { n } from '@/lib/format';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFEFF2F6' },
};

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, size: 10 };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  });
}

function autoWidth(sheet: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

/**
 * Выгрузка в Excel.
 *
 * Последним листом идёт «приходы (как было)» — та же матрица «материал × даты»,
 * что и в исходном файле. Он нужен, чтобы выгрузку можно было сверить с
 * привычной таблицей строка в строку, пока пилот не заменил её окончательно.
 */
export async function buildWorkbook(): Promise<ExcelJS.Workbook> {
  const [report, structureRows, materialRows, pourRows, deliveryRows, issueRows] =
    await Promise.all([
      buildReport(),
      db.select().from(structures).orderBy(asc(structures.sortOrder)),
      db.select().from(materials).orderBy(asc(materials.id)),
      db.select().from(pours).orderBy(asc(pours.pouredAt)),
      db.select().from(deliveries).orderBy(asc(deliveries.date)),
      db.select().from(issues).orderBy(asc(issues.date)),
    ]);

  const structureById = new Map(structureRows.map((s) => [s.id, s]));
  const materialById = new Map(materialRows.map((m) => [m.id, m]));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'СтройКонтроль';
  wb.created = report.generatedAt;

  // ── Остатки ──────────────────────────────────────────────────────────────
  const balance = wb.addWorksheet('Остатки');
  styleHeader(
    balance.addRow([
      'Материал', 'Ед.', 'Смета (лимит)', 'Смета по ресурсной', 'Проект', 'База', 'Редакция', 'Приход', 'Списано',
      'Склад', 'Не подтверждено', 'Выполнено, %', 'К норм', 'К факт', 'Прогноз',
      'Перерасход', 'Перерасход, ₽', 'Оценка', 'Примечание',
    ]),
  );
  for (const c of report.totals) {
    balance.addRow([
      c.material.name,
      c.material.unit,
      c.estimatePurchase,
      c.estimateOriginal,
      c.projectPurchase,
      c.base?.source === 'project' ? 'проект' : c.base?.source === 'contract' ? 'договор' : c.base?.source === 'estimate' ? 'смета' : null,
      c.base?.revision ?? null,
      c.balance.incoming,
      c.balance.consumed,
      c.balance.stock,
      c.balance.unconfirmed,
      c.forecast.progress,
      c.k,
      c.forecast.kActual,
      c.forecast.total,
      c.forecast.overrunVsEstimate,
      c.forecast.overrunCost,
      c.forecast.verdict,
      c.superseded ? 'лимит переехал в другой класс по действующему ДС' : null,
    ]);
  }
  balance.getColumn(12).numFmt = '0.0%';
  autoWidth(balance, [30, 6, 14, 18, 12, 10, 12, 12, 12, 12, 16, 13, 8, 8, 12, 13, 16, 12, 46]);
  balance.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Конструктивы ─────────────────────────────────────────────────────────
  const byStructure = wb.addWorksheet('Конструктивы');
  styleHeader(
    byStructure.addRow([
      'Код', 'Конструктив', 'Отметка', 'Материал', 'База', 'Редакция', 'Объём базы',
      'Смета', 'Приход', 'Списано', 'Выполнено, %', 'К факт', 'Прогноз', 'Перерасход',
      'Перерасход, ₽', 'Оценка',
    ]),
  );
  for (const s of report.structures) {
    const r = report.byStructure.get(s.id)!;
    for (const c of r.cells) {
      if (c.material.kind !== 'concrete' && !c.material.isAggregate) continue;
      byStructure.addRow([
        s.code,
        `${'    '.repeat(s.depth)}${s.name}`,
        s.level,
        c.material.name,
        c.base?.source ?? null,
        c.base?.revision ?? null,
        c.basePurchase,
        c.estimatePurchase,
        c.balance.incoming,
        c.balance.consumed,
        c.forecast.progress,
        c.forecast.kActual,
        c.forecast.total,
        c.forecast.overrunVsEstimate,
        c.forecast.overrunCost,
        c.forecast.verdict,
      ]);
    }
  }
  byStructure.getColumn(11).numFmt = '0.0%';
  autoWidth(byStructure, [14, 42, 10, 26, 10, 12, 12, 12, 12, 12, 13, 8, 12, 13, 16, 12]);
  byStructure.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Журнал заливок ───────────────────────────────────────────────────────
  const poursSheet = wb.addWorksheet('Журнал заливок');
  styleHeader(
    poursSheet.addRow([
      'Захватка', 'Конструктив', 'Дата', 'Класс бетона', 'Проектный объём, м³',
      'Норма, м³', 'Принято по ТТН, м³', 'Списано по КС-6а, м³', 'К факт', 'Отклонение, м³',
      'Статус', 'Источник',
    ]),
  );
  const ttnByPour = new Map<number, number>();
  for (const d of deliveryRows) {
    if (d.pourId == null) continue;
    ttnByPour.set(d.pourId, (ttnByPour.get(d.pourId) ?? 0) + n(d.quantity));
  }
  const actedByPour = new Map<number, number>();
  for (const i of issueRows) {
    if (i.pourId == null) continue;
    if (materialById.get(i.materialId)?.kind !== 'concrete') continue;
    actedByPour.set(i.pourId, (actedByPour.get(i.pourId) ?? 0) + n(i.quantity));
  }
  for (const p of pourRows) {
    const design = n(p.designVolumeM3);
    const ttn = ttnByPour.get(p.id) ?? 0;
    const acted = actedByPour.get(p.id) ?? 0;
    const fact = ttn + acted;
    poursSheet.addRow([
      p.label,
      structureById.get(p.structureId)?.name ?? null,
      p.pouredAt,
      materialById.get(p.concreteMaterialId)?.concreteClass ?? null,
      design,
      design * 1.05,
      ttn,
      acted,
      design > 0 ? fact / design : null,
      fact > 0 ? fact - design * 1.05 : null,
      p.status,
      p.note === 'ks6a' ? 'импорт КС-6а' : 'ручной ввод',
    ]);
  }
  autoWidth(poursSheet, [26, 40, 12, 12, 18, 12, 18, 20, 9, 15, 14, 16]);
  poursSheet.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Приходы и списания ───────────────────────────────────────────────────
  const del = wb.addWorksheet('Приходы');
  styleHeader(
    del.addRow(['Дата', 'Материал', 'Количество', 'Ед.', 'ТТН', 'Поставщик', 'Захватка', 'Источник']),
  );
  const pourById = new Map(pourRows.map((p) => [p.id, p]));
  for (const d of deliveryRows) {
    const m = materialById.get(d.materialId);
    del.addRow([
      d.date,
      m?.name ?? null,
      n(d.quantity),
      m?.unit ?? null,
      d.ttnNumber,
      d.supplier,
      d.pourId != null ? (pourById.get(d.pourId)?.label ?? null) : m?.kind === 'concrete' ? 'не разнесён' : 'на склад',
      d.source === 'prihody' ? 'импорт' : 'ручной ввод',
    ]);
  }
  autoWidth(del, [12, 30, 13, 6, 16, 20, 30, 14]);
  del.views = [{ state: 'frozen', ySplit: 1 }];

  const iss = wb.addWorksheet('Списания');
  styleHeader(
    iss.addRow(['Дата', 'Материал', 'Количество', 'Ед.', 'Конструктив', 'Захватка', 'Документ', 'Источник']),
  );
  for (const i of issueRows) {
    const m = materialById.get(i.materialId);
    iss.addRow([
      i.date,
      m?.name ?? null,
      n(i.quantity),
      m?.unit ?? null,
      structureById.get(i.structureId)?.name ?? null,
      i.pourId != null ? (pourById.get(i.pourId)?.label ?? null) : null,
      i.document,
      i.source === 'ks6a' ? 'импорт КС-6а' : 'ручной ввод',
    ]);
  }
  autoWidth(iss, [12, 30, 13, 6, 40, 26, 24, 16]);
  iss.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Приходы в прежнем виде: материал × даты ──────────────────────────────
  const matrix = wb.addWorksheet('Приходы (как было)');
  const dates = [...new Set(deliveryRows.map((d) => d.date))].sort();
  styleHeader(
    matrix.addRow([
      'Наименование', 'Кол-во по смете', 'Кол-во по проекту', 'Приход', 'Списано',
      'Склад', 'Остаток лимита', ...dates,
    ]),
  );
  for (const c of report.totals) {
    const daily = new Map<string, number>();
    for (const d of deliveryRows) {
      if (d.materialId !== c.material.id) continue;
      daily.set(d.date, (daily.get(d.date) ?? 0) + n(d.quantity));
    }
    // У агрегатной позиции арматуры своих приходов нет — они лежат на SKU.
    if (c.material.isAggregate) {
      for (const d of deliveryRows) {
        const m = materialById.get(d.materialId);
        if (m?.aggregateId !== c.material.id) continue;
        daily.set(d.date, (daily.get(d.date) ?? 0) + n(d.quantity));
      }
    }
    matrix.addRow([
      c.material.name,
      c.estimatePurchase,
      c.projectPurchase,
      c.balance.incoming,
      c.balance.consumed,
      c.balance.stock,
      c.estimatePurchase != null ? c.estimatePurchase - c.balance.incoming : null,
      ...dates.map((d) => daily.get(d) ?? null),
    ]);
  }
  autoWidth(matrix, [30, 16, 18, 12, 12, 12, 16]);
  matrix.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

  // ── Методика ─────────────────────────────────────────────────────────────
  const method = wb.addWorksheet('Методика');
  method.getColumn(1).width = 34;
  method.getColumn(2).width = 110;
  const lines: [string, string][] = [
    ['Коэффициент бетона', 'К = 1,05. Отношение объёма закупки к конструктивному по ресурсной смете: плита 1736/(1580+73), колонны 854,4/813,75, перекрытия 5067/4826. Подтверждается фактом августа: колонны 25,41/24,2.'],
    ['Коэффициент арматуры', 'К = 1,10. Указан в ресурсной прямым текстом: «Стоимость арматуры (Красх = 1,1)». Покрывает перепуск стыков, подрезку и отходы раскроя.'],
    ['База сравнения', 'Самая точная из доступных: рабочая документация (КЖ) → действующий ДС → смета. Где КЖ не выпущен, база оценочная и помечена в интерфейсе.'],
    ['Списание бетона', 'Бетон не складируется: списание — это привязка ТТН к захватке. Историю до пилота дают закрытые объёмы КС-6а; запись за месяц не создаётся там, где уже есть привязанные ТТН.'],
    ['Списание арматуры', 'Приход на склад по диаметрам, списание актом монтажа на конструктив или захватку.'],
    ['К факт', 'Списано, делённое на выполненную часть базы. Для бетона выполненная часть — проектный объём залитых захваток, для арматуры — проектная масса, приходящаяся на забетонированную долю.'],
    ['Прогноз', 'Списано + (вся база − выполнено) × К факт. При выполнении меньше 10% прогноз помечается предварительным: коэффициент ещё не показателен.'],
    ['Перерасход в рублях', 'Считается по себестоимости из ресурсной (бетон В25 7508, В30 7823 ₽/м³; арматура 54 000 ₽/т) — это реальная потеря подрядчика, а не договорная цена.'],
    ['Не подтверждено', 'Приход минус списание минус склад. У бетона это поставки, не привязанные ни к одной конструкции; у арматуры всегда ноль, потому что непривязанное лежит на складе.'],
    ['Смена класса бетона', 'Плита ЛПК проходила как В25 до ДС3 и как В30 начиная с ДС3. Сметный лимит такого конструктива переезжает в новый класс: «Смета (лимит)» по В30 равна 9397,4 м³ (7661,4 по ресурсной плюс 1736 переехавших), по В25 — 384,7 м³. Колонка «Смета по ресурсной» сохраняет исходные 7661,4 и 2120,7 для сверки; сумма по всем классам в обоих разрезах одна и та же — 10 125,3 м³.'],
  ];
  styleHeader(method.addRow(['Показатель', 'Как считается']));
  for (const [k, v] of lines) {
    const row = method.addRow([k, v]);
    row.alignment = { vertical: 'top', wrapText: true };
  }

  return wb;
}
