'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { auditLog, closings, issues, materials, structures, tiers } from '@/db/schema';
import { requireWrite } from '@/lib/auth';
import { parseKs6aWorkbook, planSheet, sheetMeta, type PlannedMonth } from '@/lib/ks6a';

const MAX_BYTES = 10 * 1024 * 1024;

export interface Ks6aPreview {
  error?: string;
  ok?: string;
  fileName?: string;
  sheets?: {
    name: string;
    revision: string;
    factThrough: string | null;
    months: PlannedMonth[];
  }[];
  /** Код конструктива → название, чтобы показать строку договора и захватки. */
  names?: Record<string, string>;
  materialNames?: Record<string, string>;
  /** Что уже лежит в базе по месяцам — будет заменено (ks6a) или останется (ручной ввод). */
  existing?: Record<string, { ks6a: number; manual: number }>;
}

/** Шаг 1: разбор файла, ничего не пишет. */
export async function previewKs6a(_prev: Ks6aPreview, formData: FormData): Promise<Ks6aPreview> {
  try {
    await requireWrite('closings');
  } catch (e) {
    return { error: (e as Error).message };
  }
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Выберите файл КС-6а (.xls или .xlsx)' };
  if (file.size > MAX_BYTES) return { error: 'Файл больше 10 МБ — это точно КС-6а?' };

  let parsed;
  try {
    parsed = parseKs6aWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch {
    return { error: 'Не удалось прочитать файл: нужен Excel (.xls или .xlsx)' };
  }
  const sheets = parsed
    .map((s) => {
      const meta = sheetMeta(s.name);
      return { name: s.name, ...meta, months: planSheet(s, meta.revision, meta.factThrough) };
    })
    .filter((s) => s.months.length > 0);
  if (sheets.length === 0) {
    return { error: 'В файле нет листа с таблицей КС-6а (шапка «№ п/п», помесячные колонки «объем / стоимость»)' };
  }

  const [structureRows, materialRows, closingRows] = await Promise.all([
    db.select({ code: structures.code, name: structures.name }).from(structures),
    db.select({ code: materials.code, name: materials.name }).from(materials),
    db.select({ period: closings.period, source: closings.source }).from(closings),
  ]);
  const existing: NonNullable<Ks6aPreview['existing']> = {};
  for (const c of closingRows) {
    const e = (existing[c.period] ??= { ks6a: 0, manual: 0 });
    if (c.source === 'ks6a') e.ks6a++;
    else e.manual++;
  }

  return {
    fileName: file.name,
    sheets,
    names: Object.fromEntries(structureRows.map((s) => [s.code, s.name])),
    materialNames: Object.fromEntries(materialRows.map((m) => [m.code, m.name])),
    existing,
  };
}

const applySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  revision: z.string().min(1),
  document: z.string().trim().max(200),
  rows: z
    .array(
      z.object({
        target: z.string().min(1, 'Для каждой строки выберите этаж'),
        material: z.string().min(1),
        quantity: z.number().positive(),
        design: z.number().positive().nullable(),
      }),
    )
    .min(1, 'Нет строк для загрузки'),
});

/**
 * Шаг 2: запись выбранного месяца. Импортированное за этот месяц раньше
 * (source = 'ks6a') заменяется целиком — повторная загрузка исправленной КС
 * не задваивает объём. Ручной ввод не трогается.
 */
export async function applyKs6a(_prev: Ks6aPreview, formData: FormData): Promise<Ks6aPreview> {
  let user;
  try {
    user = await requireWrite('closings');
  } catch (e) {
    return { error: (e as Error).message };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get('payload') ?? ''));
  } catch {
    return { error: 'Повреждённые данные формы — загрузите файл заново' };
  }
  const parsed = applySchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const v = parsed.data;

  const [structureRows, materialRows, tierRows] = await Promise.all([
    db.select({ id: structures.id, code: structures.code, tierId: structures.tierId }).from(structures),
    db.select({ id: materials.id, code: materials.code }).from(materials),
    db.select({ id: tiers.id, fromClosings: tiers.consumptionFromClosings }).from(tiers),
  ]);
  const structureByCode = new Map(structureRows.map((s) => [s.code, s]));
  const materialByCode = new Map(materialRows.map((m) => [m.code, m.id]));
  const fromClosings = new Set(tierRows.filter((t) => t.fromClosings).map((t) => t.id));

  for (const r of v.rows) {
    if (!structureByCode.has(r.target)) return { error: `Конструктив ${r.target} не найден в базе` };
    if (!materialByCode.has(r.material)) return { error: `Материал ${r.material} не найден в базе` };
  }

  const document = v.document || `КС-6а ${v.revision}`;
  let proxy = 0;
  await db.transaction(async (tx) => {
    await tx.delete(closings).where(and(eq(closings.period, v.period), eq(closings.source, 'ks6a')));
    await tx.delete(issues).where(and(eq(issues.date, v.period), eq(issues.source, 'ks6a')));
    for (const r of v.rows) {
      const s = structureByCode.get(r.target)!;
      const materialId = materialByCode.get(r.material)!;
      await tx.insert(closings).values({
        period: v.period,
        structureId: s.id,
        materialId,
        quantity: String(r.quantity),
        designQuantity: r.design != null ? String(r.design) : null,
        revision: v.revision,
        document,
        source: 'ks6a',
        createdBy: user.id,
      });
      // Этажи, где приход не разнесён по конструктивам: другого источника «сколько
      // ушло в конструктив» нет, списание берётся по закрытому объёму — как в импорте.
      if (s.tierId != null && fromClosings.has(s.tierId)) {
        await tx.insert(issues).values({
          date: v.period,
          materialId,
          quantity: String(r.quantity),
          structureId: s.id,
          document,
          source: 'ks6a',
          note: 'Списание по процентовке: приход этажа не разнесён по конструктивам.',
          createdBy: user.id,
        });
        proxy++;
      }
    }
    await tx.insert(auditLog).values({
      userId: user.id,
      action: 'import',
      entity: 'closing',
      entityId: null,
      payload: JSON.stringify(v),
    });
  });

  for (const path of ['/control', '/tiers', '/deliveries', '/closings', '/balance', '/dashboard', '/structures']) {
    revalidatePath(path);
  }
  return {
    ok: `Загружено ${v.rows.length} строк за ${v.period.slice(0, 7)}${proxy ? `, из них ${proxy} списаны по выполнению` : ''}`,
  };
}
