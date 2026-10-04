import { describe, expect, it } from 'vitest';
import { ASEZA } from '../src/shared/asezaLayout';
import { ZONES } from '../src/shared/types';
import type { ZoneDef } from '../src/shared/types';

/**
 * The committed layout IS the official drawing — the authority's newer plan,
 * decoded by tools/decode-aseza-pdf.mjs. These tests pin it to the slots
 * counted on that drawing (the cyan figures printed on the sheet are not
 * used — the owner said to count the drawing): if the decoder ever drifts,
 * this fails before anything else does.
 */

const slotCount = (zone: ZoneDef): number =>
  zone.bays.reduce((sum, bay) => sum + (zone.stacks[String(bay)]?.length ?? 0), 0);

const zone = (name: string): ZoneDef => {
  const found = ASEZA.zones.find((z) => z.zone === name);
  if (found === undefined) throw new Error('zone missing: ' + name);
  return found;
};

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const oddBays = (from: number, to: number): number[] => range(from, to).filter((bay) => bay % 2 === 1);

describe('the official ASEZA layout', () => {
  it('is all one yard — SAHA 2 — of 1053 ground slots', () => {
    // Everything modelled is SAHA 2: the owner's yards 1 and 3 are elsewhere
    // and are not modelled, so nothing here may claim another number.
    expect(ASEZA.zones.every((z) => z.yard === 2)).toBe(true);
    expect(ASEZA.zones.reduce((sum, z) => sum + slotCount(z), 0)).toBe(1053);
  });

  it('carries the nine zones with the drawing’s own shapes', () => {
    const shapes = ASEZA.zones.map((z) => ({
      zone: z.zone,
      yard: z.yard,
      bays: z.bays.length,
      lastBay: z.bays[z.bays.length - 1],
      slots: slotCount(z),
    }));
    expect(shapes).toEqual([
      { zone: 'A', yard: 2, bays: 38, lastBay: 75, slots: 305 },
      { zone: 'B', yard: 2, bays: 38, lastBay: 75, slots: 376 },
      { zone: 'C', yard: 2, bays: 6, lastBay: 11, slots: 54 },
      { zone: 'D', yard: 2, bays: 10, lastBay: 19, slots: 50 },
      { zone: 'E', yard: 2, bays: 25, lastBay: 49, slots: 176 },
      { zone: 'F', yard: 2, bays: 8, lastBay: 15, slots: 48 },
      { zone: 'G', yard: 2, bays: 3, lastBay: 5, slots: 24 },
      { zone: 'H', yard: 2, bays: 2, lastBay: 3, slots: 14 },
      { zone: 'J', yard: 2, bays: 3, lastBay: 5, slots: 6 },
    ]);
    // The official letters are exactly the plan's — I skipped on purpose.
    expect(ASEZA.zones.map((z) => z.zone)).toEqual([...ZONES]);
  });

  it('keeps the walls the plan clips — «الحيط ضيق» is in the data', () => {
    // Zone A: the first bays lose stacks 1–2 to the wall, the tail has all 10.
    expect(zone('A').stacks['1']).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(zone('A').stacks['11']).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(zone('A').stacks['53']).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Zone E's bay 27 is the clipped corner of its first part.
    expect(zone('E').stacks['27']).toEqual([3, 4, 5, 6, 7, 8]);
    expect(zone('E').stacks['25']).toHaveLength(8);
  });

  it('continues A, B and E on the stack lines of their old bays', () => {
    // A runs on past bay 53 over stacks 6–10, then 5–10.
    for (const bay of oddBays(55, 59)) expect(zone('A').stacks[String(bay)]).toEqual(range(6, 10));
    for (const bay of oddBays(61, 75)) expect(zone('A').stacks[String(bay)]).toEqual(range(5, 10));
    // B keeps all ten stacks to bay 71; bays 73 and 75 lose stacks 1–2.
    for (const bay of oddBays(47, 71)) expect(zone('B').stacks[String(bay)]).toEqual(range(1, 10));
    expect(zone('B').stacks['73']).toEqual(range(3, 10));
    expect(zone('B').stacks['75']).toEqual(range(3, 10));
    // E runs on past bay 27 on the same six stacks, 3–8.
    for (const bay of oddBays(29, 49)) expect(zone('E').stacks[String(bay)]).toEqual(range(3, 8));
    // D's bay 19 is drawn in the old yellow and stands on all five stacks.
    expect(zone('D').stacks['19']).toEqual(range(1, 5));
  });

  it('draws the new blocks whole, stacks counted from 1', () => {
    const whole: ReadonlyArray<readonly [string, number]> = [['F', 6], ['G', 8], ['H', 7], ['J', 2]];
    for (const [name, stacks] of whole) {
      for (const bay of zone(name).bays) expect(zone(name).stacks[String(bay)]).toEqual(range(1, stacks));
    }
  });

  it('numbers every zone’s bays 01, 03, 05… without a gap', () => {
    for (const z of ASEZA.zones) {
      z.bays.forEach((bay, index) => {
        expect(bay).toBe(index * 2 + 1);
      });
    }
  });

  it('gives every bay its stacks, ascending', () => {
    for (const z of ASEZA.zones) {
      for (const bay of z.bays) {
        const stacks = z.stacks[String(bay)] ?? [];
        expect(stacks.length).toBeGreaterThan(0);
        stacks.forEach((stack, at) => {
          expect(stack).toBeGreaterThanOrEqual(1);
          if (at > 0) expect(stack).toBeGreaterThan(stacks[at - 1] ?? 0);
        });
      }
    }
  });
});
