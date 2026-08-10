import type { Position } from './types';

/**
 * How a location is written and said — the yard's own notation: `A-01` is
 * column A, row 01. Rows count in odd numbers because every location spans
 * two twenty-foot bays, exactly as the ground is marked.
 */

/** The register's row number: location 1 is 01, location 2 is 03, and on. */
export function rowNumber(row: number): string {
  return String(row * 2 - 1).padStart(2, '0');
}

/** Resolves a block id to its display name, however the caller knows names. */
export type BlockNamer = (blockId: number) => string;

/** The full written form: `A-01`. */
export function positionLabel(nameOf: BlockNamer, position: Position): string {
  return `${nameOf(position.block)}-${rowNumber(position.row)}`;
}

/** Two positions naming the same location on the ground. */
export function samePosition(a: Position, b: Position): boolean {
  return a.block === b.block && a.row === b.row;
}

/** A stable string key for map lookups. */
export function positionKey(position: Position): string {
  return `${String(position.block)}|${String(position.row)}`;
}
