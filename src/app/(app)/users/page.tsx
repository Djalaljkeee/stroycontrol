import { asc, inArray, max } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, roles, sessions, users } from '@/db/schema';
import { date } from '@/lib/format';
import { requirePage } from '@/lib/auth';
import { SECTIONS, WRITE_SECTIONS } from '@/lib/access';
import { Card } from '@/components/ui';
import { CreateUserForm, UserRowControls } from './forms';
import { DeleteRoleButton, RoleForm, type RoleData } from './roles';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Учётные записи — СтройКонтроль' };

export default async function UsersPage() {
  const me = await requirePage('users');
  const [rows, roleRows, lastSeen] = await Promise.all([
    db.select().from(users).orderBy(asc(users.id)),
    db.select().from(roles).orderBy(asc(roles.sortOrder), asc(roles.name)),
    db.select({ userId: auditLog.userId, at: max(auditLog.createdAt) }).from(auditLog).groupBy(auditLog.userId),
  ]);
  const activeSessions = rows.length
    ? await db
        .select({ userId: sessions.userId })
        .from(sessions)
        .where(inArray(sessions.userId, rows.map((u) => u.id)))
    : [];
  const sessionCount = new Map<number, number>();
  for (const s of activeSessions) sessionCount.set(s.userId, (sessionCount.get(s.userId) ?? 0) + 1);
  const lastAction = new Map<number, Date>();
  for (const a of lastSeen) if (a.userId != null && a.at != null) lastAction.set(a.userId, a.at);

  const roleData: RoleData[] = roleRows.map((r) => ({
    code: r.code,
    name: r.name,
    description: r.description,
    view: r.viewSections,
    write: r.writeSections,
    home: r.home,
    isSystem: r.isSystem,
    users: rows.filter((u) => u.role === r.code).length,
  }));
  const roleName = new Map(roleRows.map((r) => [r.code, r.name]));
  const options = roleData.map((r) => ({ value: r.code, label: r.name, hint: r.description ?? '' }));
  const sectionLabel = new Map<string, string>(SECTIONS.map((s) => [s.key, s.label]));
  const writeLabel = new Map<string, string>(WRITE_SECTIONS.map((s) => [s.key, s.label]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Учётные записи и роли</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-600">
          У каждого человека — своя учётка: в журнале видно, кто что внёс. Роль задаёт, какие
          разделы человек видит, что может вводить и какой экран открывается после входа. Роли
          можно создавать и перенастраивать — права применяются сразу. Смена роли, блокировка и
          новый пароль закрывают все входы пользователя.
        </p>
      </div>

      <Card title="Новый пользователь">
        <CreateUserForm roles={options} />
      </Card>

      <Card title="Пользователи">
        <div className="overflow-x-auto">
          <table className="grid-table text-sm">
            <thead>
              <tr>
                <th>Логин</th>
                <th>Имя</th>
                <th>Роль</th>
                <th>Входов открыто</th>
                <th>Последнее действие</th>
                <th>Роль · доступ · пароль</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className={u.isActive ? undefined : 'text-slate-400'}>
                  <td>{u.login}</td>
                  <td>{u.name}</td>
                  <td>
                    {roleName.get(u.role) ?? u.role}
                    {u.isActive ? '' : ' · заблокирована'}
                  </td>
                  <td>{sessionCount.get(u.id) ?? 0}</td>
                  <td>{lastAction.has(u.id) ? date(lastAction.get(u.id)!) : '—'}</td>
                  <td>
                    <UserRowControls
                      userId={u.id}
                      role={u.role}
                      isActive={u.isActive}
                      roles={options}
                      self={u.id === me.id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Роли" hint="Раскройте роль, чтобы изменить права. Встроенные роли можно перенастроить, но не удалить.">
        <div className="space-y-2">
          {roleData.map((r) => (
            <details key={r.code} className="rounded border border-slate-200">
              <summary className="cursor-pointer px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">{r.name}</span>
                <span className="ml-2 text-slate-500">
                  {r.users} польз. · видит: {r.view.map((k) => sectionLabel.get(k) ?? k).join(', ') || '—'}
                  {r.write.length > 0
                    ? ` · вносит: ${r.write.map((k) => writeLabel.get(k) ?? k).join(', ')}`
                    : ' · только просмотр'}
                </span>
              </summary>
              <div className="space-y-3 border-t border-slate-200 p-3">
                <RoleForm role={r} />
                {!r.isSystem && r.users === 0 ? <DeleteRoleButton code={r.code} /> : null}
              </div>
            </details>
          ))}
        </div>
      </Card>

      <Card title="Новая роль">
        <RoleForm />
      </Card>
    </div>
  );
}
