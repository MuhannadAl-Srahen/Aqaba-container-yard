import { describe, expect, it } from 'vitest';
import { ammanDay, daysBetween, fromLocalStamp, toLocalStamp } from '../src/shared/dates';

/**
 * A yard bills by the calendar, not by the stopwatch. These are the cases the
 * old `Math.floor(elapsed / 86_400_000)` got wrong.
 */

describe('the Amman calendar', () => {
  it('names the day the yard was working, not the UTC one', () => {
    // 22:30 UTC is already tomorrow in Amman (UTC+3).
    expect(ammanDay('2026-08-09T22:30:00.000Z')).toBe('2026-08-10');
    expect(ammanDay('2026-08-09T20:59:00.000Z')).toBe('2026-08-09');
    expect(ammanDay('2026-08-09T21:00:00.000Z')).toBe('2026-08-10');
  });
});

describe('dwell in days', () => {
  it('an hour across midnight is a day, not zero', () => {
    // In at 23:30 Amman, out at 00:30 Amman the next morning: one hour on the
    // stopwatch, one day on the register — and the register is what bills.
    expect(daysBetween('2026-08-09T20:30:00.000Z', '2026-08-09T21:30:00.000Z')).toBe(1);
  });

  it('a long same-day visit is still zero days', () => {
    expect(daysBetween('2026-08-09T05:00:00.000Z', '2026-08-09T17:00:00.000Z')).toBe(0);
  });

  it('counts whole calendar days across a month boundary', () => {
    expect(daysBetween('2026-07-30T09:00:00.000Z', '2026-08-02T09:00:00.000Z')).toBe(3);
    expect(daysBetween('2026-01-01T09:00:00.000Z', '2026-12-31T09:00:00.000Z')).toBe(364);
  });

  it('never runs backwards', () => {
    expect(daysBetween('2026-08-09T09:00:00.000Z', '2026-08-01T09:00:00.000Z')).toBe(0);
  });
});

/**
 * Correcting a gate date means typing a wall clock, and the wall clock in
 * this office is Amman's. An hour lost in the conversion would silently move
 * a container to the previous day of the register.
 */
describe('the Amman wall clock, both ways', () => {
  it('shows an instant as the local clock the yard reads', () => {
    expect(toLocalStamp('2026-08-09T20:30:00.000Z')).toBe('2026-08-09T23:30');
    // Past 21:00 UTC the office clock is already tomorrow.
    expect(toLocalStamp('2026-08-09T21:15:00.000Z')).toBe('2026-08-10T00:15');
  });

  it('turns a typed local clock back into the same instant', () => {
    expect(fromLocalStamp('2026-08-09T23:30')).toBe('2026-08-09T20:30:00.000Z');
    expect(fromLocalStamp('2026-08-10T00:15')).toBe('2026-08-09T21:15:00.000Z');
  });

  it('round-trips every hour of a day without drifting', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const stamp = `2026-03-15T${String(hour).padStart(2, '0')}:45`;
      const iso = fromLocalStamp(stamp);
      expect(iso).not.toBeNull();
      expect(toLocalStamp(iso ?? '')).toBe(stamp);
    }
  });

  it('refuses a stamp that is not a date at all', () => {
    expect(fromLocalStamp('')).toBeNull();
    expect(fromLocalStamp('not-a-date')).toBeNull();
  });
});
