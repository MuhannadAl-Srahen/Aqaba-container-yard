import { describe, expect, it } from 'vitest';
import {
  buildOccupancy,
  canMove,
  canPlace,
  canRemove,
  freeNow,
  planRemoval,
  slotUsable,
  type Standing,
} from '../src/shared/rules';
import { ASEZA } from '../src/shared/asezaLayout';
import type { Position, Size, YardLayout } from '../src/shared/types';

/**
 * The physics of the official grid. A tiny layout keeps the arithmetic
 * checkable by hand; the real ASEZA layout stands in for the walls.
 */

// Zone A (yard 1): bays 01,03,05 with stacks 1–2 everywhere.
// Zone E (yard 2): bays 01,03 with one stack each — the mini Y2.
const MINI: YardLayout = {
  zones: [
    {
      zone: 'A',
      yard: 1,
      x: 0, y: 0, w: 100, h: 100,
      bays: [1, 3, 5],
      stacks: { '1': [1, 2], '3': [1, 2], '5': [1, 2] },
    },
    {
      zone: 'E',
      yard: 2,
      x: 0, y: 200, w: 100, h: 100,
      bays: [1, 3],
      stacks: { '1': [1], '3': [1] },
    },
  ],
  landmarks: [],
};

const at = (bay: number, stack: number, tier: 'A' | 'B' | 'C'): Position => ({
  zone: 'A',
  bay,
  stack,
  tier,
});

let nextId = 1;
const box = (size: Size, position: Position): Standing => ({
  id: nextId++,
  number: `BOX${String(nextId).padStart(4, '0')}`,
  size,
  position,
});

/** Who comes down, and onto which tier, when this one is lifted out. */
const descents = (yard: readonly Standing[], lifted: Standing): Array<[string, string]> => {
  const plan = planRemoval(MINI, yard, lifted);
  if (!plan.ok) throw new Error(`refused with ${plan.refusal.code}`);
  return plan.descents.map((descent) => [descent.container.number, descent.to.tier]);
};

describe('slot existence', () => {
  it('knows the plan: real slots exist, the walls do not', () => {
    expect(slotUsable(MINI, 'A', 1, 1)).toBe(true);
    expect(slotUsable(MINI, 'A', 1, 3)).toBe(false);
    expect(slotUsable(MINI, 'A', 7, 1)).toBe(false);
    // The real drawing: zone A bay 01 lost stacks 1–2 to the wall.
    expect(slotUsable(ASEZA, 'A', 1, 1)).toBe(false);
    expect(slotUsable(ASEZA, 'A', 1, 3)).toBe(true);
    expect(slotUsable(ASEZA, 'A', 47, 1)).toBe(true);
  });
});

describe('placing', () => {
  it('the bay’s parity IS the size: a 20 on odd, a 40 on even', () => {
    expect(canPlace(MINI, [], 20, at(1, 1, 'A'))).toBeNull();
    expect(canPlace(MINI, [], 20, at(2, 1, 'A'))?.code).toBe('BAD_SLOT');
    expect(canPlace(MINI, [], 40, at(2, 1, 'A'))).toBeNull();
    expect(canPlace(MINI, [], 40, at(3, 1, 'A'))?.code).toBe('BAD_SLOT');
  });

  it('refuses the wall, even when only half a 40 hangs over it', () => {
    expect(canPlace(ASEZA, [], 20, { zone: 'A', bay: 1, stack: 1, tier: 'A' })?.code).toBe(
      'BAD_SLOT',
    );
    // A 40 at bay 46 covers bays 45 and 47: stack 1 exists at 47, not at 45.
    expect(canPlace(ASEZA, [], 40, { zone: 'A', bay: 46, stack: 1, tier: 'A' })?.code).toBe(
      'BAD_SLOT',
    );
    expect(canPlace(ASEZA, [], 40, { zone: 'A', bay: 48, stack: 1, tier: 'A' })).toBeNull();
  });

  it('one cell, one container — and a spanning 40 blocks both bays', () => {
    const twenty = box(20, at(1, 1, 'A'));
    expect(canPlace(MINI, [twenty], 20, at(1, 1, 'A'))?.code).toBe('OCCUPIED');
    // The 40 at bay 02 would lie across bays 01 and 03 — bay 01 is taken.
    const refusal = canPlace(MINI, [twenty], 40, at(2, 1, 'A'));
    expect(refusal?.code).toBe('OCCUPIED');
    expect(refusal?.other).toBe(twenty.number);

    const forty = box(40, at(2, 1, 'A'));
    expect(canPlace(MINI, [forty], 20, at(1, 1, 'A'))?.code).toBe('OCCUPIED');
    expect(canPlace(MINI, [forty], 20, at(3, 1, 'A'))?.code).toBe('OCCUPIED');
    expect(canPlace(MINI, [forty], 20, at(5, 1, 'A'))).toBeNull();
  });

  it('tier B needs its floor: a 20 sits on a 20, never on half a 40', () => {
    expect(canPlace(MINI, [], 20, at(1, 1, 'B'))?.code).toBe('NO_SUPPORT');
    expect(canPlace(MINI, [box(20, at(1, 1, 'A'))], 20, at(1, 1, 'B'))).toBeNull();
    // A 40's roof has no corner castings in the middle.
    expect(canPlace(MINI, [box(40, at(2, 1, 'A'))], 20, at(1, 1, 'B'))?.code).toBe('NO_SUPPORT');
  });

  it('a 40 on top rests on two 20s or on a 40 — never on one 20 alone', () => {
    const two20s = [box(20, at(1, 1, 'A')), box(20, at(3, 1, 'A'))];
    expect(canPlace(MINI, two20s, 40, at(2, 1, 'B'))).toBeNull();
    expect(canPlace(MINI, [box(20, at(1, 1, 'A'))], 40, at(2, 1, 'B'))?.code).toBe('NO_SUPPORT');
    expect(canPlace(MINI, [box(40, at(2, 1, 'A'))], 40, at(2, 1, 'B'))).toBeNull();
  });
});

describe('the reserve third tier', () => {
  it('tier C stacks over B with the same support rules', () => {
    const ground = box(20, at(1, 1, 'A'));
    const middle = box(20, at(1, 1, 'B'));
    // C over nothing, or over a gap, floats — refused.
    expect(canPlace(MINI, [ground], 20, at(1, 1, 'C'))?.code).toBe('NO_SUPPORT');
    // C over a full stack lands.
    expect(canPlace(MINI, [ground, middle], 20, at(1, 1, 'C'))).toBeNull();
  });

  it('lifting from under tier C brings the whole stack down one', () => {
    const ground = box(20, at(1, 1, 'A'));
    const middle = box(20, at(1, 1, 'B'));
    const top = box(20, at(1, 1, 'C'));
    const all = [ground, middle, top];
    // C,B,A minus A becomes B,A — and the descents come lowest first, so no
    // box ever lands on a slot that has yet to be vacated.
    expect(descents(all, ground)).toEqual([
      [middle.number, 'A'],
      [top.number, 'B'],
    ]);
    // C,B,A minus B becomes B,A as well: only what stood above it falls.
    expect(descents(all, middle)).toEqual([[top.number, 'B']]);
    // The top of the stack takes nothing with it.
    expect(descents(all, top)).toEqual([]);
  });

  it('forties stack three high too: 40 on 40 on 40', () => {
    const first = box(40, at(2, 1, 'A'));
    const second = box(40, at(2, 1, 'B'));
    expect(canPlace(MINI, [first, second], 40, at(2, 1, 'C'))).toBeNull();
    // But a 20 still refuses a 40's roof, on tier C like anywhere.
    expect(canPlace(MINI, [first, second], 20, at(1, 1, 'C'))?.code).toBe('NO_SUPPORT');
  });
});

describe('lifting, and the gravity that follows', () => {
  it('the box above comes down instead of refusing to let go', () => {
    const below = box(20, at(1, 1, 'A'));
    const above = box(20, at(1, 1, 'B'));
    expect(canRemove(MINI, [below, above], below)).toBeNull();
    expect(descents([below, above], below)).toEqual([[above.number, 'A']]);
    expect(descents([below, above], above)).toEqual([]);
  });

  it('forties come down on forties, three high', () => {
    const first = box(40, at(2, 1, 'A'));
    const second = box(40, at(2, 1, 'B'));
    const third = box(40, at(2, 1, 'C'));
    expect(descents([first, second, third], first)).toEqual([
      [second.number, 'A'],
      [third.number, 'B'],
    ]);
  });

  it('a 40 bridging two 20s cannot fall when only one leg is lifted', () => {
    const left = box(20, at(1, 1, 'A'));
    const right = box(20, at(3, 1, 'A'));
    const lid = box(40, at(2, 1, 'B'));
    const yard = [left, right, lid];
    // The lid has nowhere to land — its other leg still stands there. The
    // refusal names the lid, because relocating it is the way out.
    expect(canRemove(MINI, yard, left)?.code).toBe('BLOCKED_DESCENT');
    expect(canRemove(MINI, yard, left)?.other).toBe(lid.number);
    expect(canRemove(MINI, yard, right)?.other).toBe(lid.number);
    // Lift the lid itself and nothing is stranded.
    expect(canRemove(MINI, yard, lid)).toBeNull();
    // With both legs gone the question never arises: lifting the lid first,
    // either 20 is then free.
    expect(canRemove(MINI, [left, right], left)).toBeNull();
  });

  it('a move is a lift plus a landing, judged after the stack settles', () => {
    const mover = box(20, at(1, 1, 'A'));
    expect(canMove(MINI, [mover], mover, at(1, 1, 'A'))?.code).toBe('SAME_SLOT');
    expect(canMove(MINI, [mover], mover, at(3, 1, 'A'))).toBeNull();
    // Moving up onto its own head, with nothing above to come down, is air.
    expect(canMove(MINI, [mover], mover, at(1, 1, 'B'))?.code).toBe('NO_SUPPORT');

    const lid = box(20, at(1, 1, 'B'));
    // Carrying a lid no longer blocks the move — the lid simply drops.
    expect(canMove(MINI, [mover, lid], mover, at(3, 1, 'A'))).toBeNull();
    // And the slot the lid just left is a legal landing, standing on the lid.
    expect(canMove(MINI, [mover, lid], mover, at(1, 1, 'B'))).toBeNull();
  });
});

describe('what is free right now', () => {
  it('counts legal landings per yard, and tier B only once it has a floor', () => {
    // Empty mini yard: every ground slot takes a 20; nothing supports tier B.
    const empty = freeNow(MINI, []);
    expect(empty.yard1.t20).toBe(6);
    expect(empty.yard2.t20).toBe(2);
    // 40 pairs on the ground: (01,03) and (03,05) at each of the two stacks —
    // and the mini yard 2 has exactly the one pair over its single stack.
    expect(empty.yard1.t40).toBe(4);
    expect(empty.yard2.t40).toBe(1);

    // One 20 down: its slot is gone, but the slot on its roof opened.
    const one = freeNow(MINI, [box(20, at(1, 1, 'A'))]);
    expect(one.yard1.t20).toBe(6);
    // Both pairs over bay 01's stack 1 lost their ground.
    expect(one.yard1.t40).toBe(3);
  });

  it('agrees with the official totals on the real empty yard', () => {
    const empty = freeNow(ASEZA, []);
    expect(empty.yard1.t20).toBe(571);
    expect(empty.yard2.t20).toBe(110);
  });
});

describe('occupancy index', () => {
  it('a 40 claims the same cell of both odd bays it covers', () => {
    const forty = box(40, at(2, 2, 'A'));
    const cells = buildOccupancy([forty]);
    expect(cells.get('A|1|2|A')?.id).toBe(forty.id);
    expect(cells.get('A|3|2|A')?.id).toBe(forty.id);
    expect(cells.get('A|1|2|B')).toBeUndefined();
  });
});
