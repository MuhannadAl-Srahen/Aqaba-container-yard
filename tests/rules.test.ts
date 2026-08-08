import { describe, expect, it } from 'vitest';
import type { Standing } from '../src/shared/rules';
import {
  buildOccupancy,
  canLift,
  canPlace,
  containerAbove,
  strandedByLayout,
} from '../src/shared/rules';
import type { Position, Size, Tier, YardConfig } from '../src/shared/types';
import { GROUND_TIER, MAX_TIER } from '../src/shared/types';
import type { SlotStates } from '../src/shared/rules';
import { slotKey } from '../src/shared/address';

const B20 = 1;
const B40 = 2;

/** No slot carries a state — the everyday yard. */
const NO_STATES: SlotStates = {};

const yard: YardConfig = {
  blocks: [
    { id: B20, name: 'منطقة 20', size: 20, rows: 3, cols: 5, x: 0, y: 0, angle: 0, state: 'NORMAL' },
    { id: B40, name: 'منطقة 40', size: 40, rows: 2, cols: 4, x: 0, y: 300, angle: 0, state: 'NORMAL' },
  ],
};

const at = (block: number, row: number, col: number, tier: 1 | 2): Position => ({
  block,
  row,
  col,
  tier,
});

const standing = (
  ...list: Array<[id: number, number: string, pos: Position, size?: 20 | 40]>
): Standing[] =>
  list.map(([id, number, position, size]) => ({
    id,
    number,
    size: size ?? 20,
    status: 'NORMAL',
    position,
  }));

describe('placement', () => {
  it('accepts an empty ground slot in the right block', () => {
    expect(canPlace(yard, [], NO_STATES, 20, at(B20, 1, 1, 1))).toBeNull();
    expect(canPlace(yard, [], NO_STATES, 40, at(B40, 2, 4, 1))).toBeNull();
  });

  it('refuses a position outside the configured yard', () => {
    expect(canPlace(yard, [], NO_STATES, 20, at(B20, 4, 1, 1))?.code).toBe('OUT_OF_BOUNDS');
    expect(canPlace(yard, [], NO_STATES, 20, at(B20, 1, 6, 1))?.code).toBe('OUT_OF_BOUNDS');
    expect(canPlace(yard, [], NO_STATES, 40, at(B40, 3, 1, 1))?.code).toBe('OUT_OF_BOUNDS');
    expect(canPlace(yard, [], NO_STATES, 20, at(99, 1, 1, 1))?.code).toBe('OUT_OF_BOUNDS');
  });

  it('keeps each size in its own block', () => {
    expect(canPlace(yard, [], NO_STATES, 20, at(B40, 1, 1, 1))?.code).toBe('WRONG_ZONE');
    expect(canPlace(yard, [], NO_STATES, 40, at(B20, 1, 1, 1))?.code).toBe('WRONG_ZONE');
  });

  it('a mixed block takes both sizes', () => {
    const withMixed: YardConfig = {
      blocks: [
        ...yard.blocks,
        { id: 9, name: 'م', size: 0, rows: 2, cols: 2, x: 900, y: 0, angle: 0, state: 'NORMAL' },
      ],
    };
    expect(canPlace(withMixed, [], NO_STATES, 20, at(9, 1, 1, 1))).toBeNull();
    expect(canPlace(withMixed, [], NO_STATES, 40, at(9, 1, 2, 1))).toBeNull();
  });

  it('a 40 never stacks on a 20; the other way round is allowed', () => {
    const withMixed: YardConfig = {
      blocks: [
        ...yard.blocks,
        { id: 9, name: 'م', size: 0, rows: 2, cols: 2, x: 900, y: 0, angle: 0, state: 'NORMAL' },
      ],
    };
    const s = standing(
      [1, 'MSCU1234566', at(9, 1, 1, 1), 20],
      [2, 'TGHU1234560', at(9, 2, 1, 1), 40],
    );
    const refused = canPlace(withMixed, s, NO_STATES, 40, at(9, 1, 1, 2));
    expect(refused?.code).toBe('BAD_STACK');
    expect(canPlace(withMixed, s, NO_STATES, 20, at(9, 2, 1, 2))).toBeNull();
    expect(canPlace(withMixed, s, NO_STATES, 40, at(9, 2, 1, 2))).toBeNull();
  });

  it('refuses a taken slot and names the occupant', () => {
    const s = standing([1, 'MSCU1234566', at(B20, 1, 1, 1)]);
    const refusal = canPlace(yard, s, NO_STATES, 20, at(B20, 1, 1, 1));
    expect(refusal?.code).toBe('SLOT_TAKEN');
    expect(refusal !== null && 'by' in refusal ? refusal.by : '').toBe('MSCU1234566');
  });

  it('refuses the first tier over empty ground', () => {
    expect(canPlace(yard, [], NO_STATES, 20, at(B20, 1, 1, 2))?.code).toBe('NO_SUPPORT');
  });

  it('accepts the first tier over a standing container', () => {
    const s = standing([1, 'MSCU1234566', at(B20, 1, 1, 1)]);
    expect(canPlace(yard, s, NO_STATES, 20, at(B20, 1, 1, 2))).toBeNull();
  });

  it('a moving container is not its own support', () => {
    // Container 1 stands on the ground; moving IT to the tier above itself
    // must fail, because once it lifts there is nothing underneath.
    const s = standing([1, 'MSCU1234566', at(B20, 1, 1, 1)]);
    expect(canPlace(yard, s, NO_STATES, 20, at(B20, 1, 1, 2), 1)?.code).toBe('NO_SUPPORT');
  });

  it('a moving container does not collide with itself', () => {
    const s = standing([1, 'MSCU1234566', at(B20, 1, 1, 1)]);
    expect(canPlace(yard, s, NO_STATES, 20, at(B20, 1, 1, 1), 1)).toBeNull();
  });
});

describe('location states', () => {
  const withState = (state: 'MAINTENANCE' | 'RESERVED' | 'CLOSED'): SlotStates => ({
    [slotKey(at(B20, 1, 1, 1))]: state,
  });

  it('a MAINTENANCE slot refuses both tiers; CLOSED likewise', () => {
    const s = standing([1, 'MSCU1234566', at(B20, 1, 1, 1)]);
    expect(canPlace(yard, [], withState('MAINTENANCE'), 20, at(B20, 1, 1, 1))?.code).toBe(
      'LOCATION_MAINTENANCE',
    );
    // The slot state covers the air above the stayer too.
    expect(canPlace(yard, s, withState('MAINTENANCE'), 20, at(B20, 1, 1, 2))?.code).toBe(
      'LOCATION_MAINTENANCE',
    );
    expect(canPlace(yard, [], withState('CLOSED'), 20, at(B20, 1, 1, 1))?.code).toBe(
      'LOCATION_CLOSED',
    );
  });

  it('RESERVED places fine — it only paints', () => {
    expect(canPlace(yard, [], withState('RESERVED'), 20, at(B20, 1, 1, 1))).toBeNull();
  });

  it('a blocking BLOCK state covers every slot in it, other blocks untouched', () => {
    const closed: YardConfig = {
      blocks: yard.blocks.map((b) => (b.id === B20 ? { ...b, state: 'CLOSED' as const } : b)),
    };
    expect(canPlace(closed, [], NO_STATES, 20, at(B20, 3, 5, 1))?.code).toBe('LOCATION_CLOSED');
    expect(canPlace(closed, [], NO_STATES, 40, at(B40, 1, 1, 1))).toBeNull();
  });

  it('a stayer in a blocked slot may still be lifted out', () => {
    const s = standing([1, 'MSCU1234566', at(B20, 1, 1, 1)]);
    const stayer = s[0];
    if (stayer === undefined) throw new Error('fixture');
    expect(canLift(s, stayer)).toBeNull();
    // ...and may land on a normal slot elsewhere.
    expect(canPlace(yard, s, withState('MAINTENANCE'), 20, at(B20, 2, 2, 1), 1)).toBeNull();
  });
});

describe('occupancy index', () => {
  it('indexed canPlace answers exactly like the linear scan, everywhere', () => {
    const withMixed: YardConfig = {
      blocks: [
        ...yard.blocks,
        { id: 9, name: 'م', size: 0, rows: 2, cols: 2, x: 900, y: 0, angle: 0, state: 'NORMAL' },
      ],
    };
    const s = standing(
      [1, 'MSCU1234566', at(B20, 1, 1, 1)],
      [2, 'CSQU3054383', at(B20, 1, 1, 2)],
      [3, 'TGHU1234560', at(B40, 2, 1, 1), 40],
      [4, 'ABCU7654325', at(9, 1, 2, 1), 20],
      [5, 'TEST1234567', at(9, 2, 2, 1), 40],
    );
    const occupancy = buildOccupancy(s);

    for (const block of withMixed.blocks) {
      for (let row = 1; row <= block.rows + 1; row += 1) {
        for (let col = 1; col <= block.cols + 1; col += 1) {
          for (let tier = GROUND_TIER; tier <= MAX_TIER; tier += 1) {
            for (const size of [20, 40] as const) {
              for (const ignoreId of [undefined, 1, 4]) {
                const position = at(block.id, row, col, tier as Tier);
                expect(canPlace(withMixed, s, NO_STATES, size, position, ignoreId, occupancy)).toEqual(
                  canPlace(withMixed, s, NO_STATES, size, position, ignoreId),
                );
              }
            }
          }
        }
      }
    }
  });
});

describe('lifting', () => {
  it('refuses to lift a buried container and names what is on top', () => {
    const s = standing(
      [1, 'MSCU1234566', at(B20, 1, 1, 1)],
      [2, 'CSQU3054383', at(B20, 1, 1, 2)],
    );
    const bottom = s[0];
    if (bottom === undefined) throw new Error('fixture');
    const refusal = canLift(s, bottom);
    expect(refusal?.code).toBe('BURIED');
    expect(refusal !== null && 'by' in refusal ? refusal.by : '').toBe('CSQU3054383');
  });

  it('lifts a top container freely', () => {
    const s = standing(
      [1, 'MSCU1234566', at(B20, 1, 1, 1)],
      [2, 'CSQU3054383', at(B20, 1, 1, 2)],
    );
    const top = s[1];
    if (top === undefined) throw new Error('fixture');
    expect(canLift(s, top)).toBeNull();
    expect(containerAbove(s, top)).toBeNull();
  });

  it('a held container never lifts, even a free-standing one', () => {
    const s = standing([1, 'MSCU1234566', at(B20, 1, 1, 1)]);
    const held: Standing = { ...(s[0] as Standing), status: 'HOLD' };
    expect(canLift([held], held)?.code).toBe('CONTAINER_HOLD');
  });

  it('the hold outranks the stack: a buried held container names the hold', () => {
    const s = standing(
      [1, 'MSCU1234566', at(B20, 1, 1, 1)],
      [2, 'CSQU3054383', at(B20, 1, 1, 2)],
    );
    const bottomHeld: Standing = { ...(s[0] as Standing), status: 'HOLD' };
    expect(canLift([bottomHeld, s[1] as Standing], bottomHeld)?.code).toBe('CONTAINER_HOLD');
  });

  it('the other conditions leave lifting alone', () => {
    const s = standing([1, 'MSCU1234566', at(B20, 1, 1, 1)]);
    for (const status of ['DAMAGED', 'REPAIR', 'INSPECT'] as const) {
      const flagged: Standing = { ...(s[0] as Standing), status };
      expect(canLift([flagged], flagged)).toBeNull();
    }
  });
});

describe('layout safety', () => {
  const sizes = (...list: Array<[id: number, size: Size]>): Map<number, Size> => new Map(list);

  const reshape = (rows: number, cols: number): YardConfig => ({
    blocks: yard.blocks.map((b) => (b.id === B20 ? { ...b, rows, cols } : b)),
  });

  it('growth, movement and turning strand nothing', () => {
    const s = standing([1, 'MSCU1234566', at(B20, 3, 5, 1)]);
    const changed: YardConfig = {
      blocks: yard.blocks.map((b) =>
        b.id === B20 ? { ...b, rows: 4, cols: 6, x: 500, y: 900, angle: 45 } : b,
      ),
    };
    expect(strandedByLayout(changed, s, sizes([1, 20]))).toHaveLength(0);
  });

  it('a shrink names exactly the stranded containers', () => {
    const s = standing(
      [1, 'MSCU1234566', at(B20, 3, 5, 1)],
      [2, 'CSQU3054383', at(B20, 1, 1, 1)],
    );
    const stranded = strandedByLayout(reshape(2, 5), s, sizes([1, 20], [2, 20]));
    expect(stranded.map((x) => x.number)).toEqual(['MSCU1234566']);
  });

  it('a vanished block strands its containers', () => {
    const s = standing([1, 'MSCU1234566', at(B20, 1, 1, 1)]);
    const without: YardConfig = { blocks: yard.blocks.filter((b) => b.id !== B20) };
    expect(strandedByLayout(without, s, sizes([1, 20]))).toHaveLength(1);
  });

  it('a size change under standing containers strands them', () => {
    const s = standing([1, 'MSCU1234566', at(B20, 1, 1, 1)]);
    const swapped: YardConfig = {
      blocks: yard.blocks.map((b) => (b.id === B20 ? { ...b, size: 40 as const } : b)),
    };
    expect(strandedByLayout(swapped, s, sizes([1, 20]))).toHaveLength(1);
  });
});
