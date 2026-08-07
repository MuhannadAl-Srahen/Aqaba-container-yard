import type { Position, Tier } from './types';
import { GROUND_TIER } from './types';

/**
 * How a position is written and said — the paper register's own notation:
 * `A1-5-H` is area A, line (column) 1, position (row) 5, upper tier. L is
 * the ground, H the one above, exactly as the yard has always written it.
 */

export function tierName(tier: Tier): string {
  return tier === GROUND_TIER ? 'الأرضي' : 'الأول';
}

/** The register's tier letter: L on the ground, H on top. */
export function tierLetter(tier: Tier): string {
  return tier === GROUND_TIER ? 'L' : 'H';
}

/** Resolves a block id to its display name, however the caller knows names. */
export type BlockNamer = (blockId: number) => string;

/** `A1-5` — area name fused with its line number, then the position. */
export function slotLabel(
  nameOf: BlockNamer,
  position: Pick<Position, 'block' | 'row' | 'col'>,
): string {
  return `${nameOf(position.block)}${String(position.col)}-${String(position.row)}`;
}

/** The full written form: `A1-5-H`. */
export function positionLabel(nameOf: BlockNamer, position: Position): string {
  return `${slotLabel(nameOf, position)}-${tierLetter(position.tier)}`;
}

/** Two positions naming the same physical slot, ignoring tier. */
export function sameSlot(
  a: Pick<Position, 'block' | 'row' | 'col'>,
  b: Pick<Position, 'block' | 'row' | 'col'>,
): boolean {
  return a.block === b.block && a.row === b.row && a.col === b.col;
}

/** A stable string key for map lookups. */
export function slotKey(position: Pick<Position, 'block' | 'row' | 'col'>): string {
  return `${position.block}|${position.row}|${position.col}`;
}

export function positionKey(position: Position): string {
  return `${slotKey(position)}|${position.tier}`;
}
