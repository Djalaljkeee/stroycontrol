#!/usr/bin/env python3
"""
Извлекает данные из исходных .xls в data/extracted/*.json.

Файлы в data/source/ — это выгрузки из Excel в устаревшем бинарном формате BIFF8.
Разбор вынесен в отдельный шаг на Python, а не в скрипты импорта на TypeScript,
по двум причинам:

  1. Единственная библиотека для чтения .xls в npm (xlsx@0.18.5) имеет
     неисправленные уязвимости (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9);
     новые версии в npm не публикуются. Держать её в зависимостях ради
     разового преобразования не стоит.
  2. Результат — обычный JSON, который коммитится в репозиторий. Поэтому
     видно в диффе, что именно изменилось при выпуске нового ДС, и импорт
     воспроизводится без исходных .xls.

Требуется: pip install xlrd
Запуск:    npm run extract
"""

import json
import os
import sys

try:
    import xlrd
except ImportError:
    sys.exit('Нужен xlrd: pip install xlrd')

SRC = 'data/source'
OUT = 'data/extracted'

KS6A = os.path.join(SRC, 'КС-6а_ДС3.xls')
RESOURCE = os.path.join(SRC, 'ресурсная_приходы.xls')


def cell(sheet, book, r, c):
    """Значение ячейки: даты → 'YYYY-MM-DD', числа → float, пусто → None."""
    cl = sheet.cell(r, c)
    if cl.ctype == xlrd.XL_CELL_DATE:
        return xlrd.xldate.xldate_as_datetime(cl.value, book.datemode).strftime('%Y-%m-%d')
    if cl.ctype == xlrd.XL_CELL_EMPTY or cl.ctype == xlrd.XL_CELL_BLANK:
        return None
    if cl.ctype == xlrd.XL_CELL_NUMBER:
        return cl.value
    v = str(cl.value).strip()
    return v or None


def num(v):
    """Числа в этих файлах местами записаны текстом с пробелом-разделителем
    тысяч и запятой ('1 736', '80,1') — приводим к float."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace('\xa0', '').replace(' ', '').replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None


def grid(sheet, book):
    return [[cell(sheet, book, r, c) for c in range(sheet.ncols)] for r in range(sheet.nrows)]


def extract_ks6a():
    """КС-6а: договорные объёмы и помесячное распределение.

    Шапка занимает две строки: в строке 3 — названия месяцев над парами колонок,
    в строке 4 — 'объем'/'стоимость' внутри пары. Раскладываем в плоский список.
    """
    book = xlrd.open_workbook(KS6A)
    out = {}
    for name in book.sheet_names():
        sh = book.sheet_by_name(name)
        # Титульный лист формы КС-6а данных не несёт: отличаем по шапке таблицы.
        if sh.ncols < 20 or cell(sh, book, 3, 0) != '№ п/п':
            continue
        # Пара колонок на месяц: 'объем' и 'стоимость'. Последняя пара — не месяц,
        # а колонка 'Остаток', её держим отдельно.
        months = []
        for c in range(7, sh.ncols, 2):
            label = cell(sh, book, 3, c)
            if label and label != 'Остаток':
                months.append({'label': label, 'volumeCol': c, 'costCol': c + 1})
        rows = []
        for r in range(5, sh.nrows):
            code = cell(sh, book, r, 1)
            name_ = cell(sh, book, r, 2)
            if not name_:
                continue
            monthly = []
            for m in months:
                v = num(cell(sh, book, r, m['volumeCol']))
                if v:
                    monthly.append({'month': m['label'], 'volume': v})
            rows.append({
                'row': r,
                'code': code,
                'name': name_,
                'unit': cell(sh, book, r, 3),
                'quantity': num(cell(sh, book, r, 4)),
                'unitPrice': num(cell(sh, book, r, 5)),
                'total': num(cell(sh, book, r, 6)),
                'monthly': monthly,
                'remainder': num(cell(sh, book, r, 19)),
            })
        out[name] = {'months': [m['label'] for m in months], 'rows': rows}
    return out


def extract_resource():
    """Ресурсная: работы, их объёмы и расценки ресурсов."""
    book = xlrd.open_workbook(RESOURCE)
    sh = book.sheet_by_name('ресурсная')

    # Строка 2 содержит подписи колонок сводной матрицы материалов (колонки 9..30):
    # по ним ресурсная сама разносит итоги в разрезе материалов.
    matrix = []
    for c in range(9, sh.ncols):
        label = cell(sh, book, 2, c)
        if label:
            matrix.append({'col': c, 'label': label})

    rows = []
    for r in range(3, sh.nrows):
        code = cell(sh, book, r, 0)
        work = cell(sh, book, r, 1)
        res_name = cell(sh, book, r, 4)
        matrix_values = {}
        for m in matrix:
            v = num(cell(sh, book, r, m['col']))
            if v:
                matrix_values[m['label']] = v
        if not (code or work or res_name or matrix_values):
            continue
        rows.append({
            'row': r,
            'code': code,
            'work': work,
            'workUnit': cell(sh, book, r, 2),
            'workQuantity': num(cell(sh, book, r, 3)),
            'resource': res_name,
            'resourceUnit': cell(sh, book, r, 5),
            'norm': num(cell(sh, book, r, 6)),
            'resourceQuantity': num(cell(sh, book, r, 7)),
            'resourcePrice': num(cell(sh, book, r, 8)),
            'matrix': matrix_values,
        })
    return {'matrixColumns': [m['label'] for m in matrix], 'rows': rows}


def extract_deliveries():
    """Лист «приходы»: позиции × дневные колонки."""
    book = xlrd.open_workbook(RESOURCE)
    sh = book.sheet_by_name('приходы')

    dates = []
    for c in range(7, sh.ncols):
        d = cell(sh, book, 0, c)
        if isinstance(d, str) and len(d) == 10 and d[4] == '-':
            dates.append({'col': c, 'date': d})

    rows = []
    for r in range(1, sh.nrows):
        name = cell(sh, book, r, 0)
        if not name:
            continue
        daily = []
        for d in dates:
            v = num(cell(sh, book, r, d['col']))
            if v:
                daily.append({'date': d['date'], 'quantity': v})
        rows.append({
            'row': r,
            'name': name,
            'estimate': num(cell(sh, book, r, 1)),
            'project': num(cell(sh, book, r, 2)),
            'diffEstimateProject': num(cell(sh, book, r, 3)),
            'diffProjectIncoming': num(cell(sh, book, r, 4)),
            'incoming': num(cell(sh, book, r, 5)),
            'remainder': num(cell(sh, book, r, 6)),
            'daily': daily,
        })
    return {'dates': [d['date'] for d in dates], 'rows': rows}


def write(name, data):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'  {path}')


def main():
    print('Извлечение данных из data/source:')
    write('ks6a.json', extract_ks6a())
    write('resource.json', extract_resource())
    write('deliveries.json', extract_deliveries())
    print('Готово.')


if __name__ == '__main__':
    main()
