import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/server/db';
import { nextCardNumber } from '../src/server/store';
import { cardSerial } from '../src/shared/types';
import { ammanYear } from '../src/shared/dates';

/**
 * The gate cards are numbered per year and start again at 1 every January, on
 * the owner's call. Four places is the room the card and the registers leave
 * for the serial; the year rides beside it, because «0091» of 2026 and «0091»
 * of 2027 are two different cards.
 */

describe('the gate card serial', () => {
  it('runs up within a year and starts again at 1 in the next', () => {
    const db = openDatabase(':memory:');
    expect(nextCardNumber(db, 'in', 2026)).toBe(1);
    expect(nextCardNumber(db, 'in', 2026)).toBe(2);
    expect(nextCardNumber(db, 'in', 2026)).toBe(3);
    // January.
    expect(nextCardNumber(db, 'in', 2027)).toBe(1);
    expect(nextCardNumber(db, 'in', 2027)).toBe(2);
    // And the old year is untouched, should a late correction need it.
    expect(nextCardNumber(db, 'in', 2026)).toBe(4);
    db.close();
  });

  it('counts entries and exits on separate ledgers', () => {
    const db = openDatabase(':memory:');
    expect(nextCardNumber(db, 'in', 2026)).toBe(1);
    expect(nextCardNumber(db, 'in', 2026)).toBe(2);
    expect(nextCardNumber(db, 'out', 2026)).toBe(1);
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
