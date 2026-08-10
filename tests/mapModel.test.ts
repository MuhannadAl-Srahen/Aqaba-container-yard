import { describe, expect, it } from 'vitest';
import {
  bayKey,
  bayLandings,
  buildBayLoads,
  countBay,
  maxStackOf,
  searchMatches,
  slotView,
  summarizeZone,
  targetBays,
} from '../src/client/mapModel';
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
    customer: 'شركة البحر',
    bill: '',
    enteredAt: '2026-08-01T08:00:00.000Z',
    exitedAt: null,
    position,
    notes: '',
    weight: '',
    truckIn: '',
    driverIn: '',
    sealIn: 'JO1',
    cardIn: 1,
    truckOut: '',
    driverOut: '',
    sealOut: '',
    cardOut: null,
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
    expect(countBay(zoneA, 5, undefined)).toEqual({ used: 0, total: 3, full: false });
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
  it('matches by number fragment and by customer, and ignores blanks', () => {
    const containers = [box('MSCU1234566', at(1, 1, 'A'))];
    expect(searchMatches(containers, 'mscu 1234').size).toBe(1);
    expect(searchMatches(containers, 'البحر').size).toBe(1);
    expect(searchMatches(containers, '  ').size).toBe(0);
  });
});
