'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { auditLog, closings, deliveries, issues, materials, pours, structures } from '@/db/schema';
import { canWrite, requireWrite } from '@/lib/auth';
import { parseTarget } from '@/lib/targets';
import { buildProtection } from '@/lib/protection';

export type ActionState = { error?: string; ok?: string };

const fail = (error: string): ActionState => ({ error });

/** Числа в формах вводят с запятой — на объекте так привычнее. */
const decimal = z
  .string()
  .trim()
  .min(1, 'Укажите количество')
  .transform((v) => Number(v.replace(',', '.').replace(/\s/g, '')))
  .refine((v) => Number.isFinite(v) && v > 0, 'Количество должно быть положительным числом');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Укажите дату');

/** Ярус конструктива — чтобы приход, разнесённый на захватку, был виден и в разрезе ярусов. */
async function tierOfStructure(structureId: number): Promise<number | null> {
  const [row] = await db.select({ tierId: structures.tierId }).from(structures).where(eq(structures.id, structureId));
  return row?.tierId ?? null;
}

function revalidateAll() {
  for (const path of ['/control', '/tiers', '/deliveries', '/issues', '/closings', '/balance', '/dashboard', '/structures']) {
    revalidatePath(path);
  }
}

async function audit(userId: number, action: string, entity: string, entityId: number, payload: unknown) {
  await db.insert(auditLog).values({
    userId,
    action,
    entity,
    entityId,
    payload: JSON.stringify(payload),
  });
}

// ── Захватки ────────────────────────────────────────────────────────────────

const pourSchema = z.object({
  structureId: z.coerce.number().int().positive('Выберите конструктив'),
  label: z.string().trim().min(1, 'Укажите номер или название захватки'),
  pouredAt: isoDate,
  designVolumeM3: decimal,
  concreteMaterialId: z.coerce.number().int().positive('Выберите класс бетона'),
  status: z.enum(['planned', 'in_progress', 'done']),
});

export async function createPour(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let user;
  try {
    user = await requireWrite('pours');
  } catch (e) {
    return fail((e as Error).message);
  }

  const parsed = pourSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);
  const v = parsed.data;

  const [row] = await db
    .insert(pours)
    .values({
      structureId: v.structureId,
      label: v.label,
      pouredAt: v.pouredAt,
      designVolumeM3: String(v.designVolumeM3),
      concreteMaterialId: v.concreteMaterialId,
      status: v.status,
      createdBy: user.id,
    })
    .returning({ id: pours.id });

  await audit(user.id, 'create', 'pour', row.id, v);
  revalidateAll();
  revalidatePath('/pours');
  return { ok: `Захватка «${v.label}» создана` };
}

const statusSchema = z.object({
  pourId: z.coerce.number().int().positive(),
  status: z.enum(['planned', 'in_progress', 'done']),
});

export async function setPourStatus(formData: FormData): Promise<void> {
  const user = await requireWrite('pours');
  const v = statusSchema.parse(Object.fromEntries(formData));
  await db.update(pours).set({ status: v.status }).where(eq(pours.id, v.pourId));
  await audit(user.id, 'status', 'pour', v.pourId, v);
  revalidatePath('/pours');
  revalidatePath('/balance');
  revalidatePath('/dashboard');
}

// ── Выполнение конструктива ─────────────────────────────────────────────────

const completeSchema = z.object({
  target: z.string().min(1, 'Выберите конструктив'),
  date: isoDate,
  /** Пусто — весь оставшийся объём по проекту. */
  volume: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== '' ? Number(v.replace(',', '.').replace(/\s/g, '')) : null))
    .refine((v) => v == null || (Number.isFinite(v) && v > 0), 'Объём — положительное число'),
  concreteMaterialId: z
    .string()
    .optional()
    .transform((v) => (v && v !== '' ? Number(v) : null)),
  label: z.string().trim().optional(),
});

/**
 * Прораб отмечает, что конструктив (или его часть) забетонирован. С этой даты
 * объём ждёт защиты: сметчик должен закрыть его процентовкой этого же месяца.
 */
export async function completeStructure(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let user;
  try {
    user = await requireWrite('pours');
  } catch (e) {
    return fail((e as Error).message);
  }
  const parsed = completeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);
  const v = parsed.data;
  const { structureId } = parseTarget(v.target);
  if (structureId == null) return fail('Выполнение отмечается на конструктив этажа, а не на этаж целиком');

  const { rows } = await buildProtection();
  const candidates = rows.filter(
    (r) => r.structureId === structureId && (v.concreteMaterialId == null || r.materialId === v.concreteMaterialId),
  );
  const row = candidates.find((r) => r.project != null) ?? candidates[0];
  if (!row && v.concreteMaterialId == null) {
    return fail('У конструктива нет проектного объёма — укажите класс бетона и объём');
  }
  if (candidates.length > 1 && v.concreteMaterialId == null) {
    return fail('У конструктива несколько классов бетона — выберите класс');
  }
  const materialId = row?.materialId ?? v.concreteMaterialId!;
  const remaining = row?.project != null ? row.project - row.executed : null;
  const volume = v.volume ?? remaining;
  if (volume == null) return fail('Проектного объёма нет — укажите объём');
  if (volume <= 0.005) return fail('Конструктив уже выполнен полностью');

  const full = remaining != null && volume >= remaining - 0.005;
  const label = v.label || (full ? 'Выполнен полностью' : 'Частично');
  const [created] = await db
    .insert(pours)
    .values({
      structureId,
      label,
      pouredAt: v.date,
      designVolumeM3: String(volume),
      concreteMaterialId: materialId,
      status: 'done',
      createdBy: user.id,
    })
    .returning({ id: pours.id });

  await audit(user.id, 'complete', 'pour', created.id, { ...v, structureId, materialId, volume });
  revalidateAll();
  revalidatePath('/pours');
  revalidatePath('/control');
  return { ok: `Отмечено выполнение ${volume.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м³` };
}

// ── Приходы ─────────────────────────────────────────────────────────────────

const deliverySchema = z.object({
  date: isoDate,
  materialId: z.coerce.number().int().positive('Выберите материал'),
  quantity: decimal,
  target: z.string().optional(),
  ttnNumber: z.string().trim().optional(),
  supplier: z.string().trim().optional(),
});

export async function createDelivery(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let user;
  try {
    user = await requireWrite('deliveries');
  } catch (e) {
    return fail((e as Error).message);
  }

  const parsed = deliverySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);
  const v = parsed.data;
  const target = parseTarget(v.target);

  const [material] = await db.select().from(materials).where(eq(materials.id, v.materialId));
  if (!material) return fail('Материал не найден');

  // Бетон не складируется: поставка без разнесения сразу становится
  // неподтверждённым расходом, поэтому куда он ушёл, спрашиваем при вводе.
  // Снабжение может принять ТТН без разнесения — поставка встанет прорабу в очередь
  // «Бетон без разнесения». Тот, кто разносит сам, обязан указать куда сразу.
  if (
    material.kind === 'concrete' &&
    target.structureId == null &&
    target.tierId == null &&
    canWrite(user, 'allocate')
  ) {
    return fail('Для бетона укажите конструктив или этаж: без этого поставка попадёт в неподтверждённый расход');
  }
  if (material.kind === 'rebar' && material.isAggregate) {
    return fail('Приход арматуры вводится по конкретному диаметру, а не общей позицией');
  }

  const tierId = target.structureId != null ? await tierOfStructure(target.structureId) : target.tierId;
  const [row] = await db
    .insert(deliveries)
    .values({
      date: v.date,
      materialId: v.materialId,
      quantity: String(v.quantity),
      structureId: target.structureId,
      tierId,
      ttnNumber: v.ttnNumber || null,
      supplier: v.supplier || null,
      createdBy: user.id,
    })
    .returning({ id: deliveries.id });

  await audit(user.id, 'create', 'delivery', row.id, v);
  revalidateAll();
  const where =
    target.structureId != null ? 'на конструктив' : target.tierId != null ? 'на этаж' : 'на склад';
  return { ok: `Приход ${v.quantity} ${material.unit} записан ${where}` };
}

const allocateSchema = z.object({
  deliveryId: z.coerce.number().int().positive(),
  target: z.string().min(1, 'Выберите, куда разнести'),
});

/**
 * Разнесение прихода: на конструктив (это и есть списание) или на ярус целиком.
 * Повторное разнесение уточняет прежнее — например, приход «на ярус 2» переносится
 * на «стены +5,920», когда прораб сверил ТТН с захватками.
 */
export async function allocateDelivery(formData: FormData): Promise<void> {
  const user = await requireWrite('allocate');
  const v = allocateSchema.parse(Object.fromEntries(formData));
  const target = parseTarget(v.target);
  if (target.structureId == null && target.tierId == null) throw new Error('Не выбрано, куда разнести');

  const tierId = target.structureId != null ? await tierOfStructure(target.structureId) : target.tierId;
  await db
    .update(deliveries)
    .set({ structureId: target.structureId, tierId, pourId: null, needsAllocation: false })
    .where(eq(deliveries.id, v.deliveryId));

  await audit(user.id, 'allocate', 'delivery', v.deliveryId, { ...v, ...target, tierId });
  revalidateAll();
}

// ── Списания ────────────────────────────────────────────────────────────────

const issueSchema = z.object({
  date: isoDate,
  materialId: z.coerce.number().int().positive('Выберите материал'),
  quantity: decimal,
  target: z.string().min(1, 'Выберите конструктив'),
  pourId: z
    .string()
    .optional()
    .transform((v) => (v && v !== '' ? Number(v) : null)),
  document: z.string().trim().optional(),
});

export async function createIssue(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let user;
  try {
    user = await requireWrite('issues');
  } catch (e) {
    return fail((e as Error).message);
  }

  const parsed = issueSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);
  const v = parsed.data;

  const [material] = await db.select().from(materials).where(eq(materials.id, v.materialId));
  if (!material) return fail('Материал не найден');
  if (material.kind !== 'rebar') {
    return fail('Актом монтажа списывается арматура; бетон списывается привязкой ТТН к захватке');
  }
  const { structureId } = parseTarget(v.target);
  if (structureId == null) return fail('Списание делается на конструктив, а не на этаж целиком');

  const [row] = await db
    .insert(issues)
    .values({
      date: v.date,
      materialId: v.materialId,
      quantity: String(v.quantity),
      structureId,
      pourId: v.pourId,
      document: v.document || null,
      createdBy: user.id,
    })
    .returning({ id: issues.id });

  await audit(user.id, 'create', 'issue', row.id, v);
  revalidateAll();
  return { ok: `Списано ${v.quantity} ${material.unit}` };
}

// ── Процентовка ─────────────────────────────────────────────────────────────

const closingSchema = z.object({
  /** Месяц из <input type="month">: '2026-11'. Хранится последним днём месяца. */
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Укажите месяц'),
  target: z.string().min(1, 'Выберите конструктив'),
  materialId: z.coerce.number().int().positive('Выберите материал'),
  quantity: decimal,
  designQuantity: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== '' ? Number(v.replace(',', '.').replace(/\s/g, '')) : null))
    .refine((v) => v == null || (Number.isFinite(v) && v > 0), 'Объём конструктива — положительное число'),
  document: z.string().trim().optional(),
});

/**
 * Запись процентовки за месяц: сколько закрыто перед заказчиком по строке КС-6а.
 * Количество — в единицах строки поставки (м3 закупки, т арматуры); объём
 * конструктива — по строке работ, от него считается выполнение.
 */
export async function createClosing(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let user;
  try {
    user = await requireWrite('closings');
  } catch (e) {
    return fail((e as Error).message);
  }

  const parsed = closingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fail(parsed.error.issues[0]!.message);
  const v = parsed.data;
  const { structureId } = parseTarget(v.target);
  if (structureId == null) return fail('Процентовка закрывается на конструктив или захватку, а не на этаж');

  const [material] = await db.select().from(materials).where(eq(materials.id, v.materialId));
  if (!material) return fail('Материал не найден');
  if (material.kind === 'concrete' && v.designQuantity == null) {
    return fail('Для бетона укажите и объём конструктива по строке работ — от него считается выполнение');
  }

  const [year, month] = v.month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const [row] = await db
    .insert(closings)
    .values({
      period: lastDay,
      structureId,
      materialId: v.materialId,
      quantity: String(v.quantity),
      designQuantity: v.designQuantity != null ? String(v.designQuantity) : null,
      document: v.document || null,
      createdBy: user.id,
    })
    .returning({ id: closings.id });

  await audit(user.id, 'create', 'closing', row.id, v);
  revalidateAll();
  return { ok: `Запроцентовано ${v.quantity} ${material.unit} за ${v.month}` };
}

/** Захватки, к которым можно привязать поставку бетона данного класса. */
export async function pourOptions(materialId: number) {
  return db
    .select({ id: pours.id, label: pours.label, pouredAt: pours.pouredAt, structureId: pours.structureId })
    .from(pours)
    .where(and(eq(pours.concreteMaterialId, materialId)))
    .orderBy(pours.pouredAt);
}
