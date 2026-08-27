import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { nextCardNumber } from '../src/server/store';
import { cardSerial } from '../src/shared/types';
import { ammanYear } from '../src/shared/dates';

/**
 * The gate cards are numbered per year, four places, starting again at 1 every
 * January. The serial is READ FROM THE RECORDS rather than from a counter kept
 * beside them — and it is read over ALL of them, struck out or not.
 *
 * A SERIAL IS NEVER ISSUED TWICE. The owner reversed his earlier rule, which
 * had been to close the hole a deletion left: «في حال تم حذف حاوية من السجل
 * كامل ما بدي حدا يوخذ مكانها خلص يضل يكمل … لو كان عندي 1 2 3 وحذفت 3، الي
 * بدي اجي اضيفها خلص لازم تيجي 4، مو توخذ محل ال 3».
 *
 * The reversal is the better trade and the old rule's own cost is why: closing
 * a hole moved the numbers of records that had nothing to do with the mistake,
 * so a card already printed and handed to a driver stopped matching the
 * register it came from. A hole is visible and harmless; a number that changes
 * hands is neither.
 */

/** A container carrying an entry card of that year, entered on `day` of June. */
function issued(
  db: DatabaseSync,
  number: string,
  year: number,
  deleted = false,
  day = 1,
): number {
  const serial = nextCardNumber(db, 'in', year);
  db.prepare(
    `INSERT INTO containers (number, number_valid, size, entered_at, zone, bay, stack, tier,
                             card_in, card_in_year, deleted_at)
     VALUES (?, 1, 20, ?, 'B', 3, 1, 'A', ?, ?, ?)`,
  ).run(
    number,
    `${String(year)}-06-${String(day).padStart(2, '0')}T09:00:00.000Z`,
    serial,
    year,
    deleted ? 'x' : null,
  );
  return serial;
}

/** The live entry serials of a year, in the order the register reads them. */
function ledger(db: DatabaseSync, year: number): number[] {
  return (
    db
      .prepare(
        `SELECT card_in AS serial FROM containers
          WHERE card_in_year = ? AND deleted_at IS NULL ORDER BY entered_at, id`,
      )
      .all(year) as Array<{ serial: number }>
  ).map((row) => row.serial);
}

/** Strike a record out the way the delete route does, by its serial. */
function strike(db: DatabaseSync, year: number, serial: number): void {
  db.prepare(
    `UPDATE containers SET deleted_at = 'x' WHERE card_in_year = ? AND card_in = ?`,
  ).run(year, serial);
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

  /** The owner's worked example, exactly as he wrote it. */
  it('never gives a struck-out record’s number to anybody else', () => {
    const db = openDatabase(':memory:');
    issued(db, 'AAAA0001', 2026);
    issued(db, 'AAAA0002', 2026);
    // The third was a mistake and is struck out the moment it is noticed.
    expect(issued(db, 'AAAA0003', 2026, true)).toBe(3);
    // «الي بدي اجي اضيفها خلص لازم تيجي 4، مو توخذ محل ال 3».
    expect(issued(db, 'AAAA0004', 2026)).toBe(4);
    // And the hole stays a hole: the register reads 1, 2, 4.
    expect(ledger(db, 2026)).toEqual([1, 2, 4]);
    db.close();
  });

  /**
   * A record struck out of the MIDDLE leaves a hole, and the hole stays. The
   * four cards standing around it keep the numbers they were printed with —
   * which is the whole point, since three of them are already on paper
   * somewhere.
   */
  it('leaves the hole where a middle record was, and moves nobody', () => {
    const db = openDatabase(':memory:');
    for (let day = 1; day <= 5; day += 1) {
      issued(db, `AAAA000${String(day)}`, 2026, false, day);
    }
    expect(ledger(db, 2026)).toEqual([1, 2, 3, 4, 5]);

    strike(db, 2026, 3);
    expect(ledger(db, 2026)).toEqual([1, 2, 4, 5]);

    // The next one carries on past the top; 3 belongs to nobody for ever.
    expect(issued(db, 'AAAA0009', 2026, false, 9)).toBe(6);
    expect(ledger(db, 2026)).toEqual([1, 2, 4, 5, 6]);
    db.close();
  });

  it('counts each year through on its own, and leaves struck-out records alone', () => {
    const db = openDatabase(':memory:');
    issued(db, 'AAAA0001', 2026, false, 1);
    issued(db, 'AAAA0002', 2026, true, 2); // struck out, holding serial 2
    issued(db, 'AAAA0003', 2026, false, 3);
    issued(db, 'BBBB0001', 2027, false, 1);
    issued(db, 'BBBB0002', 2027, false, 2);

    // 2026 reads 1 and 3 — the hole at 2 is the struck-out record's, kept.
    expect(ledger(db, 2026)).toEqual([1, 3]);
    expect(ledger(db, 2027)).toEqual([1, 2]); // the next year is its own book

    // The struck-out record keeps the number it was issued: the log is a
    // record of what happened, and its old card is not reprinted.
    const struck = db
      .prepare("SELECT card_in AS serial FROM containers WHERE deleted_at IS NOT NULL")
      .get() as { serial: number };
    expect(struck.serial).toBe(2);
    db.close();
  });

  /**
   * A serial is the order the PAPER was issued in, not the order the yard was
   * entered in. Correcting a gate date afterwards leaves it exactly where it
   * is — the card it names is already printed and gone from the office.
   */
  it('a corrected gate date does not re-seat the card', () => {
    const db = openDatabase(':memory:');
    issued(db, 'AAAA0001', 2026, false, 10);
    issued(db, 'AAAA0002', 2026, false, 20);
    db.prepare("UPDATE containers SET entered_at = '2026-06-05T09:00:00.000Z' WHERE card_in = 2")
      .run();
    const seats = db
      .prepare('SELECT number, card_in AS serial FROM containers ORDER BY card_in')
      .all() as Array<{ number: string; serial: number }>;
    expect(seats).toEqual([
      { number: 'AAAA0001', serial: 1 },
      { number: 'AAAA0002', serial: 2 },
    ]);
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
