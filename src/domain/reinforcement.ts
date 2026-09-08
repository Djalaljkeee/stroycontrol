/**
 * Удельное армирование, кг на м3 бетона.
 *
 * Служит проверкой правдоподобия списаний, независимой от коэффициентов расхода:
 * если прораб списал на колонны 40 т арматуры при 24 м3 бетона, это 1667 кг/м3
 * при проектных 347 — значит ошибка ввода или списание не на тот конструктив.
 *
 * Проектные значения из КЖ1-01 (ведомости расхода бетона и стали, отм. −0,080):
 *   колонны  26 244,2 кг / 75,66 м3  = 347 кг/м3
 *   стены    25 746,0 кг / 269,32 м3 = 95,6 кг/м3
 */
export function specificReinforcement(massTonnes: number, volumeM3: number): number | null {
  if (volumeM3 <= 0) return null;
  return (massTonnes * 1000) / volumeM3;
}

/** Во сколько раз фактическое удельное армирование расходится с проектным. */
export function reinforcementRatio(
  actual: number | null,
  design: number | null,
): number | null {
  if (actual == null || design == null || design <= 0) return null;
  return actual / design;
}

/** Расхождение больше чем в полтора раза — почти всегда ошибка ввода, а не перерасход. */
export const IMPLAUSIBLE_RATIO = 1.5;

export function isImplausible(ratio: number | null): boolean {
  return ratio != null && (ratio > IMPLAUSIBLE_RATIO || ratio < 1 / IMPLAUSIBLE_RATIO);
}
