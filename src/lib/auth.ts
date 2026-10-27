import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq, gt } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '@/db';
import { roles, sessions, users } from '@/db/schema';
import { hrefOf, type Section, type WriteSection } from './access';

/**
 * Аутентификация сделана своей, а не на Auth.js v5, сознательно.
 *
 * На момент разработки все версии next-auth 5.0.0-beta попадают под advisory
 * GHSA-8fpg-xm3f-6cx3: при ошибке конфигурации объект сессии заполняется
 * ошибкой, и проверки вида «сессия существует» проходят успешно для
 * неаутентифицированного запроса. Пилоту нужны только логин-пароль на пять
 * именованных учёток — ни OAuth, ни magic link, ни адаптеров. Непрозрачный
 * серверный токен покрывает эту задачу целиком и не тянет за собой чужую
 * поверхность атаки.
 */

const COOKIE = 'stroycontrol_session';
const TTL_DAYS = 30;

export interface SessionUser {
  id: number;
  login: string;
  name: string;
  role: string;
  roleName: string;
  roleDescription: string | null;
  view: Section[];
  write: WriteSection[];
  /** Стартовая страница роли. */
  home: string;
}

/** В таблице лежит хэш токена: дамп базы не даёт войти под чужой учёткой. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function verifyCredentials(
  login: string,
  password: string,
): Promise<SessionUser | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.login, login.trim().toLowerCase()), eq(users.isActive, true)))
    .limit(1);

  // Сравнение выполняется и при отсутствии пользователя, чтобы время ответа
  // не выдавало, существует ли такой логин.
  const hash = user?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(password, hash);
  if (!user || !ok) return null;

  return loadSessionUser(user.id);
}

/** Пользователь вместе с правами его роли — права читаются из БД при каждом запросе. */
async function loadSessionUser(userId: number): Promise<SessionUser | null> {
  const [row] = await db
    .select({ user: users, role: roles })
    .from(users)
    .innerJoin(roles, eq(roles.code, users.role))
    .where(and(eq(users.id, userId), eq(users.isActive, true)))
    .limit(1);
  if (!row) return null;
  const view = row.role.viewSections as Section[];
  return {
    id: row.user.id,
    login: row.user.login,
    name: row.user.name,
    role: row.role.code,
    roleName: row.role.name,
    roleDescription: row.role.description,
    view,
    write: row.role.writeSections as WriteSection[],
    // Стартовая страница должна быть доступна роли — иначе вход зациклится.
    home: view.includes(row.role.home as Section) ? hrefOf(row.role.home) : view[0] ? hrefOf(view[0]) : '/account',
  };
}

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  store.delete(COOKIE);
}

/** Хэш токена текущей сессии — чтобы при смене пароля закрыть все сессии, кроме неё. */
export async function currentSessionHash(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? hashToken(token) : null;
}

export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      id: users.id,
      login: users.login,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      tokenHash: sessions.tokenHash,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row || !row.isActive) return null;

  // Токен из cookie сверяется с хранимым хэшем ещё раз, в постоянное время:
  // выборка по индексу уже совпала, но явная сверка исключает случай, когда
  // условие where было бы ослаблено при будущей правке запроса.
  const a = Buffer.from(row.tokenHash);
  const b = Buffer.from(hashToken(token));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return loadSessionUser(row.id);
}

export function canView(user: SessionUser | null, section: Section): boolean {
  return user != null && user.view.includes(section);
}

/** Для страниц: без входа — на логин, без доступа к разделу — на свой стартовый экран. */
export async function requirePage(section: Section): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!canView(user, section)) redirect(user.home);
  return user;
}

export function canWrite(user: SessionUser | null, section: WriteSection): boolean {
  return user != null && user.write.includes(section);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new Error('Требуется вход в систему');
  return user;
}

export async function requireWrite(section: WriteSection): Promise<SessionUser> {
  const user = await requireUser();
  if (!canWrite(user, section)) {
    throw new Error(`Роль «${user.roleName}» не может изменять этот раздел`);
  }
  return user;
}

export type { Section, WriteSection };
