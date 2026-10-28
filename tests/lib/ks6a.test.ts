import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseKs6aWorkbook, planSheet, sheetMeta } from '@/lib/ks6a';
import type { Ks6aSheet } from '../../scripts/import/lib';

// Тот же файл, из которого сделан data/extracted/ks6a.json: разбор в браузерной
// форме должен давать то же, что python-экстрактор, и ту же процентовку, что import:all.
const book = parseKs6aWorkbook(readFileSync('data/source/КС-6а_ДС5.xls'));
const extracted = JSON.parse(readFileSync('data/extracted/ks6a.json', 'utf8')) as Record<string, Ks6aSheet>;

describe('КС-6а из Excel', () => {
  it('находит только листы с таблицей', () => {
    expect(book.map((s) => s.name)).toEqual(Object.keys(extracted));
  });

  it('читает строки и помесячные объёмы как экстрактор', () => {
    for (const sheet of book) {
      const ref = extracted[sheet.name];
      expect(sheet.months).toEqual(ref.months);
      expect(sheet.rows.map((r) => [r.code, r.name, r.monthly])).toEqual(
        ref.rows.map((r) => [r.code, r.name, r.monthly]),
      );
    }
  });

  it('раскладывает ДС5 по месяцам так же, как импорт', () => {
    const sheet = book.find((s) => s.name === '31.10.2026 по ДС5')!;
    const meta = sheetMeta(sheet.name);
    expect(meta).toEqual({ revision: 'ДС5', factThrough: '2026-10-31' });
    const plan = planSheet(sheet, meta.revision, meta.factThrough);
    const summary = plan.map((m) => [m.period, m.rows.length, Math.round(m.rows.reduce((a, r) => a + r.quantity, 0) * 100) / 100]);
    expect(summary).toEqual([
      ['2026-07-31', 4, 257.4],
      ['2026-08-31', 12, 1537.94],
      ['2026-09-30', 8, 1356.43],
      ['2026-10-31', 8, 1021.56],
    ]);
    const oct = plan.find((m) => m.period === '2026-10-31')!;
    expect(oct.rows.find((r) => r.ks6aCode === '3.2.2.')).toMatchObject({
      structureCode: '3.2-columns',
      defaultTarget: '3.2-columns-T1',
      material: 'CONCRETE_B30',
      quantity: 77.85,
      design: 74.14,
    });
  });

  it('новый лист: редакция и дата из имени', () => {
    expect(sheetMeta('30.11.2026 по ДС5')).toEqual({ revision: 'ДС5', factThrough: '2026-11-30' });
  });
});
