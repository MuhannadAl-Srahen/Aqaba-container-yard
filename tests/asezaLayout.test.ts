import { describe, expect, it } from 'vitest';
import { ASEZA } from '../src/shared/asezaLayout';
import type { ZoneDef } from '../src/shared/types';

/**
 * The committed layout IS the official drawing. These tests pin it to the
 * totals printed on the authority's own sheet — if the decoder ever drifts,
 * this fails before anything else does.
 */

const slotCount = (zone: ZoneDef): number =>
  zone.bays.reduce((sum, bay) => sum + (zone.stacks[String(bay)]?.length ?? 0), 0);

const zone = (name: string): ZoneDef => {
  const found = ASEZA.zones.find((z) => z.zone === name);
  if (found === undefined) throw new Error('zone missing: ' + name);
  return found;
};

describe('the official ASEZA layout', () => {
  it('is all one yard — SAHA 2 — of 681 ground slots', () => {
    // The printed sheet's 571 and 110 are two PARTS of this ground, not two
    // yards: A+B+C+D and E. The owner's yards 1 and 3 are elsewhere and are
    // not modelled, so nothing here may claim another number.
    expect(ASEZA.zones.every((z) => z.yard === 2)).toBe(true);
    const abcd = ASEZA.zones
      .filter((z) => z.zone !== 'E')
      .reduce((sum, z) => sum + slotCount(z), 0);
    expect(abcd).toBe(571);
    expect(slotCount(zone('E'))).toBe(110);
    expect(ASEZA.zones.reduce((sum, z) => sum + slotCount(z), 0)).toBe(681);
  });

  it('carries the five zones with the drawing’s own shapes', () => {
    const shapes = ASEZA.zones.map((z) => ({
      zone: z.zone,
      yard: z.yard,
      bays: z.bays.length,
      lastBay: z.bays[z.bays.length - 1],
      slots: slotCount(z),
    }));
    expect(shapes).toEqual([
      { zone: 'A', yard: 2, bays: 27, lastBay: 53, slots: 242 },
      { zone: 'B', yard: 2, bays: 23, lastBay: 45, slots: 230 },
      { zone: 'C', yard: 2, bays: 6, lastBay: 11, slots: 54 },
      { zone: 'D', yard: 2, bays: 9, lastBay: 17, slots: 45 },
      { zone: 'E', yard: 2, bays: 14, lastBay: 27, slots: 110 },
    ]);
  });

  it('keeps the walls the plan clips — «الحيط ضيق» is in the data', () => {
    // Zone A: the first bays lose stacks 1–2 to the wall, the tail has all 10.
    expect(zone('A').stacks['1']).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(zone('A').stacks['11']).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(zone('A').stacks['53']).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Zone E's last bay is the clipped corner that makes its part exactly 110.
    expect(zone('E').stacks['27']).toHaveLength(6);
    expect(zone('E').stacks['25']).toHaveLength(8);
  });

  it('numbers every zone’s bays 01, 03, 05… without a gap', () => {
    for (const z of ASEZA.zones) {
      z.bays.forEach((bay, index) => {
        expect(bay).toBe(index * 2 + 1);
      });
    }
  });
});
