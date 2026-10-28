// Справочник прав: из этих разделов администратор собирает роли.
// Без обращений к БД — используется и в серверном коде, и в формах.

export const SECTIONS = [
  { key: 'control', label: 'Контроль: выполнение и защита', href: '/control', hint: 'выполнение и защита объёмов, сводка по смете' },
  // nav: false — в шапке нет, страница открывается по ссылкам из других разделов.
  { key: 'dashboard', label: 'Контроль: прогноз', href: '/dashboard', hint: 'перерасход и прогноз по конструктивам', nav: false },
  { key: 'deliveries', label: 'Приход и списание', href: '/deliveries', hint: 'поставки сразу на конструктив' },
  { key: 'pours', label: 'Журнал', href: '/pours', hint: 'журнал бетонных работ: заливки и выполнение конструктивов' },
  { key: 'tiers', label: 'Этажи', href: '/tiers', hint: 'разрез как лист «приходы»', nav: false },
  { key: 'closings', label: 'Выполнение', href: '/closings', hint: 'закрытие по КС-6а' },
  { key: 'balance', label: 'Остатки', href: '/balance', hint: 'склад и остаточная таблица' },
  { key: 'structures', label: 'Конструктивы', href: '/structures', hint: 'дерево договора с базами' },
  { key: 'revisions', label: 'Редакции', href: '/revisions', hint: 'ДС и выпуски КЖ', nav: false },
  { key: 'export', label: 'Выгрузка в Excel', href: '/api/export', hint: 'скачать всё в xlsx' },
  { key: 'users', label: 'Учётные записи', href: '/users', hint: 'пользователи и роли — права администратора', nav: false },
] as const;

export type Section = (typeof SECTIONS)[number]['key'];

export const WRITE_SECTIONS = [
  { key: 'deliveries', label: 'Ввод прихода и списания', needs: 'deliveries' },
  { key: 'allocate', label: 'Разнесение прихода по конструкциям', needs: 'deliveries' },
  { key: 'pours', label: 'Журнал бетонных работ', needs: 'pours' },
  { key: 'closings', label: 'Выполнение (КС-6а)', needs: 'closings' },
  { key: 'baselines', label: 'Базы сравнения', needs: 'structures' },
] as const;

export type WriteSection = (typeof WRITE_SECTIONS)[number]['key'];

export const SECTION_KEYS = SECTIONS.map((s) => s.key) as Section[];
export const WRITE_KEYS = WRITE_SECTIONS.map((s) => s.key) as WriteSection[];

/** Куда можно отправить после входа: страницы, а не выгрузка. */
export const HOME_SECTIONS = SECTIONS.filter((s) => s.key !== 'export');

export const hrefOf = (section: string) => SECTIONS.find((s) => s.key === section)?.href ?? '/account';
