import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { nextCardNumber, renumberCards, renumberPlan } from '../src/server/store';
import { cardSerial } from '../src/shared/types';
import { ammanYear } from '../src/shared/dates';

/**
 * The gate cards are numbered per year, four places, starting again at 1 every
 * January. The serial is READ FROM THE RECORDS rather than from a counter kept
 * beside them, which is what keeps the register free of holes: a mistake
 * struck out at once hands its number straight back.
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

  /**
   * Giving the number back only works when the record struck out was the LAST
   * one. Strike out one from the middle — which is what happened on the office
   * machine — and the register keeps a hole nothing fills. So the year is
   * counted through again: «صار خطأ ب التسلسل … بسبب الحذف».
   */
  it('closes the hole a struck-out record leaves in the middle of the year', () => {
    const db = openDatabase(':memory:');
    for (let day = 1; day <= 5; day += 1) {
      issued(db, `AAAA000${String(day)}`, 2026, false, day);
    }
    expect(ledger(db, 2026)).toEqual([1, 2, 3, 4, 5]);

    strike(db, 2026, 3);
    expect(ledger(db, 2026)).toEqual([1, 2, 4, 5]); // the hole, before the repair
    expect(renumberCards(db)).toBe(2); // the two cards standing after it move
    expect(ledger(db, 2026)).toEqual([1, 2, 3, 4]);

    // And the next one issued carries on from the end rather than repeating.
    expect(issued(db, 'AAAA0009', 2026, false, 9)).toBe(5);
    db.close();
  });

  it('plans nothing for a register that is already whole', () => {
    const db = openDatabase(':memory:');
    issued(db, 'AAAA0001', 2026, false, 1);
    issued(db, 'AAAA0002', 2026, false, 2);
    expect(renumberPlan(db)).toEqual([]);
    // Twice over is the same answer — it is a rule, not a one-time script.
    expect(renumberCards(db)).toBe(0);
    expect(renumberCards(db)).toBe(0);
    db.close();
  });

  it('counts each year through on its own, and leaves struck-out records alone', () => {
    const db = openDatabase(':memory:');
    issued(db, 'AAAA0001', 2026, false, 1);
    issued(db, 'AAAA0002', 2026, true, 2); // struck out, holding serial 2
    issued(db, 'AAAA0003', 2026, false, 3);
    issued(db, 'BBBB0001', 2027, false, 1);
    issued(db, 'BBBB0002', 2027, false, 2);

    renumberCards(db);
    expect(ledger(db, 2026)).toEqual([1, 2]);
    expect(ledger(db, 2027)).toEqual([1, 2]); // the next year is untouched by it

    // The struck-out record keeps the number it was issued: the log is a
    // record of what happened, and its old card is not reprinted.
    const struck = db
      .prepare("SELECT card_in AS serial FROM containers WHERE deleted_at IS NOT NULL")
      .get() as { serial: number };
    expect(struck.serial).toBe(2);
    db.close();
  });

  it('seats a card by its gate date, so a corrected date re-seats it', () => {
    const db = openDatabase(':memory:');
    issued(db, 'AAAA0001', 2026, false, 10);
    issued(db, 'AAAA0002', 2026, false, 20);
    // The gate typed the wrong day and the office corrects it: this one came
    // in FIRST. The register is a chronological document, so it takes 1.
    db.prepare("UPDATE containers SET entered_at = '2026-06-05T09:00:00.000Z' WHERE card_in = 2")
      .run();
    expect(renumberCards(db)).toBe(2);
    const seats = db
      .prepare('SELECT number, card_in AS serial FROM containers ORDER BY card_in')
      .all() as Array<{ number: string; serial: number }>;
    expect(seats).toEqual([
      { number: 'AAAA0002', serial: 1 },
      { number: 'AAAA0001', serial: 2 },
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
