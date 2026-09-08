import {
  pgTable,
  text,
  integer,
  numeric,
  date,
  timestamp,
  boolean,
  uniqueIndex,
  index,
  serial,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Денежные и объёмные величины хранятся в numeric, а не в double: объёмы бетона
 * суммируются по сотням ТТН, и накопленная ошибка плавающей точки съедает
 * те доли процента, ради которых пилот и делается.
 */
const qty = (name: string) => numeric(name, { precision: 14, scale: 4 });
const money = (name: string) => numeric(name, { precision: 16, scale: 2 });
const ratio = (name: string) => numeric(name, { precision: 6, scale: 4 });

// ─────────────────────────────────────────────────────────────────────────────
// Пользователи и сессии
// ─────────────────────────────────────────────────────────────────────────────

/** foreman — прораб (заливки, списания), supply — снабжение (приходы),
 *  estimator — сметчик (базы сравнения, редакции), viewer — только чтение. */
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  login: text('login').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  passwordHash: text('password_hash').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('users_login_key').on(t.login),
  check('users_role_check', sql`${t.role} in ('foreman','supply','estimator','viewer')`),
]);

/** Непрозрачный серверный токен сессии. Хранится хэш токена, а не сам токен:
 *  дамп БД не даёт возможности войти под чужой учёткой. */
export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
  index('sessions_user_idx').on(t.userId),
]);

// ─────────────────────────────────────────────────────────────────────────────
// Справочники
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Позиция учёта.
 *
 * Бетон: одна позиция на класс (В7,5 / В15 / В25 / В30), единица м3.
 * Арматура: агрегатная позиция «Арматура в ассортименте» (т) плюс SKU по
 * диаметру и классу (8-А240 … 32-А500) — ровно как на листе «приходы».
 * Приход и склад ведутся по SKU, базы сравнения (смета/ДС) — по агрегату,
 * потому что смета арматуру по диаметрам не расписывает.
 */
export const materials = pgTable('materials', {
  id: serial('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  /** 'concrete' | 'rebar' */
  kind: text('kind').notNull(),
  /** 'м3' | 'т' */
  unit: text('unit').notNull(),
  /** Для бетона: 'В7,5' | 'В15' | 'В25' | 'В30'. */
  concreteClass: text('concrete_class'),
  /** Для арматурного SKU: диаметр в мм и класс стали. */
  rebarDiameter: integer('rebar_diameter'),
  rebarClass: text('rebar_class'),
  /** true у агрегатной позиции «Арматура в ассортименте, т». */
  isAggregate: boolean('is_aggregate').notNull().default(false),
  /** SKU ссылается на свой агрегат. */
  aggregateId: integer('aggregate_id').references((): AnyPgColumn => materials.id, { onDelete: 'set null' }),
}, (t) => [
  uniqueIndex('materials_code_key').on(t.code),
  check('materials_kind_check', sql`${t.kind} in ('concrete','rebar')`),
]);

/**
 * Конструктив. Самоссылочное дерево:
 *   Объект → Раздел (3.1 Фундаментная плита ЛПК) → Конструктив (плита осн.) → Захватка.
 *
 * `code` — номер по смете/КС-6а (3.2.2), по нему сшиваются импорты разных редакций.
 * `estimateShare` — доля сметной строки, если одна строка КС-6а покрывает несколько
 * отметок: строка 3.2.4 «перекрытия» одна на 9 отметок, и до выпуска КЖ проектный
 * объём отметки берётся пропорционально.
 */
export const structures = pgTable('structures', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id').references((): AnyPgColumn => structures.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  /** 'object' | 'section' | 'slab' | 'columns' | 'floor' | 'wall' | 'stairs' | 'prep' | 'pit' | 'other' */
  kind: text('kind').notNull(),
  /** Отметка, например '-0,080' или '+5,900'. */
  level: text('level'),
  estimateShare: ratio('estimate_share'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [
  uniqueIndex('structures_code_key').on(t.code),
  index('structures_parent_idx').on(t.parentId),
]);

/**
 * Нормативный коэффициент расхода.
 *
 * Бетон 1,05 — выведен из ресурсной: плита 1580+73 м3 конструктива → 1736 м3
 * закупки, колонны 813,75 → 854,4, перекрытия 4826 → 5067.
 * Арматура 1,10 — указано в ресурсной прямым текстом: «Красх = 1,1».
 *
 * `structureKind = null` — правило по умолчанию для вида материала;
 * `structureId` заполняется только для точечного переопределения.
 */
export const norms = pgTable('norms', {
  id: serial('id').primaryKey(),
  materialKind: text('material_kind').notNull(),
  structureKind: text('structure_kind'),
  structureId: integer('structure_id').references(() => structures.id, { onDelete: 'cascade' }),
  kLoss: ratio('k_loss').notNull(),
  source: text('source').notNull(),
  note: text('note'),
});

/**
 * Цена. Два слоя:
 *   'cost'     — себестоимость по ресурсной (В25 7508, В30 7823, арматура 54 000 ₽/т);
 *   'contract' — договорная по КС-6а     (В25 8258, В30 8605, арматура 60 905 ₽/т).
 * Перерасход в рублях считается по себестоимости — это реальная потеря подрядчика.
 */
export const prices = pgTable('prices', {
  id: serial('id').primaryKey(),
  materialId: integer('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  /** 'cost' | 'contract' */
  layer: text('layer').notNull(),
  value: money('value').notNull(),
  revision: text('revision').notNull(),
}, (t) => [
  uniqueIndex('prices_material_layer_revision_key').on(t.materialId, t.layer, t.revision),
  check('prices_layer_check', sql`${t.layer} in ('cost','contract')`),
]);

// ─────────────────────────────────────────────────────────────────────────────
// Базы сравнения
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Опорный объём по паре (конструктив, материал). Хранится строками, а не
 * колонками, — чтобы новая редакция ДС или новый выпуск КЖ добавлялись без
 * миграции и была видна история: арматура плиты ЛПК 122 т (смета) → 214,7 т (ДС3).
 *
 * source:
 *   'estimate' — ресурсная (смета подрядчика);
 *   'contract' — КС-6а действующей редакции ДС;
 *   'project'  — ведомости расхода бетона/стали из КЖ (самое точное).
 *
 * `designQuantity` — конструктивный объём (то, что реально должно оказаться
 * в теле конструкции), `purchaseQuantity` — объём закупки с учётом К.
 * Для строк КС-6а «Устройство монолитных…» заполняется первое,
 * для строк «Поставка бетона/арматуры…» — второе.
 */
export const baselines = pgTable('baselines', {
  id: serial('id').primaryKey(),
  structureId: integer('structure_id').notNull().references(() => structures.id, { onDelete: 'cascade' }),
  materialId: integer('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  revision: text('revision').notNull(),
  designQuantity: qty('design_quantity'),
  purchaseQuantity: qty('purchase_quantity'),
  effectiveFrom: date('effective_from').notNull(),
  note: text('note'),
}, (t) => [
  uniqueIndex('baselines_key').on(t.structureId, t.materialId, t.source, t.revision),
  check('baselines_source_check', sql`${t.source} in ('estimate','contract','project')`),
]);

// ─────────────────────────────────────────────────────────────────────────────
// Факт
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Захватка заливки — единица, вокруг которой строится весь учёт:
 * «залили такой-то объём такой-то конструкции».
 *
 * `designVolumeM3` — проектный объём захватки. Именно с ним, умноженным на К,
 * сравнивается фактически принятый по ТТН бетон.
 */
export const pours = pgTable('pours', {
  id: serial('id').primaryKey(),
  structureId: integer('structure_id').notNull().references(() => structures.id, { onDelete: 'restrict' }),
  label: text('label').notNull(),
  pouredAt: date('poured_at').notNull(),
  designVolumeM3: qty('design_volume_m3').notNull(),
  concreteMaterialId: integer('concrete_material_id').notNull().references(() => materials.id, { onDelete: 'restrict' }),
  /** 'planned' | 'in_progress' | 'done' — в расчёт выполненного идут только 'done'. */
  status: text('status').notNull().default('planned'),
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('pours_structure_idx').on(t.structureId),
  index('pours_date_idx').on(t.pouredAt),
  check('pours_status_check', sql`${t.status} in ('planned','in_progress','done')`),
]);

/**
 * Приход материала.
 *
 * Бетон склада не имеет — он уходит сразу в дело, поэтому для бетона приход
 * с заполненным `pourId` одновременно является и списанием. Приход бетона без
 * `pourId` — это ровно тот неподтверждённый расход, который надо разнести:
 * на импорте таких набирается ~1110 м3 В30, и они помечаются `needsAllocation`.
 *
 * Арматура приходит на склад, поэтому у неё `pourId` всегда пуст, а списание
 * оформляется отдельно в `issues`.
 */
export const deliveries = pgTable('deliveries', {
  id: serial('id').primaryKey(),
  date: date('date').notNull(),
  materialId: integer('material_id').notNull().references(() => materials.id, { onDelete: 'restrict' }),
  quantity: qty('quantity').notNull(),
  pourId: integer('pour_id').references(() => pours.id, { onDelete: 'set null' }),
  ttnNumber: text('ttn_number'),
  supplier: text('supplier'),
  unitPrice: money('unit_price'),
  /** true у импортированных приходов бетона без привязки к захватке. */
  needsAllocation: boolean('needs_allocation').notNull().default(false),
  source: text('source').notNull().default('manual'),
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('deliveries_material_date_idx').on(t.materialId, t.date),
  index('deliveries_pour_idx').on(t.pourId),
]);

/**
 * Списание материала на конструктив.
 *
 * Основной случай — арматура: акт монтажа списывает тоннаж со склада на
 * конструктив либо на захватку (каркас часто вяжется задолго до заливки).
 *
 * Второй случай — закрытые объёмы бетона из КС-6а (`source = 'ks6a'`). До
 * внедрения пилота привязки ТТН к захваткам не существовало, и единственная
 * запись о списанном бетоне — помесячные объёмы в журнале. Импорт создаёт такую
 * запись только там, где за этот месяц у конструктива нет привязанных ТТН,
 * поэтому двойного учёта не возникает.
 */
export const issues = pgTable('issues', {
  id: serial('id').primaryKey(),
  date: date('date').notNull(),
  materialId: integer('material_id').notNull().references(() => materials.id, { onDelete: 'restrict' }),
  quantity: qty('quantity').notNull(),
  structureId: integer('structure_id').notNull().references(() => structures.id, { onDelete: 'restrict' }),
  pourId: integer('pour_id').references(() => pours.id, { onDelete: 'set null' }),
  document: text('document'),
  source: text('source').notNull().default('manual'),
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('issues_material_date_idx').on(t.materialId, t.date),
  index('issues_structure_idx').on(t.structureId),
]);

/** Кто и что менял — на пилоте данные вводят несколько человек. */
export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: integer('entity_id'),
  payload: text('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_created_idx').on(t.createdAt)]);
