import type { BaselineEntry, BaselineSource } from './types';

export interface RevisionEntry extends BaselineEntry {
  structureCode: string;
  structureName: string;
  materialCode: string;
  materialName: string;
  /** Класс бетона на момент этой редакции. */
  concreteClass?: string | null;
}

export type DiffKind = 'added' | 'removed' | 'quantity' | 'class' | 'unchanged';

export interface RevisionDiffRow {
  structureCode: string;
  structureName: string;
  materialName: string;
  fromQuantity: number | null;
  toQuantity: number | null;
  delta: number | null;
  fromClass?: string | null;
  toClass?: string | null;
  kind: DiffKind;
}

/**
 * Дифф двух редакций баз сравнения.
 *
 * Нужен из-за того, что между редакциями ДС «переезжают» не только объёмы, но и
 * классы бетона: в редакции от 31.07.2026 плита ЛПК проходила как В25 1736 м3,
 * а в ДС3 — как В30 1736 м3. Если сверять факт с базой в лоб по классу, получим
 * одновременно фиктивный перерасход по В30 и фиктивную экономию по В25.
 *
 * Поэтому сопоставление идёт по паре (конструктив, вид материала), а класс
 * бетона — атрибут редакции: его смена попадает в дифф как `class`,
 * а не в перерасход.
 */
export function diffRevisions(
  from: RevisionEntry[],
  to: RevisionEntry[],
): RevisionDiffRow[] {
  const key = (e: RevisionEntry) => `${e.structureCode}|${e.materialCode}`;
  const fromMap = new Map(from.map((e) => [key(e), e]));
  const toMap = new Map(to.map((e) => [key(e), e]));
  const rows: RevisionDiffRow[] = [];

  for (const [k, toEntry] of toMap) {
    const fromEntry = fromMap.get(k);
    const toQty = toEntry.purchaseQuantity ?? toEntry.designQuantity ?? null;

    if (!fromEntry) {
      rows.push({
        structureCode: toEntry.structureCode,
        structureName: toEntry.structureName,
        materialName: toEntry.materialName,
        fromQuantity: null,
        toQuantity: toQty,
        delta: toQty,
        toClass: toEntry.concreteClass ?? null,
        kind: 'added',
      });
      continue;
    }

    const fromQty = fromEntry.purchaseQuantity ?? fromEntry.designQuantity ?? null;
    const classChanged =
      (fromEntry.concreteClass ?? null) !== (toEntry.concreteClass ?? null);
    const qtyChanged = !nearlyEqual(fromQty, toQty);

    rows.push({
      structureCode: toEntry.structureCode,
      structureName: toEntry.structureName,
      materialName: toEntry.materialName,
      fromQuantity: fromQty,
      toQuantity: toQty,
      delta: fromQty != null && toQty != null ? toQty - fromQty : null,
      fromClass: fromEntry.concreteClass ?? null,
      toClass: toEntry.concreteClass ?? null,
      // Смена класса важнее изменения объёма: именно она ломает сверку.
      kind: classChanged ? 'class' : qtyChanged ? 'quantity' : 'unchanged',
    });
  }

  for (const [k, fromEntry] of fromMap) {
    if (toMap.has(k)) continue;
    const fromQty = fromEntry.purchaseQuantity ?? fromEntry.designQuantity ?? null;
    rows.push({
      structureCode: fromEntry.structureCode,
      structureName: fromEntry.structureName,
      materialName: fromEntry.materialName,
      fromQuantity: fromQty,
      toQuantity: null,
      delta: fromQty != null ? -fromQty : null,
      fromClass: fromEntry.concreteClass ?? null,
      kind: 'removed',
    });
  }

  return rows.sort((a, b) => a.structureCode.localeCompare(b.structureCode, 'ru'));
}

/** Изменения меньше 0,01 единицы — округление в исходных таблицах, не изменение. */
function nearlyEqual(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) < 0.01;
}

export const SOURCE_LABELS: Record<BaselineSource, string> = {
  project: 'Проект (КЖ)',
  contract: 'Договор (ДС)',
  estimate: 'Смета (ресурсная)',
};
