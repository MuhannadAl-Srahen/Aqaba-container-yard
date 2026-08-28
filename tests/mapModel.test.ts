import { describe, expect, it } from 'vitest';
import {
  addressMatch,
  bayKey,
  bayLandings,
  buildBayLoads,
  countBay,
  maxStackOf,
  searchMatches,
  slotView,
  summarizeZone,
  targetBays,
  zoneCells,
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
    expect(summarizeZone(zoneA, loads)).toEqual({ boxes: 1, usedTeu: 1, totalTeu: 15 });
    expect(maxStackOf(zoneA)).toBe(2);
  });

  it('counts a spanning forty ONCE in the header, and twice in the slots', () => {
    const loads = buildBayLoads([box('F', at(2, 1, 'A'), 40)]);
    // One container standing; two of the zone's fifteen slots under it.
    expect(summarizeZone(zoneA, loads)).toEqual({ boxes: 1, usedTeu: 2, totalTeu: 15 });
  });
});

describe('zone cells — a forty block claims its pair of bays', () => {
  /**
   * «كان النظام يضع 40 قدم كل خانتين»: the owner reads a forty as one thing
   * across two slots, so the strip pairs the bays a block lies across and
   * counts every box once. And a cell is AT MOST a pair — «يجب ان يكون مفصل
   * اكثر، مثلا 19-21، 23-25»: on his live zone B one stray forty at bay 22
   * bridged the blocks at 20 and 24, and the first cut welded all four bays
   * into one coarse «19–25». Now the heaviest block claims its pair first,
   * and the stray counts in the cell holding the lower bay it covers.
   */
  const zoneWide: ZoneDef = {
    zone: 'A',
    yard: 1,
    x: 0, y: 0, w: 100, h: 100,
    bays: [1, 3, 5, 7, 9, 11],
    stacks: {
      '1': [1, 2, 3], '3': [1, 2, 3], '5': [1, 2, 3],
      '7': [1, 2, 3], '9': [1, 2, 3], '11': [1, 2, 3],
    },
  };

  it('the heavier block anchors the pair; the dribble keeps to the margin', () => {
    // The live zone A shape: four twenties at bay 1, two forties at bay 02,
    // a six-forty block at 04, a block at 08, and bay 11 bare. The block at
    // 04 owns «03–05»; the two at 02 count under the lone «01» beside it.
    const loads = buildBayLoads([
      box('T1', at(1, 1, 'A')),
      box('T2', at(1, 1, 'B')),
      box('F2', at(2, 2, 'A'), 40),
      box('F4A', at(4, 3, 'A'), 40),
      box('F4B', at(4, 3, 'B'), 40),
      box('F8A', at(8, 1, 'A'), 40),
      box('F8B', at(8, 1, 'B'), 40),
      box('F8C', at(8, 2, 'A'), 40),
    ]);
    const cells = zoneCells(zoneWide, loads);
    expect(cells.map((cell) => cell.bays)).toEqual([[1], [3, 5], [7, 9], [11]]);

    // Each container counted once, in one cell: 2 twenties + the stray forty
    // under «01», the block of two under «03–05», three under «07–09».
    expect(cells.map((cell) => cell.boxes)).toEqual([3, 2, 3, 0]);

    // The pair's ceiling counts the neighbour's overhang as blocked ground:
    // completed as forties, «03–05» holds six — two standing plus four
    // landings (worked by hand; the stray at 02 kills one stack line).
    expect(cells[1]?.capacity).toBe(6);

    // A pure pair reads like the ledger: three of the nine it can carry
    // (three shared stacks × three tiers).
    expect(cells[2]?.capacity).toBe(9);
    expect(cells[2]?.empty).toBe(false);

    // The bare bay keeps the old arithmetic: twenties over stacks × 3.
    expect(cells[3]).toEqual({ bays: [11], boxes: 0, capacity: 9, full: false, empty: true });
  });

  it('the owner’s own case: 19–25 breaks into 19–21 and 23–25', () => {
    const zoneB: ZoneDef = {
      zone: 'A',
      yard: 1,
      x: 0, y: 0, w: 100, h: 100,
      bays: [19, 21, 23, 25],
      stacks: { '19': [1, 2, 3], '21': [1, 2, 3], '23': [1, 2, 3], '25': [1, 2, 3] },
    };
    // Blocks at 20 and 24, one stray forty at 22 bridging them — the shape
    // that produced the coarse «19–25 · 42/59» on his screen.
    const loads = buildBayLoads([
      box('F20A', at(20, 1, 'A'), 40),
      box('F20B', at(20, 2, 'A'), 40),
      box('F22', at(22, 3, 'A'), 40),
      box('F24A', at(24, 1, 'A'), 40),
      box('F24B', at(24, 2, 'A'), 40),
    ]);
    const cells = zoneCells(zoneB, loads);
    expect(cells.map((cell) => cell.bays)).toEqual([[19, 21], [23, 25]]);
    // The stray at 22 counts once, in the cell holding bay 21.
    expect(cells.map((cell) => cell.boxes)).toEqual([3, 2]);
    // And every box of the zone is in exactly one cell.
    expect(cells.reduce((sum, cell) => sum + cell.boxes, 0)).toBe(
      summarizeZone(zoneB, loads).boxes,
    );
  });

  it('adjacency alone pairs nothing — it takes a forty', () => {
    const loads = buildBayLoads([box('T1', at(1, 1, 'A')), box('T3', at(3, 1, 'A'))]);
    const cells = zoneCells(zoneWide, loads);
    expect(cells.map((cell) => cell.bays)).toEqual([[1], [3], [5], [7], [9], [11]]);
    expect(cells[0]?.boxes).toBe(1);
    expect(cells[0]?.capacity).toBe(9);
  });

  it('a pair is full when every slot under it is taken', () => {
    // Bays 07–09, three stacks: nine forties stacked three high fill it.
    const forties = [1, 2, 3].flatMap((stack) =>
      (['A', 'B', 'C'] as const).map((tier) => box(`F${String(stack)}${tier}`, at(8, stack, tier), 40)),
    );
    const cells = zoneCells(zoneWide, buildBayLoads(forties));
    const pair = cells.find((cell) => cell.bays.length === 2);
    expect(pair?.bays).toEqual([7, 9]);
    expect(pair?.boxes).toBe(9);
    expect(pair?.capacity).toBe(9);
    expect(pair?.full).toBe(true);
  });

  it('ground under an overhang alone is not empty, and its room shrinks', () => {
    // One forty at 02 and nothing else: bay 03's ground is half covered by a
    // box that belongs to the cell next door.
    const cells = zoneCells(zoneWide, buildBayLoads([box('F2', at(2, 1, 'A'), 40)]));
    const lone3 = cells.find((cell) => cell.bays.length === 1 && cell.bays[0] === 3);
    expect(lone3).toBeUndefined();
    // 02 is the only block, so it claims «01–03» whole.
    const pair = cells.find((cell) => cell.bays.length === 2);
    expect(pair?.bays).toEqual([1, 3]);
    expect(pair?.boxes).toBe(1);
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
