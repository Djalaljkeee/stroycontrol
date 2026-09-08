import { describe, it, expect } from 'vitest';
import {
  specificReinforcement,
  reinforcementRatio,
  isImplausible,
} from '@/domain/reinforcement';

describe('удельное армирование', () => {
  it('совпадает с ведомостями КЖ1-01', () => {
    // Колонны на отм. −0,080: 26 244,2 кг на 75,66 м3.
    expect(specificReinforcement(26.2442, 75.66)).toBeCloseTo(346.87, 2);
    // Стены на отм. −0,080: 25 746 кг на 269,32 м3.
    expect(specificReinforcement(25.746, 269.32)).toBeCloseTo(95.6, 1);
  });

  it('ловит ошибку ввода: 40 т на 24 м3 колонн — это не перерасход, а опечатка', () => {
    const actual = specificReinforcement(40, 24);
    const ratio = reinforcementRatio(actual, 346.87);
    expect(actual).toBeCloseTo(1666.7, 1);
    expect(ratio!).toBeGreaterThan(4);
    expect(isImplausible(ratio)).toBe(true);
  });

  it('нормальное отклонение правдоподобным и остаётся', () => {
    // 8,84 т на 24,2 м3 колонн = 365 кг/м3 против проектных 347.
    const actual = specificReinforcement(8.84, 24.2);
    const ratio = reinforcementRatio(actual, 346.87);
    expect(actual).toBeCloseTo(365.29, 2);
    expect(isImplausible(ratio)).toBe(false);
  });

  it('без объёма удельное армирование не определено', () => {
    expect(specificReinforcement(10, 0)).toBeNull();
    expect(reinforcementRatio(null, 347)).toBeNull();
  });
});
