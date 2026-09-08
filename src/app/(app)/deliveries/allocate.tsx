'use client';

import { allocateDelivery } from '@/actions/records';

export function AllocateForm({
  deliveryId,
  pours,
}: {
  deliveryId: number;
  pours: { id: number; label: string }[];
}) {
  if (pours.length === 0) {
    return (
      <span className="text-xs text-slate-500">
        нет захваток с этим классом бетона — сначала заведите захватку
      </span>
    );
  }

  return (
    <form action={allocateDelivery} className="flex justify-end gap-2">
      <input type="hidden" name="deliveryId" value={deliveryId} />
      <select
        name="pourId"
        defaultValue=""
        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
      >
        <option value="" disabled>
          выберите захватку
        </option>
        {pours.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
      >
        Разнести
      </button>
    </form>
  );
}
