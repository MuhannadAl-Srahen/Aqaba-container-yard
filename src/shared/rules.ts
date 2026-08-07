import type { Position, Size, YardConfig } from './types';
import { GROUND_TIER, MAX_TIER } from './types';
import { sameSlot, zoneForSize } from './address';

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
  readonly position: Position;
}

export type RuleRefusal =
  | { readonly code: 'OUT_OF_BOUNDS' }
  | { readonly code: 'WRONG_ZONE' }
  | { readonly code: 'SLOT_TAKEN'; readonly by: string }
  | { readonly code: 'NO_SUPPORT' }
  | { readonly code: 'BURIED'; readonly by: string };

export function zoneOf(yard: YardConfig, zone: Size): { rows: number; cols: number } {
  return zone === 20 ? yard.twenty : yard.forty;
}

export function isWithinYard(yard: YardConfig, position: Position): boolean {
  const zone = zoneOf(yard, position.zone);
  return (
    position.row >= 1 &&
    position.row <= zone.rows &&
    position.col >= 1 &&
    position.col <= zone.cols &&
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

/** The container directly on top of this one, if any. */
export function containerAbove(standing: readonly Standing[], of: Standing): Standing | null {
  if (of.position.tier >= MAX_TIER) return null;
  return occupantAt(standing, { ...of.position, tier: (of.position.tier + 1) as Position['tier'] });
}

/**
 * May a container of this size land on this position, given who is standing?
 * `ignoreId` removes the moving container itself from the picture — without
 * that, a container could use its own body as the support under a move, or
 * refuse its own current slot as taken.
 */
export function canPlace(
  yard: YardConfig,
  standing: readonly Standing[],
  size: Size,
  position: Position,
  ignoreId?: number,
): RuleRefusal | null {
  const others = ignoreId === undefined ? standing : standing.filter((s) => s.id !== ignoreId);

  if (!isWithinYard(yard, position)) return { code: 'OUT_OF_BOUNDS' };
  if (zoneForSize(size) !== position.zone) return { code: 'WRONG_ZONE' };

  const occupant = occupantAt(others, position);
  if (occupant !== null) return { code: 'SLOT_TAKEN', by: occupant.number };

  if (position.tier > GROUND_TIER) {
    const below = occupantAt(others, { ...position, tier: (position.tier - 1) as Position['tier'] });
    if (below === null) return { code: 'NO_SUPPORT' };
  }

  return null;
}

/** May this container be lifted (for a move or a gate-out)? */
export function canLift(standing: readonly Standing[], of: Standing): RuleRefusal | null {
  const above = containerAbove(standing, of);
  if (above !== null) return { code: 'BURIED', by: above.number };
  return null;
}

/**
 * Positions a shrink would strand: standing containers whose slot falls
 * outside the proposed configuration. Growth is always safe.
 */
export function strandedByResize(
  proposed: YardConfig,
  standing: readonly Standing[],
): readonly Standing[] {
  return standing.filter((s) => !isWithinYard(proposed, s.position));
}
