import { describe, expect, it } from 'vitest';
import { ammanDay, daysBetween } from '../src/shared/dates';

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
