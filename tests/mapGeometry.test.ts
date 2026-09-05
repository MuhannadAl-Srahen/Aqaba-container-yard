import { describe, expect, it } from 'vitest';
import {
  DETAIL_ZONE_H,
  MAP,
  bayWidths,
  computeLayout,
  detailLayout,
  laneGrid,
} from '../src/client/mapModel';
import { ASEZA } from '../src/shared/asezaLayout';
import type { ZoneDef } from '../src/shared/types';

/**
 * The map's geometry, held to its word without rendering anything: the fill
 * and bills paints draw the plan's own pitch untouched, and the contents
 * paint — «بلوكات العشرين مو كلهن متشابهات» / «في space تحت البلوكات
 * كبير» — gives every stack of the yard one lane of one width and cuts every
 * panel to hug its tiles.
 */

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const stacksOf = (zone: ZoneDef, bay: number): readonly number[] => zone.stacks[String(bay)] ?? [];

/** What one lane is worth on the map, in yard units: a twenty's square. */
const TWENTY = MAP.lane - MAP.laneGap;

describe('the ordinary paints keep the plan', () => {
  it('shares the panel evenly — the decoder drew every bay 58 wide', () => {
    for (const zone of ASEZA.zones) {
      const widths = bayWidths(zone, false);
      expect(widths).toHaveLength(zone.bays.length);
      for (const w of widths) expect(w).toBeCloseTo(58, 6);
    }
  });

  it('draws the canvas around the plan exactly as before', () => {
    const layout = computeLayout(ASEZA);
    expect(layout.width).toBe(2830 + MAP.outerPad * 2);
    expect(layout.height).toBe(660 + MAP.outerPad * 2);
    expect(layout.zones).toBe(ASEZA.zones);
    expect(layout.landmarks).toBe(ASEZA.landmarks);
  });
});

describe('the contents paint: one lane per stack, everywhere', () => {
  it('gives a lone bay exactly its stacks in lanes — a twenty is one width on every tile', () => {
    for (const zone of ASEZA.zones) {
      const widths = bayWidths(zone, true);
      zone.bays.forEach((bay, at) => {
        const stacks = stacksOf(zone, bay).length;
        const frameW = (widths[at] ?? 0) - MAP.cellGap;
        const grid = laneGrid(frameW, stacks, 1);
        expect(grid.pitch).toBeCloseTo(MAP.lane, 9);
        expect(grid.pitch - MAP.laneGap).toBeCloseTo(TWENTY, 9);
        expect(grid.start).toBeCloseTo(MAP.laneInset, 9);
        // The last lane ends inside the frame by the same inset.
        expect(grid.start + stacks * grid.pitch - MAP.laneGap).toBeCloseTo(frameW - MAP.laneInset, 9);
      });
    }
  });

  it('makes a ten-stack bay twice as wide as a five-stack one', () => {
    const b = ASEZA.zones.find((zone) => zone.zone === 'B');
    const d = ASEZA.zones.find((zone) => zone.zone === 'D');
    if (b === undefined || d === undefined) throw new Error('plan zones missing');
    expect(stacksOf(b, 1)).toHaveLength(10);
    expect(stacksOf(d, 1)).toHaveLength(5);
    const lanesB = (bayWidths(b, true)[0] ?? 0) - MAP.cellGap - MAP.laneInset * 2 + MAP.laneGap;
    const lanesD = (bayWidths(d, true)[0] ?? 0) - MAP.cellGap - MAP.laneInset * 2 + MAP.laneGap;
    expect(lanesB).toBe(10 * MAP.lane);
    expect(lanesD).toBe(5 * MAP.lane);
  });

  it('welds a pair on the same lanes: a twenty stays one width, a forty is exactly two', () => {
    for (const zone of ASEZA.zones) {
      const widths = bayWidths(zone, true);
      for (let at = 0; at + 1 < zone.bays.length; at += 1) {
        const left = zone.bays[at];
        const right = zone.bays[at + 1];
        if (left === undefined || right === undefined) throw new Error('unreachable');
        const union = new Set([...stacksOf(zone, left), ...stacksOf(zone, right)]);
        const frameW = (widths[at] ?? 0) + (widths[at + 1] ?? 0) - MAP.cellGap;
        const grid = laneGrid(frameW, union.size, 2);
        // Never wider than two lanes; exactly two where the bays agree.
        expect(grid.pitch).toBeLessThanOrEqual(MAP.lane * 2 + 1e-9);
        if (stacksOf(zone, left).length === stacksOf(zone, right).length) {
          expect(grid.pitch).toBeCloseTo(MAP.lane * 2, 9);
          expect(grid.pitch / 2 - MAP.laneGap).toBeCloseTo(TWENTY, 9);
        }
        // The grid stays inside the frame, centred in the room to spare.
        const gridW = union.size * grid.pitch - MAP.laneGap;
        expect(grid.start).toBeGreaterThanOrEqual(MAP.laneInset - 1e-9);
        expect(grid.start + gridW).toBeLessThanOrEqual(frameW - MAP.laneInset + 1e-9);
        expect(grid.start - MAP.laneInset).toBeCloseTo(frameW - MAP.laneInset - (grid.start + gridW), 9);
      }
    }
  });

  it('squeezes only a pair whose bays disagree about their ground, and keeps it framed', () => {
    const odd: ZoneDef = {
      zone: 'Q',
      yard: 2,
      x: 0, y: 0, w: 118, h: 150,
      bays: [1, 3],
      stacks: { '1': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '3': [1, 2, 3] },
    };
    const widths = bayWidths(odd, true);
    const frameW = (widths[0] ?? 0) + (widths[1] ?? 0) - MAP.cellGap;
    const grid = laneGrid(frameW, 10, 2);
    expect(grid.pitch).toBeLessThan(MAP.lane * 2);
    expect(grid.start).toBeGreaterThanOrEqual(MAP.laneInset - 1e-9);
    expect(grid.start + 10 * grid.pitch - MAP.laneGap).toBeLessThanOrEqual(frameW - MAP.laneInset + 1e-9);
  });

  it('still draws a column for a bay whose every stack is closed', () => {
    const shut: ZoneDef = {
      zone: 'Q',
      yard: 2,
      x: 0, y: 0, w: 59, h: 150,
      bays: [1],
      stacks: { '1': [] },
    };
    expect(bayWidths(shut, true)[0]).toBeGreaterThanOrEqual(MAP.lane);
  });
});

describe('the contents paint: the panel hugs its tiles', () => {
  const layout = detailLayout(ASEZA);

  it('leaves the padding and nothing more under the blocks', () => {
    expect(DETAIL_ZONE_H).toBe(MAP.titleH + MAP.detailCellH + MAP.pad);
    for (const zone of layout.zones) {
      expect(zone.h).toBe(DETAIL_ZONE_H);
      expect(zone.h - MAP.titleH - MAP.detailCellH).toBe(MAP.pad);
    }
  });

  it('makes every zone exactly as wide as its lanes, keeping its ground', () => {
    layout.zones.forEach((zone, at) => {
      const source = ASEZA.zones[at];
      if (source === undefined) throw new Error('unreachable');
      expect(zone.zone).toBe(source.zone);
      expect(zone.bays).toBe(source.bays);
      expect(zone.stacks).toBe(source.stacks);
      const lanes = bayWidths(source, true).reduce((sum, w) => sum + w, 0);
      expect(zone.w).toBeCloseTo(MAP.pad * 2 + lanes, 9);
    });
  });

  it('overlaps nothing — zones and landmarks keep their places beside each other', () => {
    const rects: Rect[] = [...layout.zones, ...layout.landmarks];
    const plain: Rect[] = [...ASEZA.zones, ...ASEZA.landmarks];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        const pa = plain[i];
        const pb = plain[j];
        if (a === undefined || b === undefined || pa === undefined || pb === undefined) throw new Error('unreachable');
        expect(overlaps(pa, pb)).toBe(false);
        expect(overlaps(a, b)).toBe(false);
      }
    }
  });

  it('keeps the strips in the plan order, each below the last', () => {
    const byName = new Map(layout.zones.map((zone) => [zone.zone, zone]));
    const order = ['A', 'B', 'C', 'D'];
    for (let i = 0; i + 1 < order.length; i += 1) {
      const upper = byName.get(order[i] ?? '');
      const lower = byName.get(order[i + 1] ?? '');
      if (upper === undefined || lower === undefined) throw new Error('plan zones missing');
      expect(lower.y).toBeGreaterThanOrEqual(upper.y + upper.h);
    }
  });

  it('draws the canvas around everything it moved', () => {
    for (const rect of [...layout.zones, ...layout.landmarks]) {
      expect(rect.x + rect.w + MAP.outerPad).toBeLessThanOrEqual(layout.width + 1e-9);
      expect(rect.y + rect.h + MAP.outerPad).toBeLessThanOrEqual(layout.height + 1e-9);
    }
  });
});
