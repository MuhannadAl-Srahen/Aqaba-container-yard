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
  it('matches the printed totals exactly: Y1 = 571, Y2 = 110, TOTAL = 681', () => {
    const y1 = ASEZA.zones.filter((z) => z.yard === 1).reduce((s, z) => s + slotCount(z), 0);
    const y2 = ASEZA.zones.filter((z) => z.yard === 2).reduce((s, z) => s + slotCount(z), 0);
    expect(y1).toBe(571);
    expect(y2).toBe(110);
    expect(y1 + y2).toBe(681);
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
      { zone: 'A', yard: 1, bays: 27, lastBay: 53, slots: 242 },
      { zone: 'B', yard: 1, bays: 23, lastBay: 45, slots: 230 },
      { zone: 'C', yard: 1, bays: 6, lastBay: 11, slots: 54 },
      { zone: 'D', yard: 1, bays: 9, lastBay: 17, slots: 45 },
      { zone: 'E', yard: 2, bays: 14, lastBay: 27, slots: 110 },
    ]);
  });

  it('keeps the walls the plan clips — «الحيط ضيق» is in the data', () => {
    // Zone A: the first bays lose stacks 1–2 to the wall, the tail has all 10.
    expect(zone('A').stacks['1']).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(zone('A').stacks['11']).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(zone('A').stacks['53']).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Zone E's last bay is the clipped corner that makes Y2 exactly 110.
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
