import { describe, expect, it } from 'vitest';
import {
  positionLabel,
  sameSlot,
  slotKey,
  slotLabel,
  tierLetter,
  tierName,
  type BlockNamer,
} from '../src/shared/address';

const nameOf: BlockNamer = (id) => (id === 1 ? 'A' : id === 2 ? 'B' : '؟');

describe('labels', () => {
  it('writes the slot the way the register does: area+line, then position', () => {
    expect(slotLabel(nameOf, { block: 1, row: 5, col: 1 })).toBe('A1-5');
    expect(slotLabel(nameOf, { block: 2, row: 30, col: 2 })).toBe('B2-30');
  });

  it('the full form carries the tier letter: L ground, H upper', () => {
    expect(positionLabel(nameOf, { block: 1, row: 5, col: 1, tier: 2 })).toBe('A1-5-H');
    expect(positionLabel(nameOf, { block: 1, row: 3, col: 2, tier: 1 })).toBe('A2-3-L');
    expect(tierLetter(1)).toBe('L');
    expect(tierLetter(2)).toBe('H');
  });

  it('a deleted or unknown block still yields a readable label', () => {
    expect(slotLabel(nameOf, { block: 99, row: 1, col: 1 })).toBe('؟1-1');
  });

  it('names tiers in words for the screen toggle', () => {
    expect(tierName(1)).toBe('الأرضي');
    expect(tierName(2)).toBe('الأول');
  });
});

describe('slot identity', () => {
  it('ignores tier when comparing slots', () => {
    expect(sameSlot({ block: 1, row: 1, col: 1 }, { block: 1, row: 1, col: 1 })).toBe(true);
    expect(sameSlot({ block: 1, row: 1, col: 1 }, { block: 2, row: 1, col: 1 })).toBe(false);
  });

  it('keys are stable and distinct', () => {
    expect(slotKey({ block: 1, row: 3, col: 4 })).not.toBe(slotKey({ block: 1, row: 4, col: 3 }));
    expect(slotKey({ block: 1, row: 1, col: 1 })).not.toBe(slotKey({ block: 11, row: 1, col: 1 }));
  });
});
