'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '@/db';
import { auditLog, roles, sessions, users } from '@/db/schema';
import { canView, currentSessionHash, currentUser, verifyCredentials, type SessionUser } from '@/lib/auth';
import { HOME_SECTIONS, SECTION_KEYS, WRITE_KEYS, WRITE_SECTIONS, type Section } from '@/lib/access';
import type { ActionState } from './records';

const MIN_PASSWORD = 8;

const password = z.string().min(MIN_PASSWORD, `Пароль — не короче ${MIN_PASSWORD} символов`);

async function requireAdmin(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user || !canView(user, 'users')) throw new Error('Управлять учётными записями может только администратор');
  return user;
}

async function audit(userId: number, action: string, entityId: number | null, payload: unknown, entity = 'user') {
  await db.insert(auditLog).values({ userId, action, entity, entityId, payload: JSON.stringify(payload) });
}

async function roleExists(code: string) {
  const [row] = await db.select({ code: roles.code }).from(roles).where(eq(roles.code, code));
  return row != null;
}

/** После смены пароля, роли или блокировки старые сессии не должны жить дальше. */
async function dropSessions(userId: number) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

const createSchema = z.object({
  login: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, 'Логин — латиница, цифры, точка, дефис; 3–32 символа'),
  name: z.string().trim().min(2, 'Укажите имя'),
  role: z.string().min(1, 'Выберите роль'),
  password,
});

export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const v = parsed.data;

  if (!(await roleExists(v.role))) return { error: 'Такой роли нет' };
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.login, v.login));
  if (exists) return { error: `Логин «${v.login}» уже занят` };

  const [row] = await db
    .insert(users)
    .values({ login: v.login, name: v.name, role: v.role, passwordHash: await bcrypt.hash(v.password, 12) })
    .returning({ id: users.id });
  await audit(admin.id, 'create', row.id, { login: v.login, name: v.name, role: v.role });
  revalidatePath('/users');
  return { ok: `Учётная запись ${v.login} создана` };
}

const updateSchema = z.object({
  userId: z.coerce.number().int().positive(),
  role: z.string().min(1),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

/** Роль и блокировка. Себя администратор понизить или заблокировать не может — иначе некому чинить. */
export async function updateUser(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const v = updateSchema.parse(Object.fromEntries(formData));
  if (v.userId === admin.id && (v.role !== admin.role || !v.isActive)) {
    throw new Error('Свою роль и доступ меняет другой администратор');
  }
  const [before] = await db.select().from(users).where(eq(users.id, v.userId));
  if (!before) throw new Error('Учётная запись не найдена');
  if (!(await roleExists(v.role))) throw new Error('Такой роли нет');

  await db.update(users).set({ role: v.role, isActive: v.isActive }).where(eq(users.id, v.userId));
  if (before.role !== v.role || !v.isActive) await dropSessions(v.userId);
  await audit(admin.id, 'update', v.userId, { role: v.role, isActive: v.isActive });
  revalidatePath('/users');
}

const resetSchema = z.object({ userId: z.coerce.number().int().positive(), password });

export async function resetPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const v = parsed.data;

  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(v.password, 12) })
    .where(eq(users.id, v.userId));
  await dropSessions(v.userId);
  await audit(admin.id, 'reset_password', v.userId, {});
  return { ok: 'Пароль задан, прежние входы сброшены' };
}

const changeSchema = z
  .object({ current: z.string().min(1, 'Введите текущий пароль'), next: password, repeat: z.string() })
  .refine((v) => v.next === v.repeat, 'Новый пароль и повтор не совпадают');

/** Смена своего пароля. Остальные сессии пользователя закрываются, текущая остаётся. */
export async function changeOwnPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { error: 'Требуется вход в систему' };
  const parsed = changeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  if (!(await verifyCredentials(user.login, parsed.data.current))) return { error: 'Текущий пароль неверен' };

  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(parsed.data.next, 12) })
    .where(eq(users.id, user.id));
  const keep = await currentSessionHash();
  await db
    .delete(sessions)
    .where(keep ? and(eq(sessions.userId, user.id), ne(sessions.tokenHash, keep)) : eq(sessions.userId, user.id));
  await audit(user.id, 'change_password', user.id, {});
  return { ok: 'Пароль изменён' };
}

// ── Роли ────────────────────────────────────────────────────────────────────

const roleSchema = z.object({
  code: z.string().optional(),
  name: z.string().trim().min(2, 'Укажите название роли'),
  description: z.string().trim().optional(),
  home: z.string().min(1, 'Выберите стартовый раздел'),
});

/**
 * Права из формы: отмеченные разделы и разрешения на ввод. Ввод без просмотра
 * раздела бессмыслен, поэтому нужный раздел добавляется к просмотру сам.
 */
function permissionsFrom(formData: FormData) {
  const view = new Set(formData.getAll('view').map(String).filter((k) => SECTION_KEYS.includes(k as Section)));
  const write = formData.getAll('write').map(String).filter((k) => (WRITE_KEYS as string[]).includes(k));
  for (const w of write) view.add(WRITE_SECTIONS.find((x) => x.key === w)!.needs);
  return { view: SECTION_KEYS.filter((k) => view.has(k)), write };
}

export async function saveRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = roleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const v = parsed.data;
  const { view, write } = permissionsFrom(formData);
  if (view.length === 0) return { error: 'Отметьте хотя бы один раздел' };
  if (!HOME_SECTIONS.some((h) => h.key === v.home) || !view.includes(v.home as Section)) {
    return { error: 'Стартовый раздел должен быть среди доступных роли' };
  }

  if (v.code) {
    const [before] = await db.select().from(roles).where(eq(roles.code, v.code));
    if (!before) return { error: 'Роль не найдена' };
    // Иначе можно отрезать себе управление и остаться без администратора.
    if (v.code === admin.role && !view.includes('users')) {
      return { error: 'Нельзя убрать «Учётные записи» у своей роли' };
    }
    await db
      .update(roles)
      .set({ name: v.name, description: v.description || null, viewSections: view, writeSections: write, home: v.home })
      .where(eq(roles.code, v.code));
    await audit(admin.id, 'update', null, { code: v.code, name: v.name, view, write, home: v.home }, 'role');
    revalidatePath('/users');
    return { ok: `Роль «${v.name}» сохранена — права применяются сразу` };
  }

  const code = `r_${Date.now().toString(36)}`;
  await db.insert(roles).values({
    code,
    name: v.name,
    description: v.description || null,
    viewSections: view,
    writeSections: write,
    home: v.home,
    isSystem: false,
  });
  await audit(admin.id, 'create', null, { code, name: v.name, view, write, home: v.home }, 'role');
  revalidatePath('/users');
  return { ok: `Роль «${v.name}» создана` };
}

export async function deleteRole(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const code = String(formData.get('code') ?? '');
  const [role] = await db.select().from(roles).where(eq(roles.code, code));
  if (!role) throw new Error('Роль не найдена');
  if (role.isSystem) throw new Error('Встроенную роль удалить нельзя — её можно перенастроить');
  const [used] = await db.select({ id: users.id }).from(users).where(eq(users.role, code)).limit(1);
  if (used) throw new Error('Роль назначена пользователям — сначала смените им роль');
  await db.delete(roles).where(eq(roles.code, code));
  await audit(admin.id, 'delete', null, { code, name: role.name }, 'role');
  revalidatePath('/users');
}
