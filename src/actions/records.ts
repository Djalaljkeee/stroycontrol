'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { auditLog, deliveries, issues, materials, pours } from '@/db/schema';
import { requireWrite } from '@/lib/auth';

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
  revalidatePath('/pours');
  revalidatePath('/balance');
  revalidatePath('/dashboard');
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

// ── Приходы ─────────────────────────────────────────────────────────────────

const deliverySchema = z.object({
  date: isoDate,
  materialId: z.coerce.number().int().positive('Выберите материал'),
  quantity: decimal,
  pourId: z
    .string()
    .optional()
    .transform((v) => (v && v !== '' ? Number(v) : null)),
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

  const [material] = await db.select().from(materials).where(eq(materials.id, v.materialId));
  if (!material) return fail('Материал не найден');

  // Бетон не складируется: поставка без захватки сразу становится
  // неподтверждённым расходом, поэтому привязку требуем при вводе.
  if (material.kind === 'concrete' && v.pourId == null) {
    return fail('Для бетона укажите захватку: без неё поставка попадёт в неподтверждённый расход');
  }
  if (material.kind === 'rebar' && v.pourId != null) {
    return fail('Арматура приходит на склад — списывать её нужно актом монтажа, а не приходом');
  }
  if (material.kind === 'rebar' && material.isAggregate) {
    return fail('Приход арматуры вводится по конкретному диаметру, а не общей позицией');
  }

  const [row] = await db
    .insert(deliveries)
    .values({
      date: v.date,
      materialId: v.materialId,
      quantity: String(v.quantity),
      pourId: v.pourId,
      ttnNumber: v.ttnNumber || null,
      supplier: v.supplier || null,
      createdBy: user.id,
    })
    .returning({ id: deliveries.id });

  await audit(user.id, 'create', 'delivery', row.id, v);
  revalidatePath('/deliveries');
  revalidatePath('/balance');
  revalidatePath('/dashboard');
  return { ok: `Приход ${v.quantity} ${material.unit} записан` };
}

const allocateSchema = z.object({
  deliveryId: z.coerce.number().int().positive(),
  pourId: z.coerce.number().int().positive('Выберите захватку'),
});

/** Разнесение импортированного прихода бетона по захваткам. */
export async function allocateDelivery(formData: FormData): Promise<void> {
  const user = await requireWrite('deliveries');
  const v = allocateSchema.parse(Object.fromEntries(formData));

  await db
    .update(deliveries)
    .set({ pourId: v.pourId, needsAllocation: false })
    .where(eq(deliveries.id, v.deliveryId));

  await audit(user.id, 'allocate', 'delivery', v.deliveryId, v);
  revalidatePath('/deliveries');
  revalidatePath('/balance');
  revalidatePath('/dashboard');
}

// ── Списания ────────────────────────────────────────────────────────────────

const issueSchema = z.object({
  date: isoDate,
  materialId: z.coerce.number().int().positive('Выберите материал'),
  quantity: decimal,
  structureId: z.coerce.number().int().positive('Выберите конструктив'),
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

  const [row] = await db
    .insert(issues)
    .values({
      date: v.date,
      materialId: v.materialId,
      quantity: String(v.quantity),
      structureId: v.structureId,
      pourId: v.pourId,
      document: v.document || null,
      createdBy: user.id,
    })
    .returning({ id: issues.id });

  await audit(user.id, 'create', 'issue', row.id, v);
  revalidatePath('/issues');
  revalidatePath('/balance');
  revalidatePath('/dashboard');
  return { ok: `Списано ${v.quantity} ${material.unit}` };
}

/** Захватки, к которым можно привязать поставку бетона данного класса. */
export async function pourOptions(materialId: number) {
  return db
    .select({ id: pours.id, label: pours.label, pouredAt: pours.pouredAt, structureId: pours.structureId })
    .from(pours)
    .where(and(eq(pours.concreteMaterialId, materialId)))
    .orderBy(pours.pouredAt);
}
