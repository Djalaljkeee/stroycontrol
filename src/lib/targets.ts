// Куда можно разнести приход, списание или процентовку: конструктивы, сгруппированные
// по ярусам, и сами ярусы целиком. Общий справочник для форм всех разделов.
import { db } from '@/db';
import { structures, tiers } from '@/db/schema';

export interface TargetOption {
  /** 's:<id>' — конструктив, 't:<id>' — ярус целиком. */
  value: string;
  label: string;
}

export interface TargetGroup {
  label: string;
  options: TargetOption[];
}

/**
 * Группы для выпадающего списка. Внутри яруса первым идёт «весь ярус» — для
 * прихода, который на площадке не разделили по конструктивам, — затем захватки.
 * Конструктивы без яруса (строки КС-6а на несколько этажей) идут отдельной группой:
 * разносить на них можно, но точнее — на захватку яруса.
 */
export async function loadTargetGroups(opts: { includeTiers: boolean }): Promise<TargetGroup[]> {
  const [tierRows, structureRows] = await Promise.all([
    db.select().from(tiers).orderBy(tiers.sortOrder),
    db.select().from(structures).orderBy(structures.sortOrder),
  ]);
  const byId = new Map(structureRows.map((s) => [s.id, s]));
  // У захватки имя короткое («Стены на отм. +5,920») — к нему добавляется строка КС-6а.
  const labelOf = (s: (typeof structureRows)[number]) => {
    const parent = s.parentId != null ? byId.get(s.parentId) : undefined;
    return parent && parent.kind !== 'section' && parent.kind !== 'object' ? `${s.name} · ${parent.name}` : s.name;
  };
  const groups: TargetGroup[] = tierRows.map((t) => ({
    label: t.name,
    options: [
      ...(opts.includeTiers ? [{ value: `t:${t.id}`, label: `${t.name} — целиком, без разбивки` }] : []),
      ...structureRows
        .filter((s) => s.tierId === t.id)
        .map((s) => ({ value: `s:${s.id}`, label: labelOf(s) })),
    ],
  }));
  const loose = structureRows.filter((s) => s.tierId == null && s.kind !== 'object' && s.kind !== 'section');
  if (loose.length > 0) {
    groups.push({
      label: 'Строки КС-6а без этажа',
      options: loose.map((s) => ({ value: `s:${s.id}`, label: `${s.code} — ${s.name}` })),
    });
  }
  return groups.filter((g) => g.options.length > 0);
}

/** Разбор значения из списка целей: конструктив или ярус. */
export function parseTarget(value: string | null | undefined): { structureId: number | null; tierId: number | null } {
  const m = /^([st]):(\d+)$/.exec(value ?? '');
  if (!m) return { structureId: null, tierId: null };
  return m[1] === 's' ? { structureId: Number(m[2]), tierId: null } : { structureId: null, tierId: Number(m[2]) };
}
