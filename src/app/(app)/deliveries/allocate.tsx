'use client';

import { allocateDelivery } from '@/actions/records';
import { TargetSelect } from '@/components/forms';
import type { TargetGroup } from '@/lib/targets';

export function AllocateForm({ deliveryId, targets }: { deliveryId: number; targets: TargetGroup[] }) {
  return (
    <form action={allocateDelivery} className="flex justify-end gap-2">
      <input type="hidden" name="deliveryId" value={deliveryId} />
      <TargetSelect
        name="target"
        defaultValue=""
        required
        groups={targets}
        placeholder="куда разнести"
        className="max-w-xs rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
      />
      <button
        type="submit"
        className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
      >
        Разнести
      </button>
    </form>
  );
}
