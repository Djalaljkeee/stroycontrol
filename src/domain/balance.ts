import type { DeliveryRecord, IssueRecord, MaterialKind, PourRecord } from './types';

export interface BalanceInput {
  materialKind: MaterialKind;
  deliveries: DeliveryRecord[];
  issues: IssueRecord[];
  /**
   * 'object' — весь приход материала на объекте: есть склад и неподтверждённый
   * расход. 'structure' — конструктив или ярус: приходом считается только
   * разнесённое на него, склада у конструктива нет.
   */
  scope?: 'object' | 'structure';
}

export interface Balance {
  /** Всё, что приехало на объект. */
  incoming: number;
  /** Списано на конструктивы. */
  consumed: number;
  /** Лежит на складе. У бетона склада нет, поэтому всегда 0. */
  stock: number;
  /**
   * Приехало, но ни на что не списано и на складе не лежит.
   *
   * Для бетона это приходы без привязки к конструктиву. Может быть
   * отрицательным: в ярусах, где списание идёт по процентовке, закрыто больше,
   * чем привезено (то же «приход − запроцентовано» листа «приходы»).
   * Для арматуры всегда 0: то, что не списано, по определению на складе.
   */
  unconfirmed: number;
}

/**
 * Сводит приход и расход по одному материалу.
 *
 * Списание складывается из двух источников, и это не дублирование:
 *   - приход, разнесённый на конструктив: бетон не складируется, а арматура,
 *     привезённая под захватку, в неё же и идёт — так ведётся лист «приходы»;
 *   - записи `issues`: акты монтажа арматуры со склада и списание по процентовке
 *     в ярусах, где приход разнесён только на ярус целиком (КЖ0, ярус 1). В этих
 *     ярусах приход на конструктивы не разнесён, поэтому одно и то же дважды
 *     не учитывается.
 */
export function computeBalance(input: BalanceInput): Balance {
  const isAllocated = (d: DeliveryRecord) => d.allocated ?? d.pourId != null;
  const all = sum(input.deliveries.map((d) => d.quantity));
  const allocated = sum(input.deliveries.filter(isAllocated).map((d) => d.quantity));
  const written = sum(input.issues.map((i) => i.quantity));
  const consumed = allocated + written;

  if (input.scope === 'structure') {
    return { incoming: allocated, consumed, stock: 0, unconfirmed: 0 };
  }

  if (input.materialKind === 'concrete') {
    return { incoming: all, consumed, stock: 0, unconfirmed: all - consumed };
  }

  // Арматура без разнесения лежит на складе — это запас, а не потеря.
  return { incoming: all, consumed, stock: all - consumed, unconfirmed: 0 };
}

/** Проектный объём захваток, которые уже залиты. База для К_факт. */
export function completedDesignVolume(pours: PourRecord[]): number {
  return sum(pours.filter((p) => p.status === 'done').map((p) => p.designVolumeM3));
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
