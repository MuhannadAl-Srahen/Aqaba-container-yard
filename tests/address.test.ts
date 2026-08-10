import { describe, expect, it } from 'vitest';
import {
  positionKey,
  positionLabel,
  rowNumber,
  samePosition,
  type BlockNamer,
} from '../src/shared/address';

const nameOf: BlockNamer = (id) => (id === 1 ? 'A' : id === 4 ? 'D' : '؟');

describe('labels', () => {
  it('numbers rows in odd steps, zero-padded, the way the ground is marked', () => {
    expect(rowNumber(1)).toBe('01');
    expect(rowNumber(2)).toBe('03');
    expect(rowNumber(3)).toBe('05');
    expect(rowNumber(15)).toBe('29');
    // Past the ninth location the pad stops mattering and never truncates.
    expect(rowNumber(51)).toBe('101');
  });

  it('writes the location the way the yard says it: column, then row', () => {
    expect(positionLabel(nameOf, { block: 1, row: 1 })).toBe('A-01');
    expect(positionLabel(nameOf, { block: 4, row: 22 })).toBe('D-43');
  });

  it('a deleted or unknown column still yields a readable label', () => {
    expect(positionLabel(nameOf, { block: 99, row: 1 })).toBe('؟-01');
  });
});

describe('location identity', () => {
  it('two positions are the same location only in the same column and row', () => {
    expect(samePosition({ block: 1, row: 1 }, { block: 1, row: 1 })).toBe(true);
    expect(samePosition({ block: 1, row: 1 }, { block: 2, row: 1 })).toBe(false);
    expect(samePosition({ block: 1, row: 1 }, { block: 1, row: 2 })).toBe(false);
  });

  it('keys are stable and distinct', () => {
    expect(positionKey({ block: 1, row: 3 })).toBe(positionKey({ block: 1, row: 3 }));
    expect(positionKey({ block: 1, row: 3 })).not.toBe(positionKey({ block: 3, row: 1 }));
    // The separator keeps 1|11 from colliding with 11|1.
    expect(positionKey({ block: 1, row: 11 })).not.toBe(positionKey({ block: 11, row: 1 }));
  });
});
