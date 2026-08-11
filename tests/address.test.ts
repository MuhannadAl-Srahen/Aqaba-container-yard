import { describe, expect, it } from 'vitest';
import {
  bayLabel,
  baySpan,
  parseAddress,
  positionKey,
  positionLabel,
  samePosition,
} from '../src/shared/address';
import type { Position } from '../src/shared/types';

describe('the official five-part code', () => {
  it('writes the address exactly as the yard says it: يارد-زون-باي-ستاك-طابق', () => {
    expect(positionLabel({ zone: 'A', bay: 3, stack: 1, tier: 'A' })).toBe('2-A-03-01-A');
    expect(positionLabel({ zone: 'D', bay: 17, stack: 5, tier: 'B' })).toBe('2-D-17-05-B');
  });

  it('derives the yard digit — the whole decoded ground is SAHA 2', () => {
    // Yards 1 and 3 are other grounds this system does not model yet, so
    // nothing here ever reads 1- or 3-.
    expect(positionLabel({ zone: 'E', bay: 27, stack: 8, tier: 'B' })).toBe('2-E-27-08-B');
    expect(positionLabel({ zone: 'B', bay: 1, stack: 10, tier: 'A' })).toBe('2-B-01-10-A');
  });

  it('addresses a 40 by the even bay it lies across', () => {
    expect(positionLabel({ zone: 'A', bay: 2, stack: 4, tier: 'A' })).toBe('2-A-02-04-A');
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

/**
 * Reading the code back in. The search box takes it the way it is said over
 * the radio, so this is forgiving on purpose — and strict about the things
 * that would send somebody to the wrong ground.
 */
describe('reading an address back', () => {
  it('reads the full code the yard writes', () => {
    expect(parseAddress('2-E-18-01-A')).toEqual({ yard: 2, zone: 'E', bay: 18, stack: 1, tier: 'A' });
    expect(parseAddress('2-A-03-01-A')).toEqual({ yard: 2, zone: 'A', bay: 3, stack: 1, tier: 'A' });
  });

  it('does not need the yard digit — the zone and the plan decide it', () => {
    expect(parseAddress('E-18-01-A')).toEqual({ zone: 'E', bay: 18, stack: 1, tier: 'A' });
  });

  it('carries the yard digit without judging it — only a layout can do that', () => {
    // Whether 1-E is wrong depends on which yard the plan puts E in, and this
    // file has no plan. It reads the digit; addressMatch decides.
    expect(parseAddress('1-E-18-01-A')).toMatchObject({ yard: 1, zone: 'E' });
    expect(parseAddress('3-A-03-01-A')).toMatchObject({ yard: 3, zone: 'A' });
  });

  it('forgives the separator, the padding and the case', () => {
    const full = { zone: 'E', bay: 18, stack: 1, tier: 'A' };
    expect(parseAddress('e/18/1/a')).toEqual(full);
    expect(parseAddress('E 18 01 A')).toEqual(full);
    expect(parseAddress('  E-18-1-A  ')).toEqual(full);
  });

  it('takes as much as was typed: a bay alone is a fair question', () => {
    expect(parseAddress('E-18')).toEqual({ zone: 'E', bay: 18 });
    expect(parseAddress('E-18-01')).toEqual({ zone: 'E', bay: 18, stack: 1 });
  });

  it('refuses what is not an address at all', () => {
    expect(parseAddress('')).toBeNull();
    expect(parseAddress('TGHU1234567')).toBeNull();
    expect(parseAddress('شركة البحر')).toBeNull();
    // A zone that does not exist, a bay off the end, a tier that is not one.
    expect(parseAddress('X-03-01-A')).toBeNull();
    expect(parseAddress('A-99-01-A')).toBeNull();
    expect(parseAddress('A-03-01-Z')).toBeNull();
    expect(parseAddress('A-03-99-A')).toBeNull();
    // A tier without a stack is half an address.
    expect(parseAddress('A-03--A')).toBeNull();
  });
});
