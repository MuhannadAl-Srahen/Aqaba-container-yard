import { describe, expect, it } from 'vitest';
import {
  addressMatch,
  bayKey,
  bayLandings,
  billBands,
  billBays,
  billSpread,
  buildBayLoads,
  countBay,
  maxStackOf,
  nearBillMates,
  searchMatches,
  slotView,
  summarizeZone,
  targetBays,
} from '../src/client/mapModel';
import { ASEZA } from '../src/shared/asezaLayout';
import { canPlace } from '../src/shared/rules';
import type { ContainerDto, Position, Size, YardLayout, ZoneDef } from '../src/shared/types';

const zoneA: ZoneDef = {
  zone: 'A',
  yard: 1,
  x: 0, y: 0, w: 100, h: 100,
  bays: [1, 3, 5],
  stacks: { '1': [1, 2], '3': [1, 2], '5': [2] },
};
const layout: YardLayout = { zones: [zoneA], landmarks: [] };

let nextId = 1;
function box(number: string, position: Position | null, size: Size = 20): ContainerDto {
  return {
    id: nextId++,
    number,
    numberValid: true,
    size,
    bill: '',
    enteredAt: '2026-08-01T08:00:00.000Z',
    exitedAt: null,
    position,
    notes: '',
    weight: '',
    handling: 'CRANE',
    truckIn: '',
    driverIn: '',
    sealIn: 'JO1',
    cardIn: 1,
    cardInYear: 2026,
    truckOut: '',
    driverOut: '',
    cardOut: null,
    cardOutYear: null,
  };
}

const at = (bay: number, stack: number, tier: 'A' | 'B' | 'C'): Position => ({
  zone: 'A',
  bay,
  stack,
  tier,
});

describe('bay loads', () => {
  it('lists a spanning 40 under BOTH odd bays it covers', () => {
    const forty = box('FORT0001', at(2, 1, 'A'), 40);
    const loads = buildBayLoads([forty, box('TWNT0001', at(5, 2, 'A'))]);
    expect(loads.get(bayKey('A', 1))?.map((c) => c.number)).toEqual(['FORT0001']);
    expect(loads.get(bayKey('A', 3))?.map((c) => c.number)).toEqual(['FORT0001']);
    expect(loads.get(bayKey('A', 5))).toHaveLength(1);
  });

  it('counts a bay in TEU against the stacks the plan gives it', () => {
    const loads = buildBayLoads([box('A', at(1, 1, 'A')), box('B', at(1, 1, 'B'))]);
    // Bay 01 has 2 stacks × 3 tiers = 6 TEU of room.
    expect(countBay(zoneA, 1, loads.get(bayKey('A', 1)))).toEqual({
      used: 2,
      total: 6,
      full: false,
    });
    // Bay 05 has a single usable stack over the three tiers.
    expect(countBay(zoneA, 5, undefined)).toEqual({
      used: 0,
      total: 3,
      full: false,
    });
  });

  it('counts a bay three tiers deep, everywhere', () => {
    const loads = buildBayLoads([box('A', at(1, 1, 'A')), box('B', at(1, 1, 'B'))]);
    // Two stacks over three tiers — the yard stacks three high as standard.
    expect(countBay(zoneA, 1, loads.get(bayKey('A', 1))).total).toBe(6);
    expect(countBay(zoneA, 5, undefined).total).toBe(3);
  });

  it('counts a bay as full only when every tier of every stack is taken', () => {
    // Zone A bay 5 has one usable stack, so three tiers fill it.
    const loads = buildBayLoads([
      box('A', at(5, 2, 'A')),
      box('B', at(5, 2, 'B')),
      box('C', at(5, 2, 'C')),
    ]);
    expect(countBay(zoneA, 5, loads.get(bayKey('A', 5))).full).toBe(true);
    expect(countBay(zoneA, 1, loads.get(bayKey('A', 1))).full).toBe(false);
  });

  it('finds the ground an address names, and who is standing on it', () => {
    const onGround = box('A', at(3, 1, 'A'));
    const hit = addressMatch(layout, [onGround, box('B', at(1, 1, 'A'))], '1-A-03-01-A');
    expect(hit?.bay).toBe(3);
    expect(hit?.containers.map((c) => c.number)).toEqual(['A']);
    expect(hit?.position).toEqual({ zone: 'A', bay: 3, stack: 1, tier: 'A' });
  });

  it('reads an even bay through the odd one whose sheet draws it', () => {
    // A 40 at bay 02 lies across bays 01 and 03; its sheet is bay 01.
    const spanning = box('F', at(2, 1, 'A'), 40);
    const hit = addressMatch(layout, [spanning], 'A-02-01-A');
    expect(hit?.bay).toBe(1);
    expect(hit?.containers.map((c) => c.number)).toEqual(['F']);
  });

  it('answers a bay-only question with everything standing in it', () => {
    const hit = addressMatch(layout, [box('G', at(1, 1, 'A')), box('H', at(1, 2, 'A'))], 'A-01');
    expect(hit?.position).toBeNull();
    expect(hit?.containers).toHaveLength(2);
  });

  it('answers an empty slot with the slot itself, and nothing standing', () => {
    const hit = addressMatch(layout, [], 'A-05-02-B');
    expect(hit?.bay).toBe(5);
    expect(hit?.containers).toEqual([]);
  });

  it('finds a real address on the real plan — 2-E-18-01-A', () => {
    // The owner's own example: an even bay, so a 40's address, read through
    // bay 17 whose sheet the plan draws.
    const hit = addressMatch(ASEZA, [], '2-E-18-01-A');
    expect(hit?.zone).toBe('E');
    expect(hit?.bay).toBe(17);
    expect(hit?.position).toEqual({ zone: 'E', bay: 18, stack: 1, tier: 'A' });

    // Everything is SAHA 2 now, so a 1- prefix names ground that is not here.
    expect(addressMatch(ASEZA, [], '1-E-18-01-A')).toBeNull();
    expect(addressMatch(ASEZA, [], '2-A-03-05-A')?.bay).toBe(3);
    // And the walls still bite: zone A bay 03 has no stacks 01–02 at all.
    expect(addressMatch(ASEZA, [], '2-A-03-01-A')).toBeNull();
  });

  it('refuses ground the plan does not have', () => {
    // Bay 05 of this zone has only stack 2, and there is no bay 09 at all.
    expect(addressMatch(layout, [], 'A-05-01-A')).toBeNull();
    expect(addressMatch(layout, [], 'A-09-01-A')).toBeNull();
    expect(addressMatch(layout, [], 'TGHU1234567')).toBeNull();
  });

  it('rolls a zone up for the panel header', () => {
    const loads = buildBayLoads([box('A', at(1, 1, 'A'))]);
    expect(summarizeZone(zoneA, loads)).toEqual({ usedTeu: 1, totalTeu: 15 });
    expect(maxStackOf(zoneA)).toBe(2);
  });
});

describe('slot views', () => {
  it('tells the wall from the empty from the taken — spanning 40s included', () => {
    const forty = box('FORT0001', at(2, 1, 'A'), 40);
    const load = [forty];
    expect(slotView(zoneA, 5, 1, 'A', [])).toEqual({ kind: 'wall' });
    expect(slotView(zoneA, 1, 2, 'A', load)).toEqual({ kind: 'empty' });
    const seen = slotView(zoneA, 1, 1, 'A', load);
    expect(seen.kind).toBe('taken');
    if (seen.kind === 'taken') expect(seen.container.number).toBe('FORT0001');
    const other = slotView(zoneA, 3, 1, 'A', load);
    expect(other.kind).toBe('taken');
  });
});

describe('landings inside one bay sheet', () => {
  it('offers the ground for a 20, and the roof only over a 20', () => {
    const containers = [box('BASE0001', at(1, 1, 'A'))];
    const spots = bayLandings(layout, zoneA, 1, containers, 20);
    const labels = spots.map((p) => `${String(p.bay)}|${String(p.stack)}|${p.tier}`);
    expect(labels).toContain('1|2|A');
    expect(labels).toContain('1|1|B');
    expect(labels).not.toContain('1|1|A');
  });

  it('offers a 40 as the even bay pairing this bay with a neighbour', () => {
    const spots = bayLandings(layout, zoneA, 3, [], 40);
    const bays = new Set(spots.map((p) => p.bay));
    expect(bays).toEqual(new Set([2, 4]));
    // Bay 04 pairs 03 with 05, and 05 only has stack 2 — so stack 1 pairs
    // only through bay 02.
    expect(spots.filter((p) => p.bay === 4).map((p) => p.stack)).toEqual([2]);
  });

  /**
   * The owner's own dead cell: A-05 stack 5 read «فارغ» and refused his
   * forty. Its ground was truly free — but a forty needs a partner cell at
   * the neighbouring odd bay, and BOTH neighbours' cells at that stack were
   * spent under other blocks' overhangs (bay 02's over 03, bay 08's over
   * 07). The refusal must name the occupier, and the landing set must skip
   * that stack while offering the genuinely open ones.
   */
  it('a free-looking cell with both partners covered is no landing, by name', () => {
    const zoneRow: ZoneDef = {
      zone: 'A',
      yard: 1,
      x: 0, y: 0, w: 100, h: 100,
      bays: [1, 3, 5, 7, 9],
      stacks: {
        '1': [1, 2, 3], '3': [1, 2, 3], '5': [1, 2, 3], '7': [1, 2, 3], '9': [1, 2, 3],
      },
    };
    const row: YardLayout = { zones: [zoneRow], landmarks: [] };
    const containers = [
      box('LEFT0001', at(2, 1, 'A'), 40), // covers 01 and 03 at stack 1
      box('RGHT0001', at(8, 1, 'A'), 40), // covers 07 and 09 at stack 1
    ];
    const standing = containers.map((c) => ({
      id: c.id, number: c.number, size: c.size, position: c.position as Position,
    }));

    // Bay 05's own cell at stack 1 is empty — and still no forty fits:
    // both even-bay ways are OCCUPIED, each naming who spent the partner.
    const viaLeft = canPlace(row, standing, 40, { zone: 'A', bay: 4, stack: 1, tier: 'A' });
    expect(viaLeft?.code).toBe('OCCUPIED');
    expect(viaLeft?.other).toBe('LEFT0001');
    const viaRight = canPlace(row, standing, 40, { zone: 'A', bay: 6, stack: 1, tier: 'A' });
    expect(viaRight?.code).toBe('OCCUPIED');
    expect(viaRight?.other).toBe('RGHT0001');

    // And the sheet's glow set skips that stack while offering the open ones.
    const spots = bayLandings(row, zoneRow, 5, containers, 40);
    expect(spots.some((p) => p.stack === 1)).toBe(false);
    expect(spots.filter((p) => p.tier === 'A').map((p) => p.stack).sort()).toEqual([2, 2, 3, 3]);
  });

  it('ignores the moving container’s own footprint', () => {
    const mover = box('MOVE0001', at(1, 1, 'A'));
    const spots = bayLandings(layout, zoneA, 1, [mover], 20, mover.id);
    const labels = spots.map((p) => `${String(p.bay)}|${String(p.stack)}|${p.tier}`);
    // Its old slot is offered again (the map treats it as already lifted)…
    expect(labels).toContain('1|1|A');
    // …but its roof is not, because lifting it removes the support.
    expect(labels).not.toContain('1|1|B');
  });
});

describe('target bays while placing', () => {
  it('lights a bay exactly when a legal landing exists inside it', () => {
    const targets20 = targetBays(layout, [], 20);
    expect(targets20).toEqual(new Set([bayKey('A', 1), bayKey('A', 3), bayKey('A', 5)]));

    const targets40 = targetBays(layout, [], 40);
    // Bay 05 reaches a 40 through bay 04 at stack 2; every bay has a pair.
    expect(targets40).toEqual(new Set([bayKey('A', 1), bayKey('A', 3), bayKey('A', 5)]));
  });

  it('goes dark when the yard leaves no room', () => {
    // Every slot of every tier filled — the reserve tier C included.
    const containers = (['A', 'B', 'C'] as const).flatMap((tier, level) => [
      box(`K${String(level)}1`, at(1, 1, tier)),
      box(`K${String(level)}2`, at(1, 2, tier)),
      box(`K${String(level)}3`, at(3, 1, tier)),
      box(`K${String(level)}4`, at(3, 2, tier)),
      box(`K${String(level)}5`, at(5, 2, tier)),
    ]);
    expect(targetBays(layout, containers, 20).size).toBe(0);
  });
});

describe('bill helpers — «احنا محكومين فيه الي هو البوليصة»', () => {
  /** The merchant takes the whole bill out in one batch, so placement aims
   *  beside the group and scatter is worth a warning. */
  const billed = (
    number: string,
    position: Position | null,
    bill: string,
    size: Size = 20,
  ): ContainerDto => ({ ...box(number, position, size), bill });

  it('billBays: a spanning forty is present in both its bays, once each', () => {
    const group = [
      billed('F', at(2, 1, 'A'), 'JO-9', 40),
      billed('T', at(5, 2, 'A'), 'JO-9'),
      billed('OTHER', at(3, 2, 'A'), 'JO-1'),
    ];
    const bays = billBays(group, 'JO-9');
    expect(bays.get(bayKey('A', 1))).toBe(1);
    expect(bays.get(bayKey('A', 3))).toBe(1);
    expect(bays.get(bayKey('A', 5))).toBe(1);
    expect(bays.size).toBe(3);
    // The container being moved is not its own neighbour.
    const t = group[1];
    expect(billBays(group, 'JO-9', t?.id).has(bayKey('A', 5))).toBe(false);
    expect(billBays(group, '').size).toBe(0);
  });

  it('billSpread: zones biggest first, the mover excluded, departed ignored', () => {
    const group = [
      billed('A1', { zone: 'B', bay: 1, stack: 1, tier: 'A' }, 'JO-9'),
      billed('A2', { zone: 'B', bay: 3, stack: 1, tier: 'A' }, 'JO-9'),
      billed('A3', at(1, 1, 'A'), 'JO-9'),
      billed('GONE', null, 'JO-9'),
    ];
    expect(billSpread(group, 'JO-9')).toEqual([
      { zone: 'B', count: 2 },
      { zone: 'A', count: 1 },
    ]);
    const mover = group[2];
    expect(billSpread(group, 'JO-9', mover?.id)).toEqual([{ zone: 'B', count: 2 }]);
  });

  it('nearBillMates: beside is the same or the next odd bay, in the same zone', () => {
    const mates = [billed('M', at(3, 1, 'A'), 'JO-9')];
    const landing = (zone: 'A' | 'B', bay: number): Position =>
      ({ zone, bay, stack: 1, tier: 'A' }) as Position;
    expect(nearBillMates(mates, 'JO-9', landing('A', 3))).toBe(true);
    expect(nearBillMates(mates, 'JO-9', landing('A', 5))).toBe(true);
    // A forty landing at even 04 covers 03 — right on the mate.
    expect(nearBillMates(mates, 'JO-9', landing('A', 4))).toBe(true);
    expect(nearBillMates(mates, 'JO-9', landing('A', 9))).toBe(false);
    expect(nearBillMates(mates, 'JO-9', landing('B', 3))).toBe(false);
    // No mates standing — the question does not arise.
    expect(nearBillMates(mates, 'JO-1', landing('A', 3))).toBeNull();
    expect(nearBillMates([billed('G', null, 'JO-9')], 'JO-9', landing('A', 3))).toBeNull();
  });
});

describe('billBands — «تلون الخريطة بناءا على عدد البوليصات»', () => {
  const billed = (
    number: string,
    position: Position | null,
    bill: string,
    size: Size = 20,
  ): ContainerDto => ({ ...box(number, position, size), bill });

  it('a bay wears the size class of the BIGGEST bill standing on it', () => {
    const big = Array.from({ length: 11 }, (_, i) =>
      billed(`BIG${String(i)}`, { zone: 'A', bay: 1, stack: 1, tier: 'A' } as Position, 'JO-BIG'),
    );
    const containers = [
      ...big,
      billed('MID1', at(1, 2, 'A'), 'JO-MID'),
      ...Array.from({ length: 6 }, (_, i) => billed(`M${String(i)}`, at(3, 1, 'A'), 'JO-MID')),
      billed('PAIR1', at(5, 2, 'A'), 'JO-PAIR'),
      billed('PAIR2', at(5, 2, 'B'), 'JO-PAIR'),
      billed('LONE', at(5, 2, 'C'), 'JO-LONE'),
    ];
    const bands = billBands(containers);
    // Bay 1 holds an over-ten bill (band 1) beside a 6–10 one — the big wins.
    expect(bands.get(bayKey('A', 1))).toBe(1);
    expect(bands.get(bayKey('A', 3))).toBe(2);
    // A pair (2–5) outranks the single beside it.
    expect(bands.get(bayKey('A', 5))).toBe(3);
  });

  it('a spanning forty carries its bill onto both bays; singles read 4', () => {
    const bands = billBands([
      billed('F1', { zone: 'A', bay: 2, stack: 1, tier: 'A' } as Position, 'JO-ONE', 40),
    ]);
    expect(bands.get(bayKey('A', 1))).toBe(4);
    expect(bands.get(bayKey('A', 3))).toBe(4);
    expect(bands.get(bayKey('A', 5))).toBeUndefined();
  });

  it('group size counts the whole yard, not the one bay', () => {
    // Six boxes of one bill split across two bays: each bay still reads 6–10.
    const spread = [
      ...Array.from({ length: 3 }, (_, i) => billed(`A${String(i)}`, at(1, 1, 'A'), 'JO-6')),
      ...Array.from({ length: 3 }, (_, i) => billed(`B${String(i)}`, at(3, 1, 'A'), 'JO-6')),
    ];
    const bands = billBands(spread);
    expect(bands.get(bayKey('A', 1))).toBe(2);
    expect(bands.get(bayKey('A', 3))).toBe(2);
  });
});

describe('search', () => {
  /** The owner's name is gone, so a number or a bill is what is left to ask. */
  it('matches by number fragment and by bill, and ignores blanks', () => {
    const containers = [{ ...box('MSCU1234566', at(1, 1, 'A')), bill: 'JO3210' }];
    expect(searchMatches(containers, 'mscu 1234').size).toBe(1);
    expect(searchMatches(containers, 'jo32').size).toBe(1);
    expect(searchMatches(containers, '  ').size).toBe(0);
    expect(searchMatches(containers, 'شركة').size).toBe(0);
  });
});
