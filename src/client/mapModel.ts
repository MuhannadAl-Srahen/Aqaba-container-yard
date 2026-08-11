import type { ContainerDto, Position, Size, Tier, YardLayout, Zone, ZoneDef } from '../shared/types';
import { TIERS } from '../shared/types';
import { baySpan } from '../shared/address';
import { buildOccupancy, canPlace, type Standing } from '../shared/rules';
import { normalizeNumber } from '../shared/iso6346';

/**
 * Pure map arithmetic, kept out of the components so it can be tested without
 * rendering anything. The grid itself is the official layout; everything here
 * only counts who stands where on it.
 */

export function toStanding(containers: readonly ContainerDto[]): Standing[] {
  const standing: Standing[] = [];
  for (const container of containers) {
    if (container.position === null) continue;
    standing.push({
      id: container.id,
      number: container.number,
      size: container.size,
      position: container.position,
    });
  }
  return standing;
}

/** `zone|oddBay` — the ground a map cell draws. */
export const bayKey = (zone: Zone, oddBay: number): string => `${zone}|${String(oddBay)}`;

/**
 * Who covers each odd bay, keyed by `bayKey`. A 40 stored at its even bay
 * appears under BOTH odd bays it lies across — the map paints it on both
 * cells, and each bay sheet shows it among its own slots.
 */
export function buildBayLoads(
  containers: readonly ContainerDto[],
): Map<string, ContainerDto[]> {
  const loads = new Map<string, ContainerDto[]>();
  for (const container of containers) {
    if (container.position === null) continue;
    for (const oddBay of baySpan(container.position.bay)) {
      const key = bayKey(container.position.zone, oddBay);
      const load = loads.get(key);
      if (load === undefined) loads.set(key, [container]);
      else load.push(container);
    }
  }
  return loads;
}

/** How full one bay reads: TEU standing over TEU the plan gives it. */
export interface BayCount {
  readonly used: number;
  readonly total: number;
  readonly full: boolean;
  /** At least one container of dangerous goods stands in this bay. */
  readonly hazmat: boolean;
}

export function countBay(
  zone: ZoneDef,
  oddBay: number,
  load: readonly ContainerDto[] | undefined,
): BayCount {
  const total = (zone.stacks[String(oddBay)]?.length ?? 0) * TIERS.length;
  // A 40 puts one TEU of itself on each odd bay it covers, so per-bay TEU is
  // simply the number of containers listed under the bay.
  const used = load?.length ?? 0;
  return {
    used,
    total,
    full: total > 0 && used >= total,
    // The map has to answer «وين المواد الخطرة؟» from across the room,
    // without opening a single bay.
    hazmat: load?.some((container) => container.hazmat) ?? false,
  };
}

/** Zone roll-up for the panel header: TEU standing against TEU capacity. */
export interface ZoneSummary {
  readonly usedTeu: number;
  readonly totalTeu: number;
}

export function summarizeZone(
  zone: ZoneDef,
  loads: ReadonlyMap<string, readonly ContainerDto[]>,
): ZoneSummary {
  let usedTeu = 0;
  let totalTeu = 0;
  for (const bay of zone.bays) {
    const count = countBay(zone, bay, loads.get(bayKey(zone.zone, bay)));
    usedTeu += count.used;
    totalTeu += count.total;
  }
  return { usedTeu, totalTeu };
}

/** The tallest stack this zone reaches anywhere — the bay sheet's grid width. */
export function maxStackOf(zone: ZoneDef): number {
  let max = 0;
  for (const bay of zone.bays) {
    for (const stack of zone.stacks[String(bay)] ?? []) max = Math.max(max, stack);
  }
  return max;
}

/**
 * What one slot of a bay sheet shows: the wall, an empty cell, or whoever
 * stands there (possibly a 40 reaching over from the even bay).
 */
export type SlotView =
  | { readonly kind: 'wall' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'taken'; readonly container: ContainerDto };

export function slotView(
  zone: ZoneDef,
  oddBay: number,
  stack: number,
  tier: Tier,
  load: readonly ContainerDto[] | undefined,
): SlotView {
  const usable = zone.stacks[String(oddBay)]?.includes(stack) ?? false;
  if (!usable) return { kind: 'wall' };
  const taken = load?.find(
    (container) =>
      container.position !== null &&
      container.position.stack === stack &&
      container.position.tier === tier &&
      baySpan(container.position.bay).includes(oddBay),
  );
  return taken === undefined ? { kind: 'empty' } : { kind: 'taken', container: taken };
}

/**
 * The landings a container of this size has inside ONE bay's sheet, computed
 * with the same shared rules the server runs — the paint cannot lie. For a
 * 40, the landing pairs this odd bay with a neighbour and is addressed by the
 * even bay between them.
 */
export function bayLandings(
  layout: YardLayout,
  zone: ZoneDef,
  oddBay: number,
  containers: readonly ContainerDto[],
  size: Size,
  ignoreId?: number,
): Position[] {
  const standing =
    ignoreId === undefined
      ? toStanding(containers)
      : toStanding(containers).filter((s) => s.id !== ignoreId);
  const occupancy = buildOccupancy(standing);
  const bays =
    size === 20
      ? [oddBay]
      : [oddBay - 1, oddBay + 1].filter((even) => even >= 2);
  const landings: Position[] = [];
  for (const bay of bays) {
    for (const stack of zone.stacks[String(oddBay)] ?? []) {
      for (const tier of TIERS) {
        const position: Position = { zone: zone.zone, bay, stack, tier };
        if (canPlace(layout, standing, size, position, ignoreId, occupancy) === null) {
          landings.push(position);
        }
      }
    }
  }
  return landings;
}

/**
 * The bays worth lighting up while a container is being placed: any bay whose
 * sheet contains at least one legal landing for it.
 */
export function targetBays(
  layout: YardLayout,
  containers: readonly ContainerDto[],
  size: Size,
  ignoreId?: number,
): Set<string> {
  const standing =
    ignoreId === undefined
      ? toStanding(containers)
      : toStanding(containers).filter((s) => s.id !== ignoreId);
  const occupancy = buildOccupancy(standing);
  const targets = new Set<string>();
  for (const zone of layout.zones) {
    const lastBay = zone.bays[zone.bays.length - 1] ?? 0;
    for (const bay of zone.bays) {
      const stacks = zone.stacks[String(bay)] ?? [];
      let reachable = false;
      for (const stack of stacks) {
        for (const tier of TIERS) {
          if (size === 20) {
            if (canPlace(layout, standing, 20, { zone: zone.zone, bay, stack, tier }, ignoreId, occupancy) === null) {
              reachable = true;
            }
          } else {
            for (const even of [bay - 1, bay + 1]) {
              if (even < 2 || even > lastBay) continue;
              if (canPlace(layout, standing, 40, { zone: zone.zone, bay: even, stack, tier }, ignoreId, occupancy) === null) {
                reachable = true;
              }
            }
          }
          if (reachable) break;
        }
        if (reachable) break;
      }
      if (reachable) targets.add(bayKey(zone.zone, bay));
    }
  }
  return targets;
}

/** Container ids whose number, owner or bill of lading matches the query. */
export function searchMatches(
  containers: readonly ContainerDto[],
  query: string,
): Set<number> {
  const matches = new Set<number>();
  const trimmed = query.trim();
  if (trimmed === '') return matches;

  const asNumber = normalizeNumber(trimmed);
  const lower = trimmed.toLowerCase();

  for (const container of containers) {
    if (
      (asNumber.length > 0 && container.number.includes(asNumber)) ||
      container.customer.toLowerCase().includes(lower) ||
      // Typing a bill number lights the WHOLE group on the map at once.
      (container.bill !== '' && container.bill.toLowerCase().includes(lower))
    ) {
      matches.add(container.id);
    }
  }
  return matches;
}

/**
 * The bills of lading the query touches, with how many containers each
 * gathers among the results at hand — the search's «بوليصة 3210 — 12 حاوية»
 * rows, each a doorway to the bill's own sheet.
 */
export function billMatches(
  containers: readonly ContainerDto[],
  query: string,
): Array<{ bill: string; count: number }> {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return [];
  const counts = new Map<string, number>();
  for (const container of containers) {
    if (container.bill === '' || !container.bill.toLowerCase().includes(trimmed)) continue;
    counts.set(container.bill, (counts.get(container.bill) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([bill, count]) => ({ bill, count }))
    .sort((a, b) => a.bill.localeCompare(b.bill))
    .slice(0, 5);
}
