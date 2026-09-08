import type { DeliveryRecord, IssueRecord, MaterialKind, PourRecord } from './types';

export interface BalanceInput {
  materialKind: MaterialKind;
  deliveries: DeliveryRecord[];
  issues: IssueRecord[];
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
   * Для бетона это приходы без привязки к захватке — главная дыра в текущем
   * учёте: по загруженным данным так висит ~1110 м3 В30.
   * Для арматуры всегда 0: то, что не списано, по определению на складе.
   */
  unconfirmed: number;
}

/**
 * Сводит приход и расход по одному материалу.
 *
 * У бетона списание приходит из двух источников, и это не дублирование:
 *   - привязанная к захватке ТТН — так работает ввод на площадке: бетон не
 *     складируется, поэтому привязка прихода к захватке и есть списание;
 *   - закрытый объём из КС-6а (`issues` с source='ks6a') — так выглядит история
 *     до внедрения пилота, когда привязки ТТН к захваткам ещё не существовало.
 * Импорт КС-6а не создаёт запись за тот месяц и конструктив, где уже есть
 * привязанные ТТН, поэтому один и тот же бетон дважды не учитывается.
 */
export function computeBalance(input: BalanceInput): Balance {
  const incoming = sum(input.deliveries.map((d) => d.quantity));
  const allocated = sum(
    input.deliveries.filter((d) => d.pourId != null).map((d) => d.quantity),
  );
  const written = sum(input.issues.map((i) => i.quantity));

  if (input.materialKind === 'concrete') {
    const consumed = allocated + written;
    return { incoming, consumed, stock: 0, unconfirmed: incoming - consumed };
  }

  // Арматура лежит на складе, поэтому непривязанный приход — это не потеря,
  // а запас; списание оформляется только актом монтажа.
  return { incoming, consumed: written, stock: incoming - written, unconfirmed: 0 };
}

/** Проектный объём захваток, которые уже залиты. База для К_факт. */
export function completedDesignVolume(pours: PourRecord[]): number {
  return sum(pours.filter((p) => p.status === 'done').map((p) => p.designVolumeM3));
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
