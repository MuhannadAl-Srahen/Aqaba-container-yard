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

/** One container coming down a tier because what held it up has gone. */
export interface Descent {
  readonly container: Standing;
  /** Same zone, bay and stack — one tier lower. */
  readonly to: Position;
}

/** What lifting a container does to the stack above it, or why it cannot. */
export type Removal =
  | { readonly ok: true; readonly descents: readonly Descent[] }
  | { readonly ok: false; readonly refusal: Refusal };

/** The yard as it would stand once `removed` is gone and the rest has settled. */
function project(
  standing: readonly Standing[],
  removedId: number,
  descents: readonly Descent[],
): Standing[] {
  const landings = new Map(descents.map((descent) => [descent.container.id, descent.to]));
  const settled: Standing[] = [];
  for (const container of standing) {
    if (container.id === removedId) continue;
    const landing = landings.get(container.id);
    settled.push(landing === undefined ? container : { ...container, position: landing });
  }
  return settled;
}

/**
 * Gravity. Lifting a container out no longer refuses because something stands
 * on it: everything resting above comes down exactly one tier, the way the
 * yard itself restacks. Returns those descents — lowest tier first, so the
 * writes never collide — or the reason the stack cannot come down.
 *
 * Only one thing can go wrong, and it is real: a descending container may
 * find its landing cell still held by somebody who is not moving. A 40 lying
 * across two 20s when only one of them is lifted is the case — it has to be
 * relocated by hand first, and the refusal names it.
 *
 * Support after a descent is not reasoned about twice; the resulting yard is
 * projected and re-checked with `canPlace` itself.
 */
export function planRemoval(
  layout: YardLayout,
  standing: readonly Standing[],
  container: Standing,
): Removal {
  const cells = buildOccupancy(standing);

  // Breadth-first up the stack: whoever covers a cell directly above a cell
  // we are emptying loses its floor and follows it down.
  const queue: Standing[] = [container];
  const falling: Standing[] = [];
  const seen = new Set<number>([container.id]);
  while (queue.length > 0) {
    const below = queue.shift();
    if (below === undefined) break;
    const roof = tierAbove(below.position.tier);
    if (roof === null) continue;
    for (const oddBay of baySpan(below.position.bay)) {
      const above = cells.get(cellKey(below.position.zone, oddBay, below.position.stack, roof));
      if (above === undefined || seen.has(above.id)) continue;
      seen.add(above.id);
      falling.push(above);
      queue.push(above);
    }
  }
  falling.sort((a, b) => TIERS.indexOf(a.position.tier) - TIERS.indexOf(b.position.tier));

  const descents: Descent[] = [];
  for (const faller of falling) {
    const floor = tierBelow(faller.position.tier);
    // Nothing standing on something else can already be on the ground.
    if (floor === null) return { ok: false, refusal: { code: 'BLOCKED_DESCENT', other: faller.number } };
    descents.push({ container: faller, to: { ...faller.position, tier: floor } });
  }

  // Is every landing cell actually being vacated? This is asked against the
  // yard as it stands, not the projection, because an occupancy map holds one
  // container per cell — two boxes claiming the same cell would silently
  // overwrite each other there, and the clash would vanish exactly where it
  // matters. A 40 bridging two 20s with only one leg lifted lives here.
  const dropping = new Set(descents.map((descent) => descent.container.id));
  for (const descent of descents) {
    for (const oddBay of baySpan(descent.to.bay)) {
      const holder = cells.get(cellKey(descent.to.zone, oddBay, descent.to.stack, descent.to.tier));
      if (holder !== undefined && holder.id !== container.id && !dropping.has(holder.id)) {
        return { ok: false, refusal: { code: 'BLOCKED_DESCENT', other: descent.container.number } };
      }
    }
  }

  // With the cells provably free, the projection is faithful — so support can
  // be re-checked by the placement rules themselves rather than argued about.
  const settled = project(standing, container.id, descents);
  const after = buildOccupancy(settled);
  for (const descent of descents) {
    const landed = { ...descent.container, position: descent.to };
    if (canPlace(layout, settled, landed.size, landed.position, landed.id, after) !== null) {
      return { ok: false, refusal: { code: 'BLOCKED_DESCENT', other: landed.number } };
    }
  }
  return { ok: true, descents };
}

/**
 * May this container be lifted out at all? Only the blocked-descent case
 * refuses now — everything else simply comes down with it.
 */
export function canRemove(
  layout: YardLayout,
  standing: readonly Standing[],
  container: Standing,
): Refusal | null {
  const plan = planRemoval(layout, standing, container);
  return plan.ok ? null : plan.refusal;
}

/**
 * A move is a lift plus a landing; the same-slot case gets its own word. The
 * landing is judged against the yard AFTER the stack above has settled —
 * moving a container up into the slot its own roof just vacated is legal.
 */
export function canMove(
  layout: YardLayout,
  standing: readonly Standing[],
  container: Standing,
  to: Position,
): Refusal | null {
  if (samePosition(container.position, to)) return { code: 'SAME_SLOT' };
  const plan = planRemoval(layout, standing, container);
  if (!plan.ok) return plan.refusal;
  const settled = project(standing, container.id, plan.descents);
  return canPlace(layout, settled, container.size, to, container.id);
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
