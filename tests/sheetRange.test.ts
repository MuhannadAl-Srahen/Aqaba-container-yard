import { describe, expect, it } from 'vitest';
import { YARD_START, rangeInstants, sheetStart } from '../src/client/sheetKit';

/**
 * مدى الكشوف الافتراضي — «ما بدي يكون بداية كل شهر بدي من اول ما بلشنا اي
 * من تاريح 11/8 الى التاريخ الحالي». Every sheet opens on the whole book,
 * not on the current month, so nothing that happened before the first of
 * the month is hidden from the first glance.
 */
describe('the default range a sheet opens on', () => {
  it('starts on the yard’s own first day, 11/08/2026', () => {
    expect(YARD_START).toBe('2026-08-11');
    expect(sheetStart()).toBe(YARD_START);
  });

  it('reads the day whole, Amman midnight to Amman midnight', () => {
    const { fromIso, toIso } = rangeInstants(YARD_START, YARD_START);
    // 00:00 Amman is 21:00 UTC the day before; the range closes 24h later.
    expect(fromIso).toBe('2026-08-10T21:00:00.000Z');
    expect(toIso).toBe('2026-08-11T21:00:00.000Z');
  });
});
