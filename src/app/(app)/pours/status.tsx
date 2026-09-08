'use client';

import { setPourStatus } from '@/actions/records';

export function StatusControl({ pourId, status }: { pourId: number; status: string }) {
  return (
    <form action={setPourStatus}>
      <input type="hidden" name="pourId" value={pourId} />
      <select
        name="status"
        defaultValue={status}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
      >
        <option value="planned">запланирована</option>
        <option value="in_progress">в работе</option>
        <option value="done">залита</option>
      </select>
    </form>
  );
}
