export type MaterialKind = 'concrete' | 'rebar';

export type StructureKind =
  | 'object'
  | 'section'
  | 'slab'
  | 'columns'
  | 'floor'
  | 'wall'
  | 'stairs'
  | 'prep'
  | 'pit'
  | 'other';

/** 'project' точнее 'contract', 'contract' точнее 'estimate' — в этом порядке и подбирается база. */
export type BaselineSource = 'estimate' | 'contract' | 'project';

export type Verdict = 'ok' | 'warning' | 'over' | 'unknown';

/** Прогноз считается предварительным, пока выполнено меньше PRELIMINARY_PROGRESS. */
export type Confidence = 'preliminary' | 'normal';

export interface BaselineEntry {
  source: BaselineSource;
  revision: string;
  /** Конструктивный объём — то, что должно оказаться в теле конструкции. */
  designQuantity: number | null;
  /** Объём закупки: конструктивный × К. */
  purchaseQuantity: number | null;
  effectiveFrom: string;
}

export interface DeliveryRecord {
  quantity: number;
  /** null — приход не привязан к захватке (для бетона это неподтверждённый расход). */
  pourId: number | null;
}

export interface IssueRecord {
  quantity: number;
}

export interface PourRecord {
  designVolumeM3: number;
  status: 'planned' | 'in_progress' | 'done';
}
