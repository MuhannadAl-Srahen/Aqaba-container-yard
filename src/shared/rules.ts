import type { ErrorCode, Position, Size, Tier, YardLayout, Zone, ZoneDef } from './types';
import { TIERS, sizeOfBay, tierAbove, tierBelow } from './types';
import { baySpan, samePosition } from './address';

/**
 * The physics of the official grid, pure and shared. The server is the
 * authority — it re-runs these checks inside its transaction; the client runs
 * the same ones only so the screen can answer before the network does.
 *
 * The ground truth (which slots exist at all) is the decoded ASEZA layout;
 * these rules never invent a slot the drawing does not show.
 */

/** The standing containers as the rules see them. */
export interface Standing {
  readonly id: number;
  readonly number: string;
  readonly size: Size;
  readonly position: Position;
}

export interface Refusal {
  readonly code: ErrorCode;
  /** The other container involved, when one is (occupier, the one on top…). */
  readonly other?: string;
}

export function zoneOf(layout: YardLayout, zone: Zone): ZoneDef | null {
  return layout.zones.find((z) => z.zone === zone) ?? null;
}

/** Does this twenty-foot ground slot exist on the official plan? */
export function slotUsable(layout: YardLayout, zone: Zone, oddBay: number, stack: number): boolean {
  const def = zoneOf(layout, zone);
  if (def === null) return false;
  const stacks = def.stacks[String(oddBay)];
  return stacks !== undefined && stacks.includes(stack);
}

/** `zone|oddBay|stack|tier` — one twenty-foot cell of air, ground or first floor. */
function cellKey(zone: Zone, oddBay: number, stack: number, tier: Tier): string {
  return `${zone}|${String(oddBay)}|${String(stack)}|${tier}`;
}

/**
 * Who covers which cell. A 20 covers one cell; a 40 at an even bay covers the
 * same cell of both odd bays it lies across. Built once per check or screen
 * frame — the yard is 681 ground slots, this is nothing.
 */
export function buildOccupancy(standing: readonly Standing[]): ReadonlyMap<string, Standing> {
  const map = new Map<string, Standing>();
  for (const container of standing) {
    for (const oddBay of baySpan(container.position.bay)) {
      map.set(
        cellKey(container.position.zone, oddBay, container.position.stack, container.position.tier),
        container,
      );
    }
  }
  return map;
}

/**
 * May a container of this size land exactly here?
 *
 * The checks, in the order a crane driver would hit them:
 *  - the bay's parity IS the size — a 20 on an odd bay, a 40 on an even one;
 *  - every ground slot it covers must exist on the plan (walls clip some);
 *  - nobody may already cover any of its cells;
 *  - off the ground (tiers B and C alike), every covered odd bay needs
 *    support on the tier directly below — and a 20 may only sit on a 20:
 *    a 40's roof has no corner castings in the middle, so a 20 resting on
 *    half a 40 has nothing to lock into. A 40 on top may rest on two 20s or
 *    on a 40 — both give it four corners.
 */
export function canPlace(
  layout: YardLayout,
  standing: readonly Standing[],
  size: Size,
  position: Position,
  ignoreId?: number,
  occupancy?: ReadonlyMap<string, Standing>,
): Refusal | null {
  if (sizeOfBay(position.bay) !== size) return { code: 'BAD_SLOT' };
  const span = baySpan(position.bay);
  for (const oddBay of span) {
    if (!slotUsable(layout, position.zone, oddBay, position.stack)) return { code: 'BAD_SLOT' };
  }

  const cells =
    occupancy ?? buildOccupancy(ignoreId === undefined ? standing : standing.filter((s) => s.id !== ignoreId));
  for (const oddBay of span) {
    const occupier = cells.get(cellKey(position.zone, oddBay, position.stack, position.tier));
    if (occupier !== undefined && occupier.id !== ignoreId) {
      return { code: 'OCCUPIED', other: occupier.number };
    }
  }

  const floor = tierBelow(position.tier);
  if (floor !== null) {
    for (const oddBay of span) {
      const below = cells.get(cellKey(position.zone, oddBay, position.stack, floor));
      if (below === undefined || below.id === ignoreId) return { code: 'NO_SUPPORT' };
      if (size === 20 && below.size === 40) return { code: 'NO_SUPPORT' };
    }
  }
  return null;
}

/**
 * May this container be lifted out (for a move or an exit)? Not while
 * another one stands on top of it — that one comes down first. The top of
 * the stack is always free to go.
 */
export function canRemove(
  standing: readonly Standing[],
  container: Standing,
  occupancy?: ReadonlyMap<string, Standing>,
): Refusal | null {
  const roof = tierAbove(container.position.tier);
  if (roof === null) return null;
  const cells = occupancy ?? buildOccupancy(standing);
  for (const oddBay of baySpan(container.position.bay)) {
    const above = cells.get(cellKey(container.position.zone, oddBay, container.position.stack, roof));
    if (above !== undefined) return { code: 'BURIED', other: above.number };
  }
  return null;
}

/** A move is a lift plus a landing; the same-slot case gets its own word. */
export function canMove(
  layout: YardLayout,
  standing: readonly Standing[],
  container: Standing,
  to: Position,
): Refusal | null {
  if (samePosition(container.position, to)) return { code: 'SAME_SLOT' };
  const lift = canRemove(standing, container);
  if (lift !== null) return lift;
  return canPlace(layout, standing, container.size, to, container.id);
}

/** «قديش باقي» for one size: how many legal landings exist right now. */
export interface FreeNow {
  readonly yard1: { readonly t20: number; readonly t40: number };
  readonly yard2: { readonly t20: number; readonly t40: number };
}

export function freeNow(layout: YardLayout, standing: readonly Standing[]): FreeNow {
  const occupancy = buildOccupancy(standing);
  const totals = { yard1: { t20: 0, t40: 0 }, yard2: { t20: 0, t40: 0 } };
  for (const zone of layout.zones) {
    const bucket = zone.yard === 1 ? totals.yard1 : totals.yard2;
    const lastBay = zone.bays[zone.bays.length - 1] ?? 0;
    for (const bay of zone.bays) {
      for (const stack of zone.stacks[String(bay)] ?? []) {
        for (const tier of TIERS) {
          const spot = { zone: zone.zone, bay, stack, tier };
          if (canPlace(layout, standing, 20, spot, undefined, occupancy) === null) bucket.t20 += 1;
          // The even bay between this odd bay and the next, inside the zone.
          if (bay + 2 <= lastBay) {
            const forty = { zone: zone.zone, bay: bay + 1, stack, tier };
            if (canPlace(layout, standing, 40, forty, undefined, occupancy) === null) bucket.t40 += 1;
          }
        }
      }
    }
  }
  return totals;
}
