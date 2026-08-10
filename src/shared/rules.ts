import type { BlockConfig, Position, Size, YardConfig } from './types';
import { PLACES_20, PLACES_40 } from './types';
import { positionKey } from './address';
import { blockTakes } from './geometry';

/**
 * The yard's rules, pure and I/O-free. The server runs these inside its write
 * transaction as the single authority; the client runs the same functions
 * against its snapshot so a refusal is visible before a request is ever sent.
 * One implementation, two callers — they cannot disagree.
 */

/** What a rule check needs to know about one standing container. */
export interface Standing {
  readonly id: number;
  readonly number: string;
  readonly size: Size;
  readonly position: Position;
}

export type RuleRefusal =
  | { readonly code: 'OUT_OF_BOUNDS' }
  | { readonly code: 'WRONG_ZONE' }
  | { readonly code: 'LOCATION_FULL'; readonly free: number; readonly need: number };

/** Twenty-foot places this size claims inside a location. */
export function placesFor(size: Size): number {
  return size === 40 ? PLACES_40 : PLACES_20;
}

/** Every place one location holds: what fits per tier, times the tiers. */
export function locationCapacity(block: Pick<BlockConfig, 'placesPerTier' | 'tiers'>): number {
  return block.placesPerTier * block.tiers;
}

export function blockOf(yard: YardConfig, blockId: number): BlockConfig | null {
  return yard.blocks.find((block) => block.id === blockId) ?? null;
}

/** All live blocks that receive this container size (mixed take both). */
export function blocksForSize(yard: YardConfig, size: Size): readonly BlockConfig[] {
  return yard.blocks.filter((block) => blockTakes(block.size, size));
}

export function isWithinYard(yard: YardConfig, position: Position): boolean {
  const block = blockOf(yard, position.block);
  if (block === null) return false;
  return position.row >= 1 && position.row <= block.rows;
}

/**
 * Places taken per location, keyed by `positionKey`. Callers that probe many
 * locations against the same snapshot (the green-target painter sweeps every
 * location in the yard per repaint) build this once and hand it to
 * `canPlace` instead of paying a full scan per probe.
 */
export function buildUsage(standing: readonly Standing[]): ReadonlyMap<string, number> {
  const usage = new Map<string, number>();
  for (const s of standing) {
    const key = positionKey(s.position);
    usage.set(key, (usage.get(key) ?? 0) + placesFor(s.size));
  }
  return usage;
}

/**
 * Places already taken in a location, with `ignoreId` discounted. Passing the
 * `buildUsage` index built over the SAME standing list and then subtracting
 * the ignored container's places is exactly the filtered sum, so the indexed
 * and scanning paths cannot disagree.
 */
export function usedPlaces(
  standing: readonly Standing[],
  position: Position,
  ignoreId?: number,
  usage?: ReadonlyMap<string, number>,
): number {
  const isHere = (s: Standing): boolean =>
    s.position.block === position.block && s.position.row === position.row;

  if (usage === undefined) {
    let total = 0;
    for (const s of standing) {
      if (s.id !== ignoreId && isHere(s)) total += placesFor(s.size);
    }
    return total;
  }

  const total = usage.get(positionKey(position)) ?? 0;
  const ignored = standing.find((s) => s.id === ignoreId && isHere(s));
  return ignored === undefined ? total : total - placesFor(ignored.size);
}

/**
 * May a container of this size go into this location? `ignoreId` removes the
 * moving container itself from the count — without it, a container shuffled
 * within its own location would be refused by its own body.
 */
export function canPlace(
  yard: YardConfig,
  standing: readonly Standing[],
  size: Size,
  position: Position,
  ignoreId?: number,
  usage?: ReadonlyMap<string, number>,
): RuleRefusal | null {
  const block = blockOf(yard, position.block);
  if (block === null || !isWithinYard(yard, position)) return { code: 'OUT_OF_BOUNDS' };
  if (!blockTakes(block.size, size)) return { code: 'WRONG_ZONE' };

  const free = locationCapacity(block) - usedPlaces(standing, position, ignoreId, usage);
  const need = placesFor(size);
  if (need > free) return { code: 'LOCATION_FULL', free, need };

  return null;
}

/*
 * There is no `canLift` any more. Nothing is buried when nothing is tracked
 * by floor, and the yard asked for the administrative hold to go with the
 * rest of the container states: whatever must not leave is written in the
 * notes, and the notes ride along on every register.
 */

/**
 * Containers a proposed layout would strand: whose block disappears, whose
 * location falls off the end of a shortened column, or whose size no longer
 * matches the block's policy. Growth and movement are always safe — a column
 * carries its containers with it wherever it is dragged or turned.
 */
export function strandedByLayout(
  proposed: YardConfig,
  standing: readonly Standing[],
  sizes: ReadonlyMap<number, Size>,
): readonly Standing[] {
  return standing.filter((s) => {
    const block = blockOf(proposed, s.position.block);
    if (block === null || !isWithinYard(proposed, s.position)) return true;
    const size = sizes.get(s.id);
    return size !== undefined && !blockTakes(block.size, size);
  });
}

/**
 * Locations a proposed layout would overfill — capacity or tiers cut below
 * what already stands there. Reported separately from stranding because the
 * fix is different: the owner raises the number back, or empties the location.
 */
export function overfilledByLayout(
  proposed: YardConfig,
  standing: readonly Standing[],
): readonly Position[] {
  const used = new Map<string, { position: Position; places: number }>();
  for (const s of standing) {
    const key = positionKey(s.position);
    const entry = used.get(key);
    if (entry === undefined) used.set(key, { position: s.position, places: placesFor(s.size) });
    else entry.places += placesFor(s.size);
  }

  const over: Position[] = [];
  for (const { position, places } of used.values()) {
    const block = blockOf(proposed, position.block);
    // A vanished or shortened column is stranding, not overfilling.
    if (block === null || !isWithinYard(proposed, position)) continue;
    if (places > locationCapacity(block)) over.push(position);
  }
  return over;
}
