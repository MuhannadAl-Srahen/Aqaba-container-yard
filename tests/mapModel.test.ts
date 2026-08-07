import { describe, expect, it } from 'vitest';
import { buildStacks, legalTargets, searchMatches, summarizeZone } from '../src/client/mapModel';
import type { ContainerDto, YardConfig } from '../src/shared/types';

const yard: YardConfig = { twenty: { rows: 2, cols: 3 }, forty: { rows: 1, cols: 2 } };

function box(
  id: number,
  number: string,
  zone: 20 | 40,
  row: number,
  col: number,
  tier: 1 | 2,
  customer = 'شركة البحر',
): ContainerDto {
  return {
    id,
    number,
    numberValid: true,
    size: zone,
    customer,
    cargo: 'LADEN',
    enteredAt: '2026-08-01T08:00:00.000Z',
    exitedAt: null,
    position: { zone, row, col, tier },
    notes: '',
  };
}

describe('stacks', () => {
  it('pairs ground and upper of the same slot', () => {
    const stacks = buildStacks([
      box(1, 'MSCU1234566', 20, 1, 1, 1),
      box(2, 'CSQU3054383', 20, 1, 1, 2),
    ]);
    const stack = stacks.get('20|1|1');
    expect(stack?.ground?.id).toBe(1);
    expect(stack?.upper?.id).toBe(2);
  });
});

describe('legal targets', () => {
  it('offers empty ground and supported upper slots only', () => {
    const containers = [box(1, 'MSCU1234566', 20, 1, 1, 1)];
    const targets = legalTargets(yard, containers, 20);
    expect(targets.has('20|1|2|1')).toBe(true); // empty ground
    expect(targets.has('20|1|1|2')).toBe(true); // on top of the standing one
    expect(targets.has('20|1|2|2')).toBe(false); // air over empty ground
    expect(targets.has('20|1|1|1')).toBe(false); // taken
    expect(targets.has('40|1|1|1')).toBe(false); // wrong zone
  });

  it('a moving container is removed from its own picture', () => {
    const containers = [box(1, 'MSCU1234566', 20, 1, 1, 1)];
    const targets = legalTargets(yard, containers, 20, 1);
    expect(targets.has('20|1|1|1')).toBe(true); // its own slot is free once it lifts
    expect(targets.has('20|1|1|2')).toBe(false); // and cannot support itself
  });
});

describe('search matches', () => {
  it('matches by number fragment however it is typed', () => {
    const containers = [box(1, 'MSCU1234566', 20, 1, 1, 1)];
    expect(searchMatches(containers, 'mscu 12').has(1)).toBe(true);
    expect(searchMatches(containers, '4566').has(1)).toBe(true);
    expect(searchMatches(containers, 'TCLU').has(1)).toBe(false);
  });

  it('matches by customer and returns nothing for a blank query', () => {
    const containers = [box(1, 'MSCU1234566', 20, 1, 1, 1, 'شركة البحر الأحمر')];
    expect(searchMatches(containers, 'البحر').has(1)).toBe(true);
    expect(searchMatches(containers, '  ').size).toBe(0);
  });
});

describe('zone summary', () => {
  it('counts free ground per zone', () => {
    const stacks = buildStacks([
      box(1, 'MSCU1234566', 20, 1, 1, 1),
      box(2, 'CSQU3054383', 20, 1, 1, 2), // upper tier: not ground
    ]);
    const summary = summarizeZone(yard, stacks, 20);
    expect(summary.totalGround).toBe(6);
    expect(summary.freeGround).toBe(5);
  });
});
