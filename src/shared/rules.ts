import type { BlockConfig, ContainerStatus, Position, Size, YardConfig } from './types';
import { GROUND_TIER, MAX_TIER } from './types';
import { positionKey, sameSlot } from './address';
import { blockTakes } from './geometry';

/**
 * The yard's physical rules, pure and I/O-free. The server runs these inside
 * its write transaction as the single authority; the client runs the same
 * functions against its snapshot so a refusal is visible before a request is
 * ever sent. One implementation, two callers — they cannot disagree.
 */

/** What a rule check needs to know about one standing container. */
export interface Standing {
  readonly id: number;
  readonly number: string;
  readonly size: Size;
  readonly status: ContainerStatus;
  readonly position: Position;
}

export type RuleRefusal =
  | { readonly code: 'OUT_OF_BOUNDS' }
  | { readonly code: 'WRONG_ZONE' }
  | { readonly code: 'SLOT_TAKEN'; readonly by: string }
  | { readonly code: 'NO_SUPPORT' }
  | { readonly code: 'BAD_STACK'; readonly by: string }
  | { readonly code: 'BURIED'; readonly by: string }
  | { readonly code: 'CONTAINER_HOLD' };

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
  return (
    position.row >= 1 &&
    position.row <= block.rows &&
    position.col >= 1 &&
    position.col <= block.cols &&
    position.tier >= GROUND_TIER &&
    position.tier <= MAX_TIER
  );
}

export function occupantAt(standing: readonly Standing[], position: Position): Standing | null {
  return (
    standing.find(
      (s) => sameSlot(s.position, position) && s.position.tier === position.tier,
    ) ?? null
  );
}

/**
 * The standing list as a position-keyed index. Callers that probe many
 * positions against the same snapshot (the green-target painter runs ~1800
 * `canPlace` probes per repaint) build this once and hand it to `canPlace`
 * instead of paying a linear scan per probe.
 */
export function buildOccupancy(standing: readonly Standing[]): ReadonlyMap<string, Standing> {
  const occupancy = new Map<string, Standing>();
  for (const s of standing) occupancy.set(positionKey(s.position), s);
  return occupancy;
}

/** The container directly on top of this one, if any. */
export function containerAbove(standing: readonly Standing[], of: Standing): Standing | null {
  if (of.position.tier >= MAX_TIER) return null;
  return occupantAt(standing, { ...of.position, tier: (of.position.tier + 1) as Position['tier'] });
}

/**
 * May a container of this size land on this position, given who is standing?
 * `ignoreId` removes the moving container itself from the picture — without
 * that, a container could use its own body as the support under a move, or
 * refuse its own current slot as taken. `occupancy` is an optional
 * `buildOccupancy` index over the SAME standing list; at most one container
 * occupies a position (the DB unique index guarantees it), so looking up
 * then discarding the ignored id is exactly the filtered scan.
 */
export function canPlace(
  yard: YardConfig,
  standing: readonly Standing[],
  size: Size,
  position: Position,
  ignoreId?: number,
  occupancy?: ReadonlyMap<string, Standing>,
): RuleRefusal | null {
  const occupantIn = (at: Position): Standing | null => {
    const found =
      occupancy !== undefined ? (occupancy.get(positionKey(at)) ?? null) : occupantAt(standing, at);
    return found !== null && found.id === ignoreId ? null : found;
  };

  const block = blockOf(yard, position.block);
  if (block === null || !isWithinYard(yard, position)) return { code: 'OUT_OF_BOUNDS' };
  if (!blockTakes(block.size, size)) return { code: 'WRONG_ZONE' };

  const occupant = occupantIn(position);
  if (occupant !== null) return { code: 'SLOT_TAKEN', by: occupant.number };

  if (position.tier > GROUND_TIER) {
    const below = occupantIn({ ...position, tier: (position.tier - 1) as Position['tier'] });
    if (below === null) return { code: 'NO_SUPPORT' };
    // Physics: a 40 overhangs a 20 and falls — it never stacks on one.
    if (size === 40 && below.size === 20) return { code: 'BAD_STACK', by: below.number };
  }

  return null;
}

/** May this container be lifted (for a move, a gate-out or a delete)? */
export function canLift(standing: readonly Standing[], of: Standing): RuleRefusal | null {
  // The administrative hold outranks the physical stack: even a top box
  // stays exactly where it is until the hold is lifted.
  if (of.status === 'HOLD') return { code: 'CONTAINER_HOLD' };
  const above = containerAbove(standing, of);
  if (above !== null) return { code: 'BURIED', by: above.number };
  return null;
}

/**
 * Containers a proposed layout would strand: whose block disappears, whose
 * slot falls outside the block's new shape, or whose size no longer matches
 * the block's. Growth and movement are always safe — a block carries its
 * containers with it wherever it is dragged or turned.
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
