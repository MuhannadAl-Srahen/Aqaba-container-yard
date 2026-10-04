import type { CustomZoneDto, YardLayout, ZoneDef } from './types';
import { ASEZA } from './asezaLayout';
import { registerYards } from './address';

/**
 * The effective yard: the OFFICIAL ASEZA drawing — committed data, never
 * edited — plus the zones the owner defines himself, in his own yards or
 * appended beside the plan. Both sides of the wire compose the same picture
 * from the same pieces, and the server stays the only authority on placing.
 */

/**
 * The ASEZA drawing's own scale, about 59 units a bay: zone A spreads its 38
 * odd bays over 2232 units (58 a bay inside a 14-unit frame).
 */
const BAY_W = 59;
const ZONE_H = 150;
const ROW_GAP = 20;

/**
 * An owner zone as the rules and the map read it: bays 1, 3 … (2n−1), each
 * carrying stacks 1 … n minus what the owner closed — a closed ground slot
 * simply does not exist, exactly the way the official plan's walls clip
 * theirs, so every placement rule refuses it without knowing why it is gone.
 */
export function zoneDefOf(custom: CustomZoneDto, x: number, y: number): ZoneDef {
  const bays = Array.from({ length: custom.bays }, (_, i) => i * 2 + 1);
  const shut = new Set(custom.closed.map(([bay, stack]) => `${String(bay)}|${String(stack)}`));
  const stacks: Record<string, readonly number[]> = {};
  for (const bay of bays) {
    stacks[String(bay)] = Array.from({ length: custom.stacks }, (_, i) => i + 1).filter(
      (stack) => !shut.has(`${String(bay)}|${String(stack)}`),
    );
  }
  return {
    zone: custom.zone,
    yard: custom.yard,
    x,
    y,
    w: custom.bays * BAY_W,
    h: ZONE_H,
    bays,
    stacks,
  };
}

/**
 * Compose the whole effective layout. Zones of an owner yard stack downward
 * from the top of that yard's own canvas; zones added to yard 2 line up
 * BELOW the official drawing, which is never moved and never touched. As a
 * deliberate side effect the yard registry learns every zone's yard, so an
 * address label anywhere in the app writes the right leading digit.
 */
export function composeLayout(
  customs: readonly CustomZoneDto[],
  retired: ReadonlyArray<{ readonly zone: string; readonly yard: number }> = [],
): YardLayout {
  // Struck zones first, the living last: a retired letter still names its
  // old yard so history's papers reprint as stamped. The server sends only
  // retired letters that history needs and that no living zone owns, so
  // the two sets cannot disagree.
  registerYards(retired);
  registerYards(customs);
  const asezaBottom = Math.max(
    ...ASEZA.zones.map((zone) => zone.y + zone.h),
    ...ASEZA.landmarks.map((mark) => mark.y + mark.h),
  );
  const nextY = new Map<number, number>();
  // A parked zone reserves its band: the automatic flow lines up BELOW the
  // lowest parked strip of its yard instead of drawing across it.
  for (const custom of customs) {
    if (custom.x === null || custom.y === null) continue;
    const start = custom.yard === 2 ? asezaBottom + ROW_GAP : 0;
    const below = custom.y + ZONE_H + ROW_GAP;
    if (below > (nextY.get(custom.yard) ?? start)) nextY.set(custom.yard, below);
  }
  const defs: ZoneDef[] = [];
  for (const custom of [...customs].sort((a, b) => a.id - b.id)) {
    // A parked zone stands where the owner put it; the rest line up below
    // one another, and on yard 2 below the official drawing.
    if (custom.x !== null && custom.y !== null) {
      defs.push(zoneDefOf(custom, custom.x, custom.y));
      continue;
    }
    const start = custom.yard === 2 ? asezaBottom + ROW_GAP : 0;
    const y = nextY.get(custom.yard) ?? start;
    defs.push(zoneDefOf(custom, 0, y));
    nextY.set(custom.yard, y + ZONE_H + ROW_GAP);
  }
  return { zones: [...ASEZA.zones, ...defs], landmarks: ASEZA.landmarks };
}

/** Every yard the layout draws, smallest first — the map's tab row. */
export function yardsOf(layout: YardLayout): readonly number[] {
  return [...new Set(layout.zones.map((zone) => zone.yard))].sort((a, b) => a - b);
}

/** One yard's own picture: its zones, and the landmarks only on the plan's. */
export function yardSlice(layout: YardLayout, yard: number): YardLayout {
  return {
    zones: layout.zones.filter((zone) => zone.yard === yard),
    landmarks: yard === 2 ? layout.landmarks : [],
  };
}
