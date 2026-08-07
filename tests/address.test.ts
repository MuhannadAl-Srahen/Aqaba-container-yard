import { describe, expect, it } from 'vitest';
import { positionLabel, rowLabel, sameSlot, slotKey, slotLabel, tierName } from '../src/shared/address';

describe('row labels', () => {
  it('letters the first rows', () => {
    expect(rowLabel(1)).toBe('A');
    expect(rowLabel(2)).toBe('B');
    expect(rowLabel(26)).toBe('Z');
  });

  it('rolls over past Z', () => {
    expect(rowLabel(27)).toBe('AA');
    expect(rowLabel(28)).toBe('AB');
  });
});

describe('labels', () => {
  it('writes the slot as zone-row-col', () => {
    expect(slotLabel({ zone: 40, row: 3, col: 7 })).toBe('40-C-07');
    expect(slotLabel({ zone: 20, row: 1, col: 12 })).toBe('20-A-12');
  });

  it('names tiers in words', () => {
    expect(tierName(1)).toBe('الأرضي');
    expect(tierName(2)).toBe('الأول');
    expect(positionLabel({ zone: 20, row: 2, col: 5, tier: 2 })).toBe('20-B-05 (الأول)');
  });
});

describe('slot identity', () => {
  it('ignores tier when comparing slots', () => {
    expect(
      sameSlot({ zone: 20, row: 1, col: 1 }, { zone: 20, row: 1, col: 1 }),
    ).toBe(true);
    expect(
      sameSlot({ zone: 20, row: 1, col: 1 }, { zone: 40, row: 1, col: 1 }),
    ).toBe(false);
  });

  it('keys are stable and distinct', () => {
    expect(slotKey({ zone: 20, row: 3, col: 4 })).not.toBe(slotKey({ zone: 20, row: 4, col: 3 }));
  });
});
