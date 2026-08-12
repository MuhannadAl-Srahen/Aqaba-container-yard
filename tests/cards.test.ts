import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { cardNumberTaken, nextCardNumber } from '../src/server/store';
import { cardSerial } from '../src/shared/types';
import { ammanYear } from '../src/shared/dates';

/**
 * The gate cards are numbered per year, four places, starting again at 1 every
 * January. The serial is READ FROM THE RECORDS rather than from a counter kept
 * beside them, which is what keeps the register free of holes: a mistake
 * struck out at once hands its number straight back.
 */

/** A container carrying an entry card of that year. */
function issued(db: DatabaseSync, number: string, year: number, deleted = false): number {
  const serial = nextCardNumber(db, 'in', year);
  db.prepare(
    `INSERT INTO containers (number, number_valid, size, entered_at, zone, bay, stack, tier,
                             card_in, card_in_year, deleted_at)
     VALUES (?, 1, 20, ?, 'B', 3, 1, 'A', ?, ?, ?)`,
  ).run(number, `${String(year)}-06-01T09:00:00.000Z`, serial, year, deleted ? 'x' : null);
  return serial;
}

describe('the gate card serial', () => {
  it('runs up within a year and starts again at 1 in the next', () => {
    const db = openDatabase(':memory:');
    expect(issued(db, 'AAAA0001', 2026)).toBe(1);
    expect(issued(db, 'AAAA0002', 2026)).toBe(2);
    expect(issued(db, 'AAAA0003', 2026)).toBe(3);
    // January.
    expect(issued(db, 'BBBB0001', 2027)).toBe(1);
    expect(issued(db, 'BBBB0002', 2027)).toBe(2);
    // And the old year carries on from where it was.
    expect(issued(db, 'AAAA0004', 2026)).toBe(4);
    db.close();
  });

  it('counts entries and exits on separate ledgers', () => {
    const db = openDatabase(':memory:');
    expect(issued(db, 'AAAA0001', 2026)).toBe(1);
    expect(issued(db, 'AAAA0002', 2026)).toBe(2);
    expect(nextCardNumber(db, 'out', 2026)).toBe(1);
    db.close();
  });

  /**
   * The whole reason the counter left the settings table: «في حال حذف الحاوية
   * او سجل خطأ يجب ان لا يتم القفز عن الرقم التسلسلي».
   */
  it('gives a struck-out record’s number straight back to the next one', () => {
    const db = openDatabase(':memory:');
    issued(db, 'AAAA0001', 2026);
    issued(db, 'AAAA0002', 2026);
    // The third was a mistake and is struck out the moment it is noticed.
    expect(issued(db, 'AAAA0003', 2026, true)).toBe(3);
    // The next real one takes 3, not 4: no hole in the register.
    expect(issued(db, 'AAAA0004', 2026)).toBe(3);
    db.close();
  });

  it('knows when a returning record’s number has been handed on', () => {
    const db = openDatabase(':memory:');
    issued(db, 'AAAA0001', 2026);
    issued(db, 'AAAA0002', 2026, true); // struck out, held serial 2
    issued(db, 'AAAA0003', 2026); // took serial 2 in its place
    // Bringing the struck-out one back would put two cards on one number.
    expect(cardNumberTaken(db, 'in', 2026, 2, 2)).toBe(true);
    expect(cardNumberTaken(db, 'in', 2026, 9, 2)).toBe(false);
    db.close();
  });

  it('writes four places, then the year', () => {
    expect(cardSerial(1, 2026)).toBe('0001/2026');
    expect(cardSerial(91, 2026)).toBe('0091/2026');
    expect(cardSerial(9999, 2026)).toBe('9999/2026');
    // A card from before the years were recorded still reads as a number.
    expect(cardSerial(7, null)).toBe('0007');
    // And no card at all is no text at all — the caller prints its own dash.
    expect(cardSerial(null, 2026)).toBeNull();
  });

  it('takes the year from the Amman clock, not from UTC', () => {
    // 23:30 UTC on the last night of the year is already the new year here,
    // and the card issued at that moment belongs to the new year's count.
    expect(ammanYear('2026-12-31T23:30:00.000Z')).toBe(2027);
    expect(ammanYear('2026-12-31T20:30:00.000Z')).toBe(2026);
  });
});
