'use client';

import { useActionState, useState } from 'react';
import { deleteRole, saveRole } from '@/actions/users';
import type { ActionState } from '@/actions/records';
import { HOME_SECTIONS, SECTIONS, WRITE_SECTIONS } from '@/lib/access';

export interface RoleData {
  code: string;
  name: string;
  description: string | null;
  view: string[];
  write: string[];
  home: string;
  isSystem: boolean;
  users: number;
}

const control =
  'mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-sky-500';

/** Форма роли: что видно, что можно вводить, куда попадать после входа. */
export function RoleForm({ role }: { role?: RoleData }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveRole, {});
  const [view, setView] = useState<Set<string>>(new Set(role?.view ?? []));
  const [write, setWrite] = useState<Set<string>>(new Set(role?.write ?? []));

  const toggle = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };
  const onWrite = (key: string, on: boolean) => {
    setWrite(toggle(write, key, on));
    // Вводить в раздел, которого не видишь, нельзя — раздел отмечается сам.
    const needs = WRITE_SECTIONS.find((w) => w.key === key)!.needs;
    if (on) setView(toggle(view, needs, true));
  };

  return (
    <form action={action} className="space-y-3">
      {role ? <input type="hidden" name="code" value={role.code} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs text-slate-600">Название</span>
          <input name="name" defaultValue={role?.name} placeholder="Прораб 2 участка" className={control} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs text-slate-600">Описание</span>
          <input
            name="description"
            defaultValue={role?.description ?? ''}
            placeholder="что делает человек с этой ролью"
            className={control}
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <fieldset>
          <legend className="text-xs font-medium text-slate-700">Видит разделы</legend>
          <div className="mt-1 space-y-1">
            {SECTIONS.map((s) => (
              <label key={s.key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="view"
                  value={s.key}
                  checked={view.has(s.key)}
                  onChange={(e) => setView(toggle(view, s.key, e.target.checked))}
                  className="mt-0.5"
                />
                <span>
                  {s.label} <span className="text-xs text-slate-400">— {s.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-4">
          <fieldset>
            <legend className="text-xs font-medium text-slate-700">Может вносить</legend>
            <div className="mt-1 space-y-1">
              {WRITE_SECTIONS.map((w) => (
                <label key={w.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="write"
                    value={w.key}
                    checked={write.has(w.key)}
                    onChange={(e) => onWrite(w.key, e.target.checked)}
                  />
                  {w.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="text-xs text-slate-600">Стартовый экран после входа</span>
            <select name="home" defaultValue={role?.home ?? ''} className={control}>
              <option value="" disabled>
                Выберите раздел
              </option>
              {HOME_SECTIONS.filter((s) => view.has(s.key)).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? 'Сохранение…' : role ? 'Сохранить роль' : 'Создать роль'}
        </button>
        {state.error ? <span className="text-sm text-red-700">{state.error}</span> : null}
        {state.ok ? <span className="text-sm text-emerald-700">{state.ok}</span> : null}
      </div>
    </form>
  );
}

export function DeleteRoleButton({ code }: { code: string }) {
  return (
    <form
      action={deleteRole}
      onSubmit={(e) => {
        if (!confirm('Удалить роль?')) e.preventDefault();
      }}
    >
      <input type="hidden" name="code" value={code} />
      <button type="submit" className="text-xs text-red-700 underline">
        Удалить роль
      </button>
    </form>
  );
}
