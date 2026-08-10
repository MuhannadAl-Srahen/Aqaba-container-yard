import { describe, expect, it } from 'vitest';
import { bayLabel, baySpan, positionKey, positionLabel, samePosition } from '../src/shared/address';
import type { Position } from '../src/shared/types';

describe('the official five-part code', () => {
  it('writes the address exactly as the yard says it: يارد-زون-باي-ستاك-طابق', () => {
    expect(positionLabel({ zone: 'A', bay: 3, stack: 1, tier: 'A' })).toBe('1-A-03-01-A');
    expect(positionLabel({ zone: 'D', bay: 17, stack: 5, tier: 'B' })).toBe('1-D-17-05-B');
  });

  it('derives the yard digit from the zone — E is yard 2, nobody types it', () => {
    expect(positionLabel({ zone: 'E', bay: 27, stack: 8, tier: 'B' })).toBe('2-E-27-08-B');
    expect(positionLabel({ zone: 'B', bay: 1, stack: 10, tier: 'A' })).toBe('1-B-01-10-A');
  });

  it('addresses a 40 by the even bay it lies across', () => {
    expect(positionLabel({ zone: 'A', bay: 2, stack: 4, tier: 'A' })).toBe('1-A-02-04-A');
  });

  it('speaks the short bay form for map cells: A-03', () => {
    expect(bayLabel('A', 3)).toBe('A-03');
    expect(bayLabel('E', 27)).toBe('E-27');
  });

  it('spans: a 20 covers its own odd bay, a 40 covers the two around it', () => {
    expect(baySpan(7)).toEqual([7]);
    expect(baySpan(8)).toEqual([7, 9]);
    expect(baySpan(2)).toEqual([1, 3]);
  });

  it('keys and equality tell slots apart to the tier', () => {
    const a: Position = { zone: 'A', bay: 3, stack: 1, tier: 'A' };
    const b: Position = { zone: 'A', bay: 3, stack: 1, tier: 'B' };
    expect(positionKey(a)).toBe('A|3|1|A');
    expect(samePosition(a, { ...a })).toBe(true);
    expect(samePosition(a, b)).toBe(false);
  });
});
