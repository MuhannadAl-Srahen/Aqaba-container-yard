import { describe, expect, it } from 'vitest';
import type { BlockConfig } from '../src/shared/types';
import {
  blockCorners,
  blockFrame,
  blocksOverlap,
  defaultLayout,
  overlappingPairs,
  yardBounds,
} from '../src/shared/geometry';

const block = (patch: Partial<BlockConfig>): BlockConfig => ({
  id: 1,
  name: 'A',
  size: 20,
  rows: 2,
  placesPerTier: 4,
  tiers: 2,
  x: 0,
  y: 0,
  angle: 0,
  ...patch,
});

describe('frames', () => {
  it('a column grows only downwards: every location is the same box', () => {
    const one = blockFrame({ rows: 1 });
    const two = blockFrame({ rows: 2 });
    const ten = blockFrame({ rows: 10 });
    expect(two.height).toBeGreaterThan(one.height);
    expect(ten.height).toBeGreaterThan(two.height);
    // A location is two lanes wide and forty feet deep whatever it holds, so
    // the panel's width never depends on the column's size or capacity.
    expect(two.width).toBe(one.width);
    expect(ten.width).toBe(one.width);
  });

  it('an unrotated block has axis-aligned corners at its frame', () => {
    const b = block({ x: 10, y: 20 });
    const frame = blockFrame(b);
    const corners = blockCorners(b);
    expect(corners[0]).toEqual({ x: 10, y: 20 });
    expect(corners[2]?.x).toBeCloseTo(10 + frame.width);
    expect(corners[2]?.y).toBeCloseTo(20 + frame.height);
  });

  it('rotation happens around the centre: the centre never moves', () => {
    const b = block({ x: 100, y: 100 });
    const frame = blockFrame(b);
    const turned = { ...b, angle: 45 };
    const center = { x: 100 + frame.width / 2, y: 100 + frame.height / 2 };
    const average = blockCorners(turned).reduce(
      (sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4 }),
      { x: 0, y: 0 },
    );
    expect(average.x).toBeCloseTo(center.x);
    expect(average.y).toBeCloseTo(center.y);
  });
});

describe('overlap', () => {
  it('separated blocks do not overlap; stacked ones do', () => {
    const a = block({ id: 1 });
    const frame = blockFrame(a);
    const apart = block({ id: 2, x: frame.width + 10 });
    const onTop = block({ id: 2, x: 20, y: 10 });
    expect(blocksOverlap(a, apart)).toBe(false);
    expect(blocksOverlap(a, onTop)).toBe(true);
  });

  it('rotation is honoured: a turned block clears a corner a box would hit', () => {
    // Diagonal neighbour: their bounding BOXES share the corner area, but at
    // 45° the actual rectangle pulls its corner out of the way.
    const a = block({ id: 1, rows: 1 });
    const frame = blockFrame(a);
    const diagonal = block({
      id: 2,
      rows: 1,
      x: frame.width - 12,
      y: frame.height - 12,
      angle: 0,
    });
    expect(blocksOverlap(a, diagonal)).toBe(true);
    const turned = { ...diagonal, angle: 45 };
    expect(blocksOverlap(a, turned)).toBe(false);
  });

  it('lists every colliding pair once', () => {
    const a = block({ id: 1 });
    const b = block({ id: 2, x: 5, y: 5 });
    const far = block({ id: 3, x: 2000 });
    const pairs = overlappingPairs([a, b, far]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.map((p) => p.id)).toEqual([1, 2]);
  });
});

describe('bounds and the first-run layout', () => {
  it('bounds box every rotated corner', () => {
    const b = block({ x: 0, y: 0, angle: 45 });
    const bounds = yardBounds([b]);
    const corners = blockCorners(b);
    for (const corner of corners) {
      expect(corner.x).toBeGreaterThanOrEqual(bounds.minX - 1e-9);
      expect(corner.x).toBeLessThanOrEqual(bounds.maxX + 1e-9);
      expect(corner.y).toBeGreaterThanOrEqual(bounds.minY - 1e-9);
      expect(corner.y).toBeLessThanOrEqual(bounds.maxY + 1e-9);
    }
  });

  it('the default layout never overlaps and names the columns A and B', () => {
    const layout = defaultLayout(
      { rows: 15, placesPerTier: 4, tiers: 2 },
      { rows: 10, placesPerTier: 4, tiers: 2 },
    );
    expect(overlappingPairs(layout)).toHaveLength(0);
    const [twenty, forty] = layout;
    expect([twenty?.name, forty?.name]).toEqual(['A', 'B']);
    expect(twenty?.size).toBe(20);
    expect(forty?.size).toBe(40);
    // Two columns stand side by side, not one under the other.
    expect(twenty?.y).toBe(forty?.y);
    expect((twenty?.x ?? 0) < (forty?.x ?? 0)).toBe(true);
  });
});
