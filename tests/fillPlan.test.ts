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

  it('counts a forty as the TWO slots it actually occupies', () => {
    const layout = layoutOf(zoneOf([1, 3, 5], [1, 2]));
    // One forty at the even bay 02 covers bays 01 and 03 of stack 1.
    const plan = fillPlan(layout, [box(at(2, 1, 'A'), 40)], 1).total;
    expect(plan.used).toBe(2);
    expect(plan.twenties).toBe(4);
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

  it('answers for the real yard, and the two heights differ by a third', () => {
    const three = fillPlan(ASEZA, [], 3).total;
    const two = fillPlan(ASEZA, [], 2).total;
    // 681 ground slots on the official plan.
    expect(three.capacity).toBe(681 * 3);
    expect(three.twenties).toBe(2043);
    expect(two.twenties).toBe(1362);
    // Forties are fewer than half the twenties: a lone bay at the end of a
    // line has nothing to pair with.
    expect(three.forties).toBeGreaterThan(0);
    expect(three.forties).toBeLessThan(three.twenties / 2);
    expect(two.forties * 3).toBe(three.forties * 2);
  });

  it('splits the answer per zone, and the parts add to the whole', () => {
    const { total, zones } = fillPlan(ASEZA, [], 3);
    expect(zones).toHaveLength(5);
    expect(zones.reduce((sum, zone) => sum + zone.twenties, 0)).toBe(total.twenties);
    expect(zones.reduce((sum, zone) => sum + zone.forties, 0)).toBe(total.forties);
    expect(zones.every((zone) => zone.yard === 2)).toBe(true);
  });
});
