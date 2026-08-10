import { describe, expect, it } from 'vitest';
import {
  buildLoads,
  countLocation,
  labelerFrom,
  legalTargets,
  placesUsed,
  searchMatches,
  smallestPlaces,
  summarizeBlock,
  yardFreeSpace,
} from '../src/client/mapModel';
import type { ContainerDto, Size, YardConfig } from '../src/shared/types';

const B20 = 1;
const B40 = 2;
const MIX = 3;

const yard: YardConfig = {
  blocks: [
    { id: B20, name: 'A', size: 20, rows: 2, placesPerTier: 4, tiers: 2, x: 0, y: 0, angle: 0 },
    { id: B40, name: 'B', size: 40, rows: 1, placesPerTier: 4, tiers: 2, x: 300, y: 0, angle: 0 },
    { id: MIX, name: 'R', size: 0, rows: 1, placesPerTier: 4, tiers: 2, x: 600, y: 0, angle: 0 },
  ],
};

function box(
  id: number,
  number: string,
  block: number,
  row: number,
  size: Size = 20,
  customer = 'شركة البحر',
): ContainerDto {
  return {
    id,
    number,
    numberValid: true,
    size,
    customer,
    enteredAt: '2026-08-01T08:00:00.000Z',
    exitedAt: null,
    position: { block, row },
    notes: '',
    weight: '',
    truckIn: '500',
    driverIn: '',
    sealIn: 'JO100001',
    cardIn: id,
    truckOut: '',
    driverOut: '',
    sealOut: '',
    cardOut: null,
  };
}

/** `count` identical containers standing in one location. */
const fill = (block: number, row: number, count: number, size: Size): ContainerDto[] =>
  Array.from({ length: count }, (_, i) =>
    box(block * 1000 + row * 100 + i, `BOX${String(block)}${String(row)}${String(i)}`, block, row, size),
  );

describe('loads', () => {
  it('gathers everything standing in one location, in gate-in order', () => {
    const loads = buildLoads([
      box(1, 'MSCU1234566', B20, 1),
      box(2, 'CSQU3054383', B20, 1),
      box(3, 'TGHU1234560', B20, 2),
    ]);
    expect(loads.get('1|1')?.map((c) => c.id)).toEqual([1, 2]);
    expect(loads.get('1|2')?.map((c) => c.id)).toEqual([3]);
    expect(loads.get('1|3')).toBeUndefined();
  });

  it('a departed container holds no ground', () => {
    const departed: ContainerDto = { ...box(1, 'MSCU1234566', B20, 1), position: null };
    expect(buildLoads([departed]).size).toBe(0);
  });

  it('counts places, not containers — a 40 is two', () => {
    expect(placesUsed(undefined)).toBe(0);
    expect(placesUsed(fill(MIX, 1, 2, 20))).toBe(2);
    expect(placesUsed(fill(MIX, 1, 2, 40))).toBe(4);
  });
});

describe('counting a location the way its column speaks', () => {
  it('a 20 column counts twenty-footers', () => {
    const block = yard.blocks[0];
    if (block === undefined) throw new Error('fixture');
    const count = countLocation(block, fill(B20, 1, 3, 20));
    expect([count.used, count.total, count.inPlaces, count.full]).toEqual([3, 8, false, false]);
    expect(countLocation(block, fill(B20, 1, 8, 20)).full).toBe(true);
  });

  it('a 40 column counts forty-footers, half as many', () => {
    const block = yard.blocks[1];
    if (block === undefined) throw new Error('fixture');
    const count = countLocation(block, fill(B40, 1, 1, 40));
    expect([count.used, count.total, count.inPlaces]).toEqual([1, 4, false]);
    expect(countLocation(block, fill(B40, 1, 4, 40)).full).toBe(true);
  });

  it('a mixed column counts places, and is full when no 20 would fit', () => {
    const block = yard.blocks[2];
    if (block === undefined) throw new Error('fixture');
    const count = countLocation(block, [...fill(MIX, 1, 3, 40), ...fill(MIX, 1, 1, 20)]);
    expect([count.used, count.total, count.inPlaces, count.full]).toEqual([7, 8, true, false]);
  });

  it('fullness is measured against the smallest thing the column accepts', () => {
    const [twenty, forty, mixed] = yard.blocks;
    if (twenty === undefined || forty === undefined || mixed === undefined) {
      throw new Error('fixture');
    }
    expect([smallestPlaces(twenty), smallestPlaces(forty), smallestPlaces(mixed)]).toEqual([
      1, 2, 1,
    ]);
    // Two places left is room for one more 40; none is full.
    expect(countLocation(forty, fill(B40, 1, 3, 40)).full).toBe(false);
    expect(countLocation(forty, fill(B40, 1, 4, 40)).full).toBe(true);
    // A mixed location with a single place left still takes a 20.
    expect(countLocation(mixed, fill(MIX, 1, 7, 20)).full).toBe(false);
    expect(countLocation(mixed, fill(MIX, 1, 8, 20)).full).toBe(true);
  });
});

describe('legal targets', () => {
  it('offers every location with room, in columns of the right size', () => {
    const targets = legalTargets(yard, fill(B20, 1, 8, 20), 20);
    expect(targets.has('1|1')).toBe(false); // full
    expect(targets.has('1|2')).toBe(true); // empty
    expect(targets.has('2|1')).toBe(false); // a 40 column takes no 20s
    expect(targets.has('3|1')).toBe(true); // mixed takes both
  });

  it('a 40 is refused where only one place is open', () => {
    const targets = legalTargets(yard, fill(MIX, 1, 7, 20), 40);
    expect(targets.has('3|1')).toBe(false);
    expect(legalTargets(yard, fill(MIX, 1, 6, 20), 40).has('3|1')).toBe(true);
  });

  it('a moving container is removed from its own picture', () => {
    const full = fill(B20, 1, 8, 20);
    const self = full[0];
    if (self === undefined) throw new Error('fixture');
    expect(legalTargets(yard, full, 20).has('1|1')).toBe(false);
    expect(legalTargets(yard, full, 20, self.id).has('1|1')).toBe(true);
  });

  it('every same-size column offers targets, wherever it is turned', () => {
    const wide: YardConfig = {
      blocks: [
        ...yard.blocks,
        { id: 7, name: 'C', size: 20, rows: 1, placesPerTier: 2, tiers: 1, x: 900, y: 0, angle: 15 },
      ],
    };
    expect(legalTargets(wide, [], 20).has('7|1')).toBe(true);
  });
});

describe('search matches', () => {
  it('matches by number fragment however it is typed', () => {
    const containers = [box(1, 'MSCU1234566', B20, 1)];
    expect(searchMatches(containers, 'mscu 12').has(1)).toBe(true);
    expect(searchMatches(containers, '4566').has(1)).toBe(true);
    expect(searchMatches(containers, 'TCLU').has(1)).toBe(false);
  });

  it('matches by customer and returns nothing for a blank query', () => {
    const containers = [box(1, 'MSCU1234566', B20, 1, 20, 'شركة البحر الأحمر')];
    expect(searchMatches(containers, 'البحر').has(1)).toBe(true);
    expect(searchMatches(containers, '  ').size).toBe(0);
  });
});

describe('column summary', () => {
  it('counts free places across every location of the column', () => {
    const loads = buildLoads([...fill(B20, 1, 3, 20), ...fill(B20, 2, 1, 20)]);
    const block20 = yard.blocks[0];
    if (block20 === undefined) throw new Error('fixture');
    const summary = summarizeBlock(block20, loads);
    // 2 locations × 4 places × 2 tiers = 16, of which 4 are taken.
    expect(summary.totalPlaces).toBe(16);
    expect(summary.freePlaces).toBe(12);
  });

  it('a 40 eats two places of the column total', () => {
    const block40 = yard.blocks[1];
    if (block40 === undefined) throw new Error('fixture');
    const summary = summarizeBlock(block40, buildLoads(fill(B40, 1, 2, 40)));
    expect([summary.totalPlaces, summary.freePlaces]).toEqual([8, 4]);
  });

  it('containers in another column never count against this one', () => {
    const loads = buildLoads(fill(B40, 1, 2, 40));
    const block20 = yard.blocks[0];
    if (block20 === undefined) throw new Error('fixture');
    expect(summarizeBlock(block20, loads).freePlaces).toBe(16);
  });
});

describe('what is still free in the whole yard', () => {
  it('answers in each size own language, and keeps the sizes apart', () => {
    // A: 2 locations × 8 places = 16 twenty-foot places.
    // B: 1 location × 8 places = 8 places = 4 forty-foot slots.
    // R (mixed): 8 places, counted as places because it takes both.
    const empty = yardFreeSpace(yard, buildLoads([]));
    expect(empty).toEqual({ twenty: 16, forty: 4, mixed: 8 });

    const loads = buildLoads([...fill(B20, 1, 3, 20), ...fill(B40, 1, 1, 40)]);
    // Three 20s took three places of A; one 40 took two places of B.
    expect(yardFreeSpace(yard, loads)).toEqual({ twenty: 13, forty: 3, mixed: 8 });
  });

  it('never offers half a forty when an odd place is left over', () => {
    const odd: YardConfig = {
      blocks: [
        { id: B40, name: 'B', size: 40, rows: 1, placesPerTier: 3, tiers: 1, x: 0, y: 0, angle: 0 },
      ],
    };
    // Three places take one 40 with a single place left standing empty.
    expect(yardFreeSpace(odd, buildLoads([])).forty).toBe(1);
  });
});

describe('labels from state names', () => {
  it('resolves names and survives deleted columns', () => {
    const label = labelerFrom({ '1': 'المخزن' });
    expect(label({ block: 1, row: 2 })).toBe('المخزن-03');
    expect(label({ block: 9, row: 1 })).toBe('؟-01');
  });
});
