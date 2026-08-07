import type { Position, Size, Tier } from './types';
import { GROUND_TIER } from './types';

/**
 * How a position is written and said. `40-C-07` names the ground slot; the
 * tier is carried in words (الأرضي / الأول) because the staff talk about
 * floors by name, not by digit.
 */

const ROW_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 1 → A, 2 → B … 27 → AA. Rows never carry digits, so an address splits unambiguously. */
export function rowLabel(row: number): string {
  let label = '';
  let n = row;
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = (ROW_LETTERS[rem] ?? 'A') + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export function tierName(tier: Tier): string {
  return tier === GROUND_TIER ? 'الأرضي' : 'الأول';
}

/** `40-C-07` — zone, row letter, zero-padded slot. */
export function slotLabel(position: Pick<Position, 'zone' | 'row' | 'col'>): string {
  return `${position.zone}-${rowLabel(position.row)}-${String(position.col).padStart(2, '0')}`;
}

/** The full spoken form: `40-C-07 (الأرضي)`. */
export function positionLabel(position: Position): string {
  return `${slotLabel(position)} (${tierName(position.tier)})`;
}

/** Two positions naming the same physical slot, ignoring tier. */
export function sameSlot(
  a: Pick<Position, 'zone' | 'row' | 'col'>,
  b: Pick<Position, 'zone' | 'row' | 'col'>,
): boolean {
  return a.zone === b.zone && a.row === b.row && a.col === b.col;
}

/** A stable string key for map lookups. */
export function slotKey(position: Pick<Position, 'zone' | 'row' | 'col'>): string {
  return `${position.zone}|${position.row}|${position.col}`;
}

export function positionKey(position: Position): string {
  return `${slotKey(position)}|${position.tier}`;
}

/** The zone a size belongs to — trivially itself, named so call sites read as policy. */
export function zoneForSize(size: Size): Size {
  return size;
}
