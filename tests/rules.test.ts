import { describe, expect, it } from 'vitest';
import type { Standing } from '../src/shared/rules';
import {
  buildUsage,
  canPlace,
  locationCapacity,
  overfilledByLayout,
  placesFor,
  strandedByLayout,
  usedPlaces,
} from '../src/shared/rules';
import type { Position, Size, YardConfig } from '../src/shared/types';

const B20 = 1;
const B40 = 2;
const MIX = 9;

/**
 * Three columns, all with locations of four twenty-foot places over two
 * tiers — eight places each: eight 20s, or four 40s, or any mix that adds up.
 */
const yard: YardConfig = {
  blocks: [
    { id: B20, name: 'A', size: 20, rows: 3, placesPerTier: 4, tiers: 2, x: 0, y: 0, angle: 0 },
    { id: B40, name: 'B', size: 40, rows: 2, placesPerTier: 4, tiers: 2, x: 300, y: 0, angle: 0 },
    { id: MIX, name: 'R', size: 0, rows: 2, placesPerTier: 4, tiers: 2, x: 600, y: 0, angle: 0 },
  ],
};

const at = (block: number, row: number): Position => ({ block, row });

let nextId = 1;
const standing = (...list: Array<[pos: Position, size?: Size, number?: string]>): Standing[] =>
  list.map(([position, size, number]) => ({
    id: nextId++,
    number: number ?? `BOX${String(nextId)}`,
    size: size ?? 20,
    position,
  }));

/** Fill a location with `count` containers of one size. */
const fill = (position: Position, count: number, size: Size): Standing[] =>
  standing(...Array.from({ length: count }, () => [position, size] as [Position, Size]));

describe('capacity', () => {
  it('a 40 claims two places, a 20 one', () => {
    expect(placesFor(20)).toBe(1);
    expect(placesFor(40)).toBe(2);
  });

  it('a location holds its places per tier, times its tiers', () => {
    expect(locationCapacity({ placesPerTier: 4, tiers: 2 })).toBe(8);
    expect(locationCapacity({ placesPerTier: 4, tiers: 1 })).toBe(4);
    expect(locationCapacity({ placesPerTier: 6, tiers: 3 })).toBe(18);
  });

  it('counts only what stands in the location asked about', () => {
    const s = [...fill(at(B20, 1), 2, 20), ...fill(at(B20, 2), 1, 20)];
    expect(usedPlaces(s, at(B20, 1))).toBe(2);
    expect(usedPlaces(s, at(B20, 2))).toBe(1);
    expect(usedPlaces(s, at(B20, 3))).toBe(0);
  });
});

describe('placement', () => {
  it('accepts an empty location in a column of the right size', () => {
    expect(canPlace(yard, [], 20, at(B20, 1))).toBeNull();
    expect(canPlace(yard, [], 40, at(B40, 2))).toBeNull();
  });

  it('refuses a location past the end of the column', () => {
    expect(canPlace(yard, [], 20, at(B20, 4))?.code).toBe('OUT_OF_BOUNDS');
    expect(canPlace(yard, [], 20, at(B20, 0))?.code).toBe('OUT_OF_BOUNDS');
    expect(canPlace(yard, [], 40, at(B40, 3))?.code).toBe('OUT_OF_BOUNDS');
    expect(canPlace(yard, [], 20, at(99, 1))?.code).toBe('OUT_OF_BOUNDS');
  });

  it('keeps each size in its own column', () => {
    expect(canPlace(yard, [], 20, at(B40, 1))?.code).toBe('WRONG_ZONE');
    expect(canPlace(yard, [], 40, at(B20, 1))?.code).toBe('WRONG_ZONE');
  });

  it('a mixed column takes both sizes', () => {
    expect(canPlace(yard, [], 20, at(MIX, 1))).toBeNull();
    expect(canPlace(yard, [], 40, at(MIX, 1))).toBeNull();
  });

  it('eight 20s fill a location of eight places; the ninth is refused', () => {
    const s = fill(at(B20, 1), 8, 20);
    const refusal = canPlace(yard, s, 20, at(B20, 1));
    expect(refusal?.code).toBe('LOCATION_FULL');
    expect(refusal !== null && 'free' in refusal ? refusal.free : -1).toBe(0);
    // Its neighbours are untouched.
    expect(canPlace(yard, s, 20, at(B20, 2))).toBeNull();
  });

  it('four 40s fill the same location, because each takes two places', () => {
    const s = fill(at(B40, 1), 4, 40);
    expect(canPlace(yard, s, 40, at(B40, 1))?.code).toBe('LOCATION_FULL');
    expect(canPlace(yard, fill(at(B40, 1), 3, 40), 40, at(B40, 1))).toBeNull();
  });

  it('a mixed location adds the sizes up: 3×40 + 2×20 is exactly full', () => {
    const three40s = fill(at(MIX, 1), 3, 40);
    expect(canPlace(yard, three40s, 20, at(MIX, 1))).toBeNull();
    const plusTwo20s = [...three40s, ...fill(at(MIX, 1), 2, 20)];
    expect(canPlace(yard, plusTwo20s, 20, at(MIX, 1))?.code).toBe('LOCATION_FULL');
  });

  it('one free place takes a 20 but refuses a 40, and says how short it is', () => {
    const s = fill(at(MIX, 1), 7, 20);
    expect(canPlace(yard, s, 20, at(MIX, 1))).toBeNull();
    const refusal = canPlace(yard, s, 40, at(MIX, 1));
    expect(refusal?.code).toBe('LOCATION_FULL');
    expect(refusal !== null && 'free' in refusal ? [refusal.free, refusal.need] : []).toEqual([1, 2]);
  });

  it('a moving container does not take up room against itself', () => {
    const s = fill(at(B20, 1), 8, 20);
    const self = s[0];
    if (self === undefined) throw new Error('fixture');
    // Its own place comes free the moment it lifts, so the same location fits.
    expect(canPlace(yard, s, 20, at(B20, 1), self.id)).toBeNull();
    // ...but only its own place: a 40 would still need two.
    const mixed = fill(at(MIX, 1), 4, 40);
    const first40 = mixed[0];
    if (first40 === undefined) throw new Error('fixture');
    expect(canPlace(yard, mixed, 40, at(MIX, 1), first40.id)).toBeNull();
  });

  it('a container elsewhere is not discounted from this location', () => {
    const s = [...fill(at(B20, 1), 8, 20), ...fill(at(B20, 2), 1, 20)];
    const faraway = s[8];
    if (faraway === undefined) throw new Error('fixture');
    expect(canPlace(yard, s, 20, at(B20, 1), faraway.id)?.code).toBe('LOCATION_FULL');
  });
});

describe('usage index', () => {
  it('indexed canPlace answers exactly like the linear scan, everywhere', () => {
    const s = [
      ...fill(at(B20, 1), 3, 20),
      ...fill(at(B20, 2), 8, 20),
      ...fill(at(B40, 1), 2, 40),
      ...fill(at(MIX, 1), 1, 40),
      ...fill(at(MIX, 2), 3, 20),
    ];
    const usage = buildUsage(s);
    const ids = [undefined, s[0]?.id, s[3]?.id, s[11]?.id];

    for (const block of yard.blocks) {
      for (let row = 0; row <= block.rows + 1; row += 1) {
        for (const size of [20, 40] as const) {
          for (const ignoreId of ids) {
            const position = at(block.id, row);
            expect(canPlace(yard, s, size, position, ignoreId, usage)).toEqual(
              canPlace(yard, s, size, position, ignoreId),
            );
          }
        }
      }
    }
  });
});

/*
 * There is no lifting rule left to test. Nothing is buried in a basket, and
 * the administrative hold went with the container states — whatever must not
 * leave is written in the notes and read by whoever signs the paper. The
 * API suite covers that a full location still lets every one of its
 * containers walk out.
 */

describe('layout safety', () => {
  const sizes = (list: readonly Standing[]): Map<number, Size> =>
    new Map(list.map((s) => [s.id, s.size]));

  const reshape = (patch: Partial<YardConfig['blocks'][number]>): YardConfig => ({
    blocks: yard.blocks.map((b) => (b.id === B20 ? { ...b, ...patch } : b)),
  });

  it('growth, movement and turning strand nothing', () => {
    const s = fill(at(B20, 3), 1, 20);
    expect(
      strandedByLayout(reshape({ rows: 5, x: 500, y: 900, angle: 45 }), s, sizes(s)),
    ).toHaveLength(0);
  });

  it('a shorter column names exactly the stranded containers', () => {
    const deep = fill(at(B20, 3), 1, 20);
    const shallow = fill(at(B20, 1), 1, 20);
    const s = [...deep, ...shallow];
    const stranded = strandedByLayout(reshape({ rows: 2 }), s, sizes(s));
    expect(stranded.map((x) => x.number)).toEqual(deep.map((x) => x.number));
  });

  it('a vanished column strands its containers', () => {
    const s = fill(at(B20, 1), 1, 20);
    const without: YardConfig = { blocks: yard.blocks.filter((b) => b.id !== B20) };
    expect(strandedByLayout(without, s, sizes(s))).toHaveLength(1);
  });

  it('a size change under standing containers strands them', () => {
    const s = fill(at(B20, 1), 1, 20);
    expect(strandedByLayout(reshape({ size: 40 }), s, sizes(s))).toHaveLength(1);
  });

  it('cutting places or tiers under a full location reports it overfilled', () => {
    const s = fill(at(B20, 2), 8, 20);
    expect(overfilledByLayout(reshape({ tiers: 1 }), s)).toEqual([at(B20, 2)]);
    expect(overfilledByLayout(reshape({ placesPerTier: 3 }), s)).toEqual([at(B20, 2)]);
    // Exactly enough is not overfilled.
    expect(overfilledByLayout(reshape({ placesPerTier: 4, tiers: 2 }), s)).toHaveLength(0);
  });

  it('a stranded location is reported as stranding, not as overfilling', () => {
    const s = fill(at(B20, 3), 8, 20);
    expect(overfilledByLayout(reshape({ rows: 2, tiers: 1 }), s)).toHaveLength(0);
    expect(strandedByLayout(reshape({ rows: 2, tiers: 1 }), s, sizes(s))).toHaveLength(8);
  });
});
