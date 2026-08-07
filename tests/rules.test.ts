import { describe, expect, it } from 'vitest';
import type { Standing } from '../src/shared/rules';
import { canLift, canPlace, containerAbove, strandedByResize } from '../src/shared/rules';
import type { Position, YardConfig } from '../src/shared/types';

const yard: YardConfig = {
  twenty: { rows: 3, cols: 5 },
  forty: { rows: 2, cols: 4 },
};

const at = (zone: 20 | 40, row: number, col: number, tier: 1 | 2): Position => ({
  zone,
  row,
  col,
  tier,
});

const standing = (...list: Array<[id: number, number: string, pos: Position]>): Standing[] =>
  list.map(([id, number, position]) => ({ id, number, position }));

describe('placement', () => {
  it('accepts an empty ground slot in the right zone', () => {
    expect(canPlace(yard, [], 20, at(20, 1, 1, 1))).toBeNull();
    expect(canPlace(yard, [], 40, at(40, 2, 4, 1))).toBeNull();
  });

  it('refuses a position outside the configured yard', () => {
    expect(canPlace(yard, [], 20, at(20, 4, 1, 1))?.code).toBe('OUT_OF_BOUNDS');
    expect(canPlace(yard, [], 20, at(20, 1, 6, 1))?.code).toBe('OUT_OF_BOUNDS');
    expect(canPlace(yard, [], 40, at(40, 3, 1, 1))?.code).toBe('OUT_OF_BOUNDS');
  });

  it('keeps each size in its own half', () => {
    expect(canPlace(yard, [], 20, at(40, 1, 1, 1))?.code).toBe('WRONG_ZONE');
    expect(canPlace(yard, [], 40, at(20, 1, 1, 1))?.code).toBe('WRONG_ZONE');
  });

  it('refuses a taken slot and names the occupant', () => {
    const s = standing([1, 'MSCU1234566', at(20, 1, 1, 1)]);
    const refusal = canPlace(yard, s, 20, at(20, 1, 1, 1));
    expect(refusal?.code).toBe('SLOT_TAKEN');
    expect(refusal !== null && 'by' in refusal ? refusal.by : '').toBe('MSCU1234566');
  });

  it('refuses the first tier over empty ground', () => {
    expect(canPlace(yard, [], 20, at(20, 1, 1, 2))?.code).toBe('NO_SUPPORT');
  });

  it('accepts the first tier over a standing container', () => {
    const s = standing([1, 'MSCU1234566', at(20, 1, 1, 1)]);
    expect(canPlace(yard, s, 20, at(20, 1, 1, 2))).toBeNull();
  });

  it('a moving container is not its own support', () => {
    // Container 1 stands on the ground; moving IT to the tier above itself
    // must fail, because once it lifts there is nothing underneath.
    const s = standing([1, 'MSCU1234566', at(20, 1, 1, 1)]);
    expect(canPlace(yard, s, 20, at(20, 1, 1, 2), 1)?.code).toBe('NO_SUPPORT');
  });

  it('a moving container does not collide with itself', () => {
    const s = standing([1, 'MSCU1234566', at(20, 1, 1, 1)]);
    expect(canPlace(yard, s, 20, at(20, 1, 1, 1), 1)).toBeNull();
  });
});

describe('lifting', () => {
  it('refuses to lift a buried container and names what is on top', () => {
    const s = standing(
      [1, 'MSCU1234566', at(20, 1, 1, 1)],
      [2, 'CSQU3054383', at(20, 1, 1, 2)],
    );
    const bottom = s[0];
    if (bottom === undefined) throw new Error('fixture');
    const refusal = canLift(s, bottom);
    expect(refusal?.code).toBe('BURIED');
    expect(refusal !== null && 'by' in refusal ? refusal.by : '').toBe('CSQU3054383');
  });

  it('lifts a top container freely', () => {
    const s = standing(
      [1, 'MSCU1234566', at(20, 1, 1, 1)],
      [2, 'CSQU3054383', at(20, 1, 1, 2)],
    );
    const top = s[1];
    if (top === undefined) throw new Error('fixture');
    expect(canLift(s, top)).toBeNull();
    expect(containerAbove(s, top)).toBeNull();
  });
});

describe('resize safety', () => {
  it('growth strands nothing', () => {
    const s = standing([1, 'MSCU1234566', at(20, 3, 5, 1)]);
    const bigger: YardConfig = { twenty: { rows: 4, cols: 6 }, forty: yard.forty };
    expect(strandedByResize(bigger, s)).toHaveLength(0);
  });

  it('a shrink names exactly the stranded containers', () => {
    const s = standing(
      [1, 'MSCU1234566', at(20, 3, 5, 1)],
      [2, 'CSQU3054383', at(20, 1, 1, 1)],
    );
    const smaller: YardConfig = { twenty: { rows: 2, cols: 5 }, forty: yard.forty };
    const stranded = strandedByResize(smaller, s);
    expect(stranded.map((x) => x.number)).toEqual(['MSCU1234566']);
  });
});
