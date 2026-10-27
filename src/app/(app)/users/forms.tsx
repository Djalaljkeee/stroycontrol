'use client';

import { useActionState } from 'react';
import { createUser, resetPassword, updateUser } from '@/actions/users';
import type { ActionState } from '@/actions/records';
import { ActionForm, Field, Select, TextInput } from '@/components/forms';

type RoleOption = { value: string; label: string; hint: string };

export function CreateUserForm({ roles }: { roles: RoleOption[] }) {
  return (
    <ActionForm action={createUser} submitLabel="Создать учётную запись">
      <Field label="Логин" hint="Латиница: ivanov, foreman2">
        <TextInput name="login" autoComplete="off" placeholder="ivanov" />
      </Field>
      <Field label="Имя">
        <TextInput name="name" placeholder="Иванов И. И., прораб 2 участка" />
      </Field>
      <Field label="Роль">
        <Select name="role" defaultValue="">
          <option value="" disabled>
            Выберите роль
          </option>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label} — {r.hint}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Пароль" hint="Не короче 8 символов; передайте лично, сменить можно в профиле">
        <TextInput name="password" type="text" autoComplete="new-password" />
      </Field>
    </ActionForm>
  );
}

const small = 'rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs';

export function UserRowControls({
  userId,
  role,
  isActive,
  roles,
  self,
}: {
  userId: number;
  role: string;
  isActive: boolean;
  roles: RoleOption[];
  self: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(resetPassword, {});
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <form action={updateUser} className="flex items-center gap-1.5">
        <input type="hidden" name="userId" value={userId} />
        <select name="role" defaultValue={role} disabled={self} className={small}>
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select name="isActive" defaultValue={String(isActive)} disabled={self} className={small}>
          <option value="true">активна</option>
          <option value="false">заблокирована</option>
        </select>
        {self ? null : (
          <button type="submit" className={`${small} hover:bg-slate-50`}>
            Сохранить
          </button>
        )}
      </form>
      <form action={action} className="flex items-center gap-1.5">
        <input type="hidden" name="userId" value={userId} />
        <input name="password" placeholder="новый пароль" autoComplete="new-password" className={`${small} w-32`} />
        <button type="submit" disabled={pending} className={`${small} hover:bg-slate-50`}>
          Задать
        </button>
        {state.error ? <span className="text-xs text-red-700">{state.error}</span> : null}
        {state.ok ? <span className="text-xs text-emerald-700">{state.ok}</span> : null}
      </form>
    </div>
  );
}
