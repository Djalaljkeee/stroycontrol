'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/actions/records';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-600">{label}</span>
      {children}
      {hint ? <span className="mt-0.5 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

const control =
  'mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-sky-500';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={control} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={control} />;
}

export function ActionForm({
  action,
  submitLabel,
  children,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? 'Сохранение…' : submitLabel}
        </button>
        {state.error ? <span className="text-sm text-red-700">{state.error}</span> : null}
        {state.ok ? <span className="text-sm text-emerald-700">{state.ok}</span> : null}
      </div>
    </form>
  );
}
