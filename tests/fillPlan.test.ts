import { describe, expect, it } from 'vitest';
import { fillPlan } from '../src/shared/rules';
import type { Position, Size, YardLayout, ZoneDef } from '../src/shared/types';
import { ASEZA } from '../src/shared/asezaLayout';
import type { Standing } from '../src/shared/rules';

/**
 * «كم باقي على الساحة ان تمتلئ» — and the answer has to be in CONTAINERS.
 * A forty occupies two slots and stands across two adjacent odd bays, which
 * is exactly what the old figure ignored.
 */

/** One zone, bays 1..n odd, every bay carrying the same stacks. */
const zoneOf = (bays: readonly number[], stacks: readonly number[]): ZoneDef => ({
  zone: 'A',
  yard: 2,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  bays: [...bays],
  stacks: Object.fromEntries(bays.map((bay) => [String(bay), [...stacks]])),
});
const layoutOf = (zone: ZoneDef): YardLayout => ({ zones: [zone], landmarks: [] });

let nextId = 1;
const box = (position: Position, size: Size = 20): Standing => ({
  id: nextId++,
  number: `BOX${String(nextId).padStart(7, '0')}`,
  size,
  position,
});
const at = (bay: number, stack: number, tier: 'A' | 'B' | 'C'): Position => ({
  zone: 'A',
  bay,
  stack,
  tier,
});

describe('how much room is left', () => {
  it('counts an empty yard by stacks × the height assumed', () => {
    // Three odd bays, two stacks each = 6 ground slots.
    const layout = layoutOf(zoneOf([1, 3, 5], [1, 2]));
    expect(fillPlan(layout, [], 3).total).toMatchObject({
      capacity: 18,
      used: 0,
      twenties: 18,
    });
    expect(fillPlan(layout, [], 2).total).toMatchObject({ capacity: 12, twenties: 12 });
    expect(fillPlan(layout, [], 1).total).toMatchObject({ capacity: 6, twenties: 6 });
  });

  it('counts a forty as the TWO slots it occupies — and claims its block', () => {
    const layout = layoutOf(zoneOf([1, 3, 5], [1, 2]));
    // One forty at the even bay 02 covers bays 01 and 03 of stack 1 — and
    // by the block rule those two bays now fill with forties, so their free
    // stack-2 ground is no twenty's: «اما اربعين ف سوف يتم وضع اربعين قدم».
    const plan = fillPlan(layout, [box(at(2, 1, 'A'), 40)], 1).total;
    expect(plan.used).toBe(2);
    expect(plan.twenties).toBe(2);
    // The forties figure keeps that ground: the block grows at stack 2.
    expect(plan.forties).toBe(1);
  });

  it('pairs adjacent bays for forties instead of dividing by two', () => {
    // THREE odd bays in a line hold ONE forty per stack per tier, not one and
    // a half: the third bay has no free neighbour left to pair with.
    const line = layoutOf(zoneOf([1, 3, 5], [1]));
    expect(fillPlan(line, [], 1).total.forties).toBe(1);
    // Four bays make two pairs.
    expect(fillPlan(layoutOf(zoneOf([1, 3, 5, 7], [1])), [], 1).total.forties).toBe(2);
    // And a gap in the plan is not a pair: 01 and 05 are not neighbours.
    expect(fillPlan(layoutOf(zoneOf([1, 5], [1])), [], 1).total.forties).toBe(0);
  });

  it('will not stand a forty on air, or on a twenty', () => {
    const layout = layoutOf(zoneOf([1, 3], [1]));
    // Empty: one pair on the ground, one on B, one on C — a column of forties.
    expect(fillPlan(layout, [], 3).total.forties).toBe(3);
    // A single twenty on the ground of bay 01 kills the whole column: no
    // forty can pair on the ground, and none above it either.
    expect(fillPlan(layout, [box(at(1, 1, 'A'))], 3).total.forties).toBe(0);
    // A forty on the ground carries two more above it.
    expect(fillPlan(layout, [box(at(2, 1, 'A'), 40)], 3).total.forties).toBe(2);
  });

  /**
   * قاعدة البلوك، بجملة المالك: «في حال تم وضع 20 قدم في البلوك ف هذه يعني
   * انه سوف يتم تعبئتها كاملا ب 20، اما اربعين ف سوف يتم وضع اربعين قدم».
   */
  it('a block continues as its own kind', () => {
    const layout = layoutOf(zoneOf([1, 3, 5], [1, 2]));

    // A twenty at bay 01: the bay is a twenty block. Its free cells stay in
    // the twenties figure (2 above the box, 3 at stack 2, 12 in the empty
    // bays) — and no forty pair may plant a foot on bay 01, its empty
    // stack 2 included: the forties keep only the (3,5) pair, a column of
    // three on each of its two stacks.
    const twenty = fillPlan(layout, [box(at(1, 1, 'A'))], 3);
    expect(twenty.total.twenties).toBe(17);
    expect(twenty.total.forties).toBe(6);

    // A forty at 02: bays 01 and 03 are forty ground now. Their free cells
    // vanish from the twenties figure (bay 05 alone remains), and the
    // forties figure keeps the block's room: two more on the standing
    // column, a fresh column at stack 2 of (1,3).
    const forty = fillPlan(layout, [box(at(2, 1, 'A'), 40)], 3);
    expect(forty.total.twenties).toBe(6);
    expect(forty.total.forties).toBe(5);

    // A twenty standing beside another block's overhang keeps its bay a
    // twenty bay: its clean lane still counts for twenties, the standing
    // forty's own column still climbs — but no FRESH forty ground opens on
    // the twenty's bay.
    const mixed = fillPlan(layout, [box(at(2, 1, 'A'), 40), box(at(1, 2, 'A'))], 3);
    // Bay 01: the forty lane offers twenties nothing, the twenty lane has
    // room for 2. Bay 03 is forty ground (0). Bay 05 is free (6).
    expect(mixed.total.twenties).toBe(8);
    // Above the standing forty: 2. Fresh ground only at (3,5) stack 2 — a
    // column of 3; (3,5) stack 1 never plants, its bay-03 half being under
    // the standing forty with no column of its own below.
    expect(mixed.total.forties).toBe(2 + 3);
  });

  it('answers for the real yard, and the two heights differ by a third', () => {
    const three = fillPlan(ASEZA, [], 3).total;
    const two = fillPlan(ASEZA, [], 2).total;
    // 1053 ground slots on the official plan.
    expect(three.capacity).toBe(1053 * 3);
    expect(three.twenties).toBe(3159);
    expect(two.twenties).toBe(2106);
    // Forties are fewer than half the twenties: a lone bay at the end of a
    // line has nothing to pair with.
    expect(three.forties).toBeGreaterThan(0);
    expect(three.forties).toBeLessThan(three.twenties / 2);
    expect(two.forties * 3).toBe(three.forties * 2);
  });

  it('splits the answer per zone, and the parts add to the whole', () => {
    const { total, zones } = fillPlan(ASEZA, [], 3);
    expect(zones).toHaveLength(9);
    expect(zones.reduce((sum, zone) => sum + zone.twenties, 0)).toBe(total.twenties);
    expect(zones.reduce((sum, zone) => sum + zone.forties, 0)).toBe(total.forties);
    expect(zones.every((zone) => zone.yard === 2)).toBe(true);
  });
});
