// Защита объёмов: что выполнено на площадке и когда это закрыто перед заказчиком.
//
// Выполнение отмечает прораб (заливки со статусом «залита»), закрытие — сметчик
// (процентовка по КС-6а). Объём, залитый в месяце, должен попасть в процентовку
// этого же месяца; всё, что висит дольше, — задержка с защитой: работа сделана,
// а деньги за неё не предъявлены.
import { db } from '@/db';
import { baselines, closings, materials, pours, prices, structures, tiers } from '@/db/schema';
import { K_CONCRETE } from '@/domain';
import { n } from './format';

/** Доля проекта, с которой конструктив считается выполненным / закрытым: допуск на округления КС-6а. */
const DONE_SHARE = 0.98;

export type ProtectionStatus = 'not_started' | 'in_work' | 'pending' | 'overdue' | 'closed';

export const STATUS_LABELS: Record<ProtectionStatus, string> = {
  not_started: 'не начат',
  in_work: 'в работе',
  pending: 'ждёт защиты',
  overdue: 'задержка защиты',
  closed: 'закрыт',
};

export interface ProtectionRow {
  structureId: number;
  structureCode: string;
  structureName: string;
  parentName: string | null;
  tierId: number | null;
  sortOrder: number;
  materialId: number;
  materialName: string;
  /** Конструктивный объём по проекту (КЖ), без КЖ — по договору. */
  project: number | null;
  projectSource: 'project' | 'contract' | null;
  projectRevision: string | null;
  /** Залито по журналу прораба. */
  poured: number;
  /** Выполнено: бо́льшее из залитого и закрытого — закрытое без заливок значит историю до пилота. */
  executed: number;
  /** Закрыто процентовкой, в конструктивном объёме. */
  closed: number;
  /** Залито, но не закрыто. */
  unclosed: number;
  /** Он же по договорной цене поставки — сколько денег не предъявлено. */
  unclosedValue: number | null;
  finishedAt: string | null;
  closedAt: string | null;
  /** Дата самой старой заливки, ещё не покрытой процентовкой. */
  pendingSince: string | null;
  /** Последний день месяца этой заливки — к нему объём должен быть закрыт. */
  deadline: string | null;
  overdueDays: number;
  /** Дней от окончания выполнения до закрытия — для закрытых конструктивов. */
  protectionDays: number | null;
  status: ProtectionStatus;
}

export interface ProtectionTier {
  id: number;
  code: string;
  name: string;
}

const lastDayOfMonth = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export async function buildProtection(today: string = new Date().toISOString().slice(0, 10)): Promise<{
  rows: ProtectionRow[];
  tiers: ProtectionTier[];
}> {
  const [structureRows, tierRows, materialRows, baselineRows, pourRows, closingRows, priceRows] = await Promise.all([
    db.select().from(structures),
    db.select().from(tiers).orderBy(tiers.sortOrder),
    db.select().from(materials),
    db.select().from(baselines),
    db.select().from(pours),
    db.select().from(closings),
    db.select().from(prices),
  ]);

  const concrete = new Map(materialRows.filter((m) => m.kind === 'concrete').map((m) => [m.id, m]));
  const byId = new Map(structureRows.map((s) => [s.id, s]));
  const hasChildren = new Set(structureRows.map((s) => s.parentId).filter((id): id is number => id != null));
  const leaves = structureRows.filter((s) => !hasChildren.has(s.id) && s.kind !== 'object' && s.kind !== 'section');

  // База: последний выпуск КЖ, иначе последняя редакция договора — только её
  // классы, чтобы вытесненный класс (плита до ДС3 в В25) не давал лишнюю строку.
  const latestBy = (rows: typeof baselineRows) => {
    const latest = rows.reduce((acc, b) => (b.effectiveFrom > acc ? b.effectiveFrom : acc), '');
    return rows.filter((b) => b.effectiveFrom === latest);
  };
  const baseOf = (structureId: number) => {
    const own = baselineRows.filter((b) => b.structureId === structureId && concrete.has(b.materialId));
    const project = latestBy(own.filter((b) => b.source === 'project'));
    if (project.length > 0) return project;
    return latestBy(own.filter((b) => b.source === 'contract'));
  };

  const contractPrice = new Map<number, number>();
  for (const p of priceRows.filter((x) => x.layer === 'contract').sort((a, b) => a.revision.localeCompare(b.revision))) {
    contractPrice.set(p.materialId, n(p.value));
  }

  const rows: ProtectionRow[] = [];
  for (const s of leaves) {
    const base = baseOf(s.id);
    const sPours = pourRows.filter((p) => p.structureId === s.id && p.status === 'done' && concrete.has(p.concreteMaterialId));
    const sClosings = closingRows.filter((c) => c.structureId === s.id && concrete.has(c.materialId));
    const materialIds = new Set([
      ...base.map((b) => b.materialId),
      ...sPours.map((p) => p.concreteMaterialId),
      ...sClosings.map((c) => c.materialId),
    ]);

    for (const materialId of materialIds) {
      const b = base.find((x) => x.materialId === materialId);
      const project = b?.designQuantity != null ? n(b.designQuantity) : null;
      const mp = sPours
        .filter((p) => p.concreteMaterialId === materialId)
        .sort((a, c) => a.pouredAt.localeCompare(c.pouredAt));
      const mc = sClosings.filter((c) => c.materialId === materialId).sort((a, c) => a.period.localeCompare(c.period));
      const poured = mp.reduce((a, p) => a + n(p.designVolumeM3), 0);
      const closed = mc.reduce((a, c) => a + n(c.designQuantity), 0);
      const executed = Math.max(poured, closed);
      const unclosed = Math.max(0, poured - closed);

      // Процентовка закрывает заливки по порядку: первая непокрытая — самая старая в очереди.
      let pendingSince: string | null = null;
      let acc = 0;
      for (const p of mp) {
        acc += n(p.designVolumeM3);
        if (acc > closed + 0.01) {
          pendingSince = p.pouredAt;
          break;
        }
      }
      const deadline = pendingSince ? lastDayOfMonth(pendingSince) : null;
      const overdueDays = deadline && unclosed > 0.01 ? Math.max(0, daysBetween(deadline, today)) : 0;

      const reachedAt = <T,>(list: T[], qty: (x: T) => number, at: (x: T) => string) => {
        if (project == null || project <= 0) return null;
        let sum = 0;
        for (const x of list) {
          sum += qty(x);
          if (sum >= project * DONE_SHARE) return at(x);
        }
        return null;
      };
      const closedAt = reachedAt(mc, (c) => n(c.designQuantity), (c) => c.period);
      const finishedAt =
        reachedAt(mp, (p) => n(p.designVolumeM3), (p) => p.pouredAt) ?? (closedAt && poured < closed ? closedAt : null);

      const status: ProtectionStatus =
        unclosed > 0.01
          ? overdueDays > 0
            ? 'overdue'
            : 'pending'
          : closedAt || (project == null && closed > 0)
            ? 'closed'
            : executed > 0
              ? 'in_work'
              : 'not_started';

      const price = contractPrice.get(materialId);
      const parent = s.parentId != null ? byId.get(s.parentId) : undefined;
      rows.push({
        structureId: s.id,
        structureCode: s.code,
        structureName: s.name,
        parentName: parent && parent.kind !== 'section' && parent.kind !== 'object' ? parent.name : null,
        tierId: s.tierId,
        sortOrder: s.sortOrder,
        materialId,
        materialName: concrete.get(materialId)!.name,
        project,
        projectSource: b ? (b.source as 'project' | 'contract') : null,
        projectRevision: b?.revision ?? null,
        poured,
        executed,
        closed,
        unclosed,
        unclosedValue: price != null ? unclosed * K_CONCRETE * price : null,
        finishedAt,
        closedAt,
        pendingSince,
        deadline,
        overdueDays,
        protectionDays: finishedAt && closedAt ? Math.max(0, daysBetween(finishedAt, closedAt)) : null,
        status,
      });
    }
  }
  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.materialId - b.materialId);
  return { rows, tiers: tierRows.map((t) => ({ id: t.id, code: t.code, name: t.name })) };
}
