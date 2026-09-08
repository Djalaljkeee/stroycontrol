import type { Balance } from './balance';

export interface VarianceInput {
  /** Объём закупки по проекту (КЖ), уже с коэффициентом. null — КЖ не выпущен. */
  projectPurchase: number | null;
  /** Сметный лимит закупки по ресурсной. */
  estimatePurchase: number | null;
  /** Конструктивный объём уже залитых захваток. */
  completedDesign: number;
  /** Нормативный коэффициент расхода. */
  k: number;
  balance: Balance;
}

export interface Variance {
  /**
   * Отклонение проекта от сметы. Это не потери на площадке, а разница между
   * тем, что заложил сметчик, и тем, что нарисовал проектировщик.
   * Пример из данных: арматура плиты ЛПК 122 т по смете против 214,7 т по ДС3.
   */
  design: number | null;
  /**
   * Технологические потери сверх нормы: перелив бетона, подрезка и перепуск
   * арматуры. Считается только по выполненному объёму, поэтому не зависит от
   * степени готовности конструктива.
   */
  loss: number;
  /** Приехало, но ничем не подтверждено. */
  unconfirmed: number;
}

export function computeVariance(input: VarianceInput): Variance {
  const { projectPurchase, estimatePurchase, completedDesign, k, balance } = input;

  const design =
    projectPurchase != null && estimatePurchase != null
      ? projectPurchase - estimatePurchase
      : null;

  // Норма на то, что фактически залито, — с ней и сравнивается списание.
  const normForCompleted = completedDesign * k;

  return {
    design,
    loss: balance.consumed - normForCompleted,
    unconfirmed: balance.unconfirmed,
  };
}
