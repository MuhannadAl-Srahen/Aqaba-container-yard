import type { BlockConfig, ContainerDto, Position, Size, YardConfig } from '../shared/types';
import { MIXED_SIZE, PLACES_20, PLACES_40 } from '../shared/types';
import { positionKey, positionLabel, type BlockNamer } from '../shared/address';
import {
  buildUsage,
  canPlace,
  locationCapacity,
  placesFor,
  type Standing,
} from '../shared/rules';
import { blockTakes } from '../shared/geometry';
import { normalizeNumber } from '../shared/iso6346';

/**
 * Pure map arithmetic, kept out of the components so it can be tested without
 * rendering anything.
 */

/** What stands in each location, keyed by `positionKey`, in gate-in order. */
export function buildLoads(
  containers: readonly ContainerDto[],
): Map<string, ContainerDto[]> {
  const loads = new Map<string, ContainerDto[]>();
  for (const container of containers) {
    if (container.position === null) continue;
    const key = positionKey(container.position);
    const load = loads.get(key);
    if (load === undefined) loads.set(key, [container]);
    else load.push(container);
  }
  return loads;
}

/** Places those containers claim together — a 40 counts for two. */
export function placesUsed(load: readonly ContainerDto[] | undefined): number {
  if (load === undefined) return 0;
  return load.reduce((sum, container) => sum + placesFor(container.size), 0);
}

/** The fewest places anything this column accepts would claim. */
export function smallestPlaces(block: Pick<BlockConfig, 'size'>): number {
  return block.size === 40 ? placesFor(40) : placesFor(20);
}

/**
 * How full a location reads, counted the way its own column speaks: a column
 * dedicated to one size counts containers ("2 of 4 forties"), a mixed one
 * counts twenty-foot places, because there is no single container to count.
 */
export interface LocationCount {
  readonly used: number;
  readonly total: number;
  /** Mixed columns count places; dedicated ones count containers. */
  readonly inPlaces: boolean;
  /** Nothing this column accepts fits any more. */
  readonly full: boolean;
}

export function countLocation(
  block: Pick<BlockConfig, 'size' | 'placesPerTier' | 'tiers'>,
  load: readonly ContainerDto[] | undefined,
): LocationCount {
  const capacity = locationCapacity(block);
  const places = placesUsed(load);
  const full = capacity - places < smallestPlaces(block);
  if (block.size === MIXED_SIZE) {
    return { used: places, total: capacity, inPlaces: true, full };
  }
  const per = placesFor(block.size);
  return { used: places / per, total: capacity / per, inPlaces: false, full };
}

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

/**
 * Every location a container of this size may go into right now, keyed
 * `block|row`. Used to paint the green targets in moving mode — the SAME rule
 * functions the server runs, so the paint cannot lie.
 */
export function legalTargets(
  yard: YardConfig,
  containers: readonly ContainerDto[],
  size: Size,
  ignoreId?: number,
): Set<string> {
  const standing = toStanding(containers);
  // One index for the whole sweep — without it every probe rescans standing.
  const usage = buildUsage(standing);
  const targets = new Set<string>();

  for (const block of yard.blocks) {
    if (!blockTakes(block.size, size)) continue;
    for (let row = 1; row <= block.rows; row += 1) {
      const position: Position = { block: block.id, row };
      if (canPlace(yard, standing, size, position, ignoreId, usage) === null) {
        targets.add(positionKey(position));
      }
    }
  }
  return targets;
}

/** Container ids whose number or customer matches the query. */
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
      container.customer.toLowerCase().includes(lower)
    ) {
      matches.add(container.id);
    }
  }
  return matches;
}

export interface BlockSummary {
  /** Twenty-foot places still open across the whole column. */
  freePlaces: number;
  totalPlaces: number;
}

export function summarizeBlock(
  block: Pick<BlockConfig, 'id' | 'rows' | 'placesPerTier' | 'tiers'>,
  loads: ReadonlyMap<string, readonly ContainerDto[]>,
): BlockSummary {
  const totalPlaces = block.rows * locationCapacity(block);
  let used = 0;
  for (let row = 1; row <= block.rows; row += 1) {
    used += placesUsed(loads.get(positionKey({ block: block.id, row })));
  }
  return { freePlaces: totalPlaces - used, totalPlaces };
}

/**
 * What is still open in the whole yard, kept apart by the size that can use
 * it — a free place in a 40 column is no use to a 20 waiting at the gate.
 * Counted in CONTAINERS of that size, which is the unit the gate speaks;
 * the mixed reserve is counted in twenty-foot places, since it takes both.
 */
export interface YardFreeSpace {
  readonly forty: number;
  readonly twenty: number;
  readonly mixed: number;
}

export function yardFreeSpace(
  yard: YardConfig,
  loads: ReadonlyMap<string, readonly ContainerDto[]>,
): YardFreeSpace {
  let forty = 0;
  let twenty = 0;
  let mixed = 0;
  for (const block of yard.blocks) {
    const free = summarizeBlock(block, loads).freePlaces;
    if (block.size === 40) forty += Math.floor(free / PLACES_40);
    else if (block.size === 20) twenty += free / PLACES_20;
    else mixed += free;
  }
  return { forty, twenty, mixed };
}

/** A position labeler bound to the state's block names, `؟` for the unknown. */
export function labelerFrom(blockNames: Readonly<Record<string, string>>): (p: Position) => string {
  const nameOf: BlockNamer = (id) => blockNames[String(id)] ?? '؟';
  return (position) => positionLabel(nameOf, position);
}
