import type { BaselineEntry, BaselineSource, MaterialKind, StructureKind } from './types';

/**
 * Нормативный коэффициент расхода бетона: 1,05.
 *
 * Выведен из ресурсной сметы как отношение объёма закупки к конструктивному:
 *   плита ЛПК     (1580 + 73) → 1736   = 1,050
 *   колонны ЛПК   813,75      → 854,4  = 1,050
 *   перекрытия    4826        → 5067   = 1,050
 * Подтверждается фактом августа: колонны 25,41 / 24,2 = 1,050;
 * стены ЛК/ЛШ 131,5 / 125,3 = 1,049.
 */
export const K_CONCRETE = 1.05;

/**
 * Нормативный коэффициент расхода арматуры: 1,10.
 * Указан в ресурсной прямым текстом: «Стоимость арматуры (Красх = 1,1)».
 * Покрывает перепуск стыков, подрезку и отходы раскроя.
 */
export const K_REBAR = 1.1;

export interface NormOverride {
  materialKind: MaterialKind;
  /** null — правило по умолчанию для вида материала. */
  structureKind: StructureKind | null;
  kLoss: number;
}

/** Коэффициент для пары (вид материала, вид конструктива) с учётом переопределений. */
export function kNorm(
  materialKind: MaterialKind,
  structureKind?: StructureKind | null,
  overrides: NormOverride[] = [],
): number {
  const exact = overrides.find(
    (o) => o.materialKind === materialKind && o.structureKind === structureKind,
  );
  if (exact) return exact.kLoss;

  const fallback = overrides.find(
    (o) => o.materialKind === materialKind && o.structureKind === null,
  );
  if (fallback) return fallback.kLoss;

  return materialKind === 'concrete' ? K_CONCRETE : K_REBAR;
}

const PRIORITY: BaselineSource[] = ['project', 'contract', 'estimate'];

export interface ResolvedBaseline {
  source: BaselineSource;
  revision: string;
  designQuantity: number | null;
  purchaseQuantity: number | null;
  /** true, когда база взята не из проекта: КЖ на этот конструктив ещё не выпущен. */
  isEstimated: boolean;
}

/**
 * Подбирает базу сравнения по принципу «самая точная из доступных»:
 * проект (КЖ) → договор (действующий ДС) → смета (ресурсная).
 *
 * Нужно потому, что КЖ выпускается частями: на момент пилота есть только
 * КЖ1 на отм. −0,080, а остальные конструктивы сравнивать всё равно надо.
 * Возвращаемый `isEstimated` для этого и нужен — интерфейс обязан показать,
 * что цифра оценочная.
 */
export function baselineFor(
  entries: BaselineEntry[],
  preference: BaselineSource[] = PRIORITY,
): ResolvedBaseline | null {
  for (const source of preference) {
    const candidates = entries.filter((e) => e.source === source);
    if (candidates.length === 0) continue;

    // Внутри источника побеждает самая свежая редакция: ДС3 важнее ДС2.
    const latest = candidates.reduce((a, b) =>
      b.effectiveFrom.localeCompare(a.effectiveFrom) > 0 ? b : a,
    );
    return {
      source,
      revision: latest.revision,
      designQuantity: latest.designQuantity,
      purchaseQuantity: latest.purchaseQuantity,
      isEstimated: source !== 'project',
    };
  }
  return null;
}

/**
 * Конструктивный объём базы. Если в записи есть только объём закупки
 * (строки КС-6а «Поставка бетона…»), обратно делим на К.
 */
export function designQuantityOf(baseline: ResolvedBaseline, k: number): number | null {
  if (baseline.designQuantity != null) return baseline.designQuantity;
  if (baseline.purchaseQuantity != null && k > 0) return baseline.purchaseQuantity / k;
  return null;
}

/** Объём закупки базы. Если есть только конструктивный — умножаем на К. */
export function purchaseQuantityOf(baseline: ResolvedBaseline, k: number): number | null {
  if (baseline.purchaseQuantity != null) return baseline.purchaseQuantity;
  if (baseline.designQuantity != null) return baseline.designQuantity * k;
  return null;
}
