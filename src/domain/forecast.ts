import type { Balance } from './balance';
import type { Confidence, Verdict } from './types';

/** Ниже этого процента выполнения К_факт статистически не значим. */
export const PRELIMINARY_PROGRESS = 0.1;

/** К_факт до +2% к норме — в допуске, до +5% — тревога, выше — перерасход. */
export const WARNING_RATIO = 1.02;
export const OVER_RATIO = 1.05;

export interface ForecastInput {
  /**
   * Полная конструктивная величина по выбранной базе, в собственных единицах
   * материала: для бетона — м3 конструктива, для арматуры — тонны проектной
   * массы. Единицы обязаны совпадать с единицами `balance.consumed`, иначе
   * К_факт перестаёт быть безразмерным и сравнивать его с нормой нельзя.
   */
  baseDesign: number | null;
  /**
   * Уже выполненная часть той же величины: для бетона — сумма проектных объёмов
   * залитых захваток, для арматуры — проектная масса, приходящаяся на этот
   * выполненный объём (полная масса × доля выполнения по бетону).
   */
  completedDesign: number;
  /** Сметный лимит закупки в тех же единицах — с ним считается перерасход в рублях. */
  estimatePurchase: number | null;
  /** Нормативный коэффициент. */
  k: number;
  balance: Balance;
  /** Себестоимость единицы, ₽ за м3 или т. */
  unitCost: number | null;
}

export interface Forecast {
  /** Доля выполненного конструктивного объёма, 0..1. null — база неизвестна. */
  progress: number | null;
  /** Фактический коэффициент расхода: списано / залито по проекту. */
  kActual: number | null;
  /** Прогноз итогового расхода к завершению конструктива. */
  total: number | null;
  /** Прогнозный перерасход против сметного лимита, в единицах материала. */
  overrunVsEstimate: number | null;
  /** То же против нормы по выбранной базе — «технологический» перерасход. */
  overrunVsNorm: number | null;
  /** Прогнозный перерасход против сметы в рублях по себестоимости. */
  overrunCost: number | null;
  verdict: Verdict;
  confidence: Confidence;
}

/**
 * Прогноз расхода к завершению конструктива.
 *
 * Логика простая и потому проверяемая вручную: сложившийся на площадке
 * коэффициент расхода экстраполируется на оставшийся объём.
 *
 *   К_факт        = списано / залито_по_проекту
 *   прогноз_итог  = списано + (весь_объём − залито) × К_факт
 *
 * Пока залито мало, К_факт шумит (одна перелитая машина на 20 м3 даёт +5%),
 * поэтому при выполнении меньше 10% прогноз помечается предварительным.
 */
export function computeForecast(input: ForecastInput): Forecast {
  const { baseDesign, completedDesign, estimatePurchase, k, balance, unitCost } = input;

  const progress =
    baseDesign != null && baseDesign > 0 ? completedDesign / baseDesign : null;

  const kActual = completedDesign > 0 ? balance.consumed / completedDesign : null;

  const total =
    baseDesign != null && kActual != null
      ? balance.consumed + Math.max(baseDesign - completedDesign, 0) * kActual
      : null;

  const overrunVsEstimate =
    total != null && estimatePurchase != null ? total - estimatePurchase : null;

  const overrunVsNorm =
    total != null && baseDesign != null ? total - baseDesign * k : null;

  const overrunCost =
    overrunVsEstimate != null && unitCost != null ? overrunVsEstimate * unitCost : null;

  return {
    progress,
    kActual,
    total,
    overrunVsEstimate,
    overrunVsNorm,
    overrunCost,
    verdict: verdictFor(kActual, k),
    confidence:
      progress != null && progress >= PRELIMINARY_PROGRESS ? 'normal' : 'preliminary',
  };
}

export function verdictFor(kActual: number | null, k: number): Verdict {
  if (kActual == null || k <= 0) return 'unknown';
  const ratio = kActual / k;
  if (ratio <= WARNING_RATIO) return 'ok';
  if (ratio <= OVER_RATIO) return 'warning';
  return 'over';
}
