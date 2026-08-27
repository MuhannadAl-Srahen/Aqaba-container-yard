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
 * Whatever the record shows resting DIRECTLY on this container — the cells of
 * its own footprint, one tier up.
 *
 * Deliberately not `liftPlan`: that plans a removal and refuses
 * `BLOCKED_DESCENT` before it can report a burial, so a correction that moves
 * no steel at all could come back talking about a container that cannot find
 * a landing. This answers the only question a correction needs: is anything
 * standing on this box?
 */
export function restingOn(
  standing: readonly Standing[],
  container: Standing,
): readonly Standing[] {
  const above = tierAbove(container.position.tier);
  if (above === null) return [];
  const cells = buildOccupancy(standing);
  const found = new Map<number, Standing>();
  for (const oddBay of baySpan(container.position.bay)) {
    const on = cells.get(cellKey(container.position.zone, oddBay, container.position.stack, above));
    if (on !== undefined && on.id !== container.id) found.set(on.id, on);
  }
  return [...found.values()];
}

/**
 * تصحيح الفئة: the at-most-two slots this STANDING record could truthfully
 * claim at the other class.
 *
 * A reclass moves no steel — it corrects what the book says about the ground
 * a box already occupies — so the zone, the stack and the tier are invariant
 * and only the bay moves, by one. `canPlace` with `ignoreId` then carries
 * everything else for free: parity (by construction), that every odd bay of
 * the new span exists at this stack, that both cells are clear with this
 * container excused, and support under every covered bay off the ground —
 * including the correct `NO_SUPPORT` when a tier-B 40 would narrow onto an
 * odd bay whose floor is a 40.
 */
export function reclassOptions(
  layout: YardLayout,
  standing: readonly Standing[],
  container: Standing,
): readonly Position[] {
  const { position } = container;
  return [position.bay - 1, position.bay + 1]
    .filter((bay) => bay >= 1)
    .map((bay) => ({ ...position, bay }))
    .filter(
      (candidate) =>
        canPlace(layout, standing, sizeOfBay(candidate.bay), candidate, container.id) === null,
    );
}

/**
 * The same two candidates for a record that has LEFT. Nothing is being
 * placed, so occupancy and support are not consulted — only that every odd
 * bay of the span is a slot the plan actually has. The address matters
 * because «إلغاء الخروج» reads it back to stand the container up again.
 */
export function reclassOptionsGone(
  layout: YardLayout,
  wasAt: Position,
): readonly Position[] {
  return [wasAt.bay - 1, wasAt.bay + 1]
    .filter((bay) => bay >= 1)
    .map((bay) => ({ ...wasAt, bay }))
    .filter((candidate) =>
      baySpan(candidate.bay).every((oddBay) =>
        slotUsable(layout, candidate.zone, oddBay, candidate.stack),
      ),
    );
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

/**
 * How much room is left, one entry per yard the layout actually contains —
 * one today, because the whole decoded drawing is SAHA 2, and however many
 * the day another yard is decoded. Ordered by yard number.
 */
export interface FreeNow {
  readonly yard: number;
  readonly t20: number;
  readonly t40: number;
}

export function freeNow(layout: YardLayout, standing: readonly Standing[]): FreeNow[] {
  const occupancy = buildOccupancy(standing);
  const totals = new Map<number, { t20: number; t40: number }>();
  for (const zone of layout.zones) {
    let bucket = totals.get(zone.yard);
    if (bucket === undefined) {
      bucket = { t20: 0, t40: 0 };
      totals.set(zone.yard, bucket);
    }
    const lastBay = zone.bays[zone.bays.length - 1] ?? 0;
    for (const bay of zone.bays) {
      for (const stack of zone.stacks[String(bay)] ?? []) {
        // Three tiers everywhere: the yard stacks three high as a matter of
        // course, so all three are room and all three are counted.
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
  return [...totals.entries()]
    .map(([yard, counts]) => ({ yard, ...counts }))
    .sort((a, b) => a.yard - b.yard);
}

/**
 * HOW MUCH ROOM IS LEFT — «كم باقي على الساحة ان تمتلئ».
 *
 * `freeNow` above answers a different question: how many slots would accept a
 * container RIGHT NOW, in one move each. For an empty yard that is 681 — one
 * ground slot per stack — and its forty-foot figure counts POSITIONS, not
 * containers: every 40 swallows two of them and cancels the positions either
 * side. Read as «كم أربعين تدخل» it was simply wrong, and the owner said so.
 *
 * These figures answer the question actually asked: filling from here, how
 * many more containers go in — all twenties, or all forties?
 *
 * The height is a parameter because not every part of the yard is stacked
 * three high in practice. It changes nothing about what the yard ACCEPTS:
 * the rules still allow three tiers everywhere. It is an assumption for the
 * arithmetic, and the office chooses it on the screen.
 */
export interface FillPlan {
  /** Slots this zone has at the assumed height: stacks × tiers. */
  readonly capacity: number;
  /** Slots taken, counting a forty as the TWO it occupies. */
  readonly used: number;
  readonly freeSlots: number;
  /** How many more twenties fit, filling every stack from the ground up. */
  readonly twenties: number;
  /** How many more forties fit — a packing count, not a division. */
  readonly forties: number;
}

export interface ZoneFill extends FillPlan {
  readonly zone: Zone;
  readonly yard: number;
}

/**
 * A forty stands across two ADJACENT odd bays of one stack, and only on
 * forties. So each stack line is walked bay by bay at each tier: free
 * neighbours pair up (greedy along a path is optimal for this), and a pair on
 * the tier above is only counted where a pair was counted below it.
 */
function fortiesInZone(
  zone: ZoneDef,
  taken: ReadonlyMap<string, Standing>,
  tiers: readonly Tier[],
): number {
  let total = 0;
  const stacks = new Set<number>();
  for (const bay of zone.bays) for (const stack of zone.stacks[String(bay)] ?? []) stacks.add(stack);

  for (const stack of stacks) {
    // The odd bays of this zone that have this stack at all, in plan order.
    const line = zone.bays.filter((bay) => (zone.stacks[String(bay)] ?? []).includes(stack));
    /**
     * Which pairs have a forty beneath them — the ones counted here AND the
     * ones already standing. Counting only the planned ones would refuse to
     * stack on top of the yard's own forties, which is the commonest case.
     */
    let below = new Set<number>();
    for (const tier of tiers) {
      const planned = new Set<number>();
      const carrying = new Set<number>();
      for (let index = 0; index < line.length - 1; index += 1) {
        const left = line[index];
        const right = line[index + 1];
        if (left === undefined || right === undefined) continue;
        // Adjacent on the plan: 01 and 03 sit either side of the even bay 02.
        if (right !== left + 2) continue;
        const onLeft = taken.get(cellKey(zone.zone, left, stack, tier));
        const onRight = taken.get(cellKey(zone.zone, right, stack, tier));
        // One forty across both — it can carry another forty on its back.
        if (onLeft !== undefined && onLeft === onRight && onLeft.size === 40) {
          carrying.add(index);
          continue;
        }
        if (planned.has(index - 1)) continue; // its left neighbour is taken
        // A forty rests on forties: above the ground it needs one below.
        const supported = tier === tiers[0] || below.has(index);
        if (onLeft === undefined && onRight === undefined && supported) {
          planned.add(index);
          total += 1;
        }
      }
      below = new Set([...planned, ...carrying]);
    }
  }
  return total;
}

export function fillPlan(
  layout: YardLayout,
  standing: readonly Standing[],
  height: number,
): { readonly total: FillPlan; readonly zones: readonly ZoneFill[] } {
  const tiers = TIERS.slice(0, Math.max(1, Math.min(height, TIERS.length)));
  const taken = buildOccupancy(standing);

  const zones = layout.zones.map((zone): ZoneFill => {
    let slots = 0;
    let used = 0;
    for (const bay of zone.bays) {
      for (const stack of zone.stacks[String(bay)] ?? []) {
        for (const tier of tiers) {
          slots += 1;
          // The occupancy map already spreads a forty over both its odd bays,
          // so counting cells counts a forty as the two slots it fills.
          if (taken.get(cellKey(zone.zone, bay, stack, tier)) !== undefined) used += 1;
        }
      }
    }
    return {
      zone: zone.zone,
      yard: zone.yard,
      capacity: slots,
      used,
      freeSlots: slots - used,
      // Every empty slot can be reached by filling its stack from the ground
      // up, so what is free IS what still fits.
      twenties: slots - used,
      forties: fortiesInZone(zone, taken, tiers),
    };
  });

  const total = zones.reduce<FillPlan>(
    (sum, zone) => ({
      capacity: sum.capacity + zone.capacity,
      used: sum.used + zone.used,
      freeSlots: sum.freeSlots + zone.freeSlots,
      twenties: sum.twenties + zone.twenties,
      forties: sum.forties + zone.forties,
    }),
    { capacity: 0, used: 0, freeSlots: 0, twenties: 0, forties: 0 },
  );
  return { total, zones };
}
