'use client';

import { useActionState } from 'react';
import { login, type LoginState } from '@/actions/auth';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="text-xs text-slate-600">Логин</span>
        <input
          name="login"
          autoComplete="username"
          autoFocus
          className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-sky-500"
        />
      </label>
      <label className="block">
        <span className="text-xs text-slate-600">Пароль</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-sky-500"
        />
      </label>
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? 'Вход…' : 'Войти'}
      </button>
    </form>
  );
}
