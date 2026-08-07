import { describe, expect, it } from 'vitest';
import { buildStacks, labelerFrom, legalTargets, searchMatches, summarizeBlock } from '../src/client/mapModel';
import type { ContainerDto, YardConfig } from '../src/shared/types';

const B20 = 1;
const B40 = 2;

const yard: YardConfig = {
  blocks: [
    { id: B20, name: 'منطقة 20', size: 20, rows: 2, cols: 3, x: 0, y: 0, angle: 0 },
    { id: B40, name: 'منطقة 40', size: 40, rows: 1, cols: 2, x: 0, y: 300, angle: 0 },
  ],
};

function box(
  id: number,
  number: string,
  block: number,
  row: number,
  col: number,
  tier: 1 | 2,
  customer = 'شركة البحر',
): ContainerDto {
  return {
    id,
    number,
    numberValid: true,
    size: block === B40 ? 40 : 20,
    customer,
    cargo: 'LADEN',
    enteredAt: '2026-08-01T08:00:00.000Z',
    exitedAt: null,
    position: { block, row, col, tier },
    notes: '',
    weight: '',
    truckIn: '500',
    driverIn: '',
    cardIn: id,
    truckOut: '',
    driverOut: '',
    cardOut: null,
  };
}

describe('stacks', () => {
  it('pairs ground and upper of the same slot', () => {
    const stacks = buildStacks([
      box(1, 'MSCU1234566', B20, 1, 1, 1),
      box(2, 'CSQU3054383', B20, 1, 1, 2),
    ]);
    const stack = stacks.get('1|1|1');
    expect(stack?.ground?.id).toBe(1);
    expect(stack?.upper?.id).toBe(2);
  });
});

describe('legal targets', () => {
  it('offers empty ground and supported upper slots only', () => {
    const containers = [box(1, 'MSCU1234566', B20, 1, 1, 1)];
    const targets = legalTargets(yard, containers, 20);
    expect(targets.has('1|1|2|1')).toBe(true); // empty ground
    expect(targets.has('1|1|1|2')).toBe(true); // on top of the standing one
    expect(targets.has('1|1|2|2')).toBe(false); // air over empty ground
    expect(targets.has('1|1|1|1')).toBe(false); // taken
    expect(targets.has('2|1|1|1')).toBe(false); // wrong block size
  });

  it('a moving container is removed from its own picture', () => {
    const containers = [box(1, 'MSCU1234566', B20, 1, 1, 1)];
    const targets = legalTargets(yard, containers, 20, 1);
    expect(targets.has('1|1|1|1')).toBe(true); // its own slot is free once it lifts
    expect(targets.has('1|1|1|2')).toBe(false); // and cannot support itself
  });

  it('every same-size block offers targets', () => {
    const wide: YardConfig = {
      blocks: [
        ...yard.blocks,
        { id: 3, name: 'ثالثة', size: 20, rows: 1, cols: 1, x: 900, y: 0, angle: 15 },
      ],
    };
    const targets = legalTargets(wide, [], 20);
    expect(targets.has('3|1|1|1')).toBe(true);
  });
});

describe('search matches', () => {
  it('matches by number fragment however it is typed', () => {
    const containers = [box(1, 'MSCU1234566', B20, 1, 1, 1)];
    expect(searchMatches(containers, 'mscu 12').has(1)).toBe(true);
    expect(searchMatches(containers, '4566').has(1)).toBe(true);
    expect(searchMatches(containers, 'TCLU').has(1)).toBe(false);
  });

  it('matches by customer and returns nothing for a blank query', () => {
    const containers = [box(1, 'MSCU1234566', B20, 1, 1, 1, 'شركة البحر الأحمر')];
    expect(searchMatches(containers, 'البحر').has(1)).toBe(true);
    expect(searchMatches(containers, '  ').size).toBe(0);
  });
});

describe('block summary', () => {
  it('counts free ground per block', () => {
    const stacks = buildStacks([
      box(1, 'MSCU1234566', B20, 1, 1, 1),
      box(2, 'CSQU3054383', B20, 1, 1, 2), // upper tier: not ground
    ]);
    const block20 = yard.blocks[0];
    if (block20 === undefined) throw new Error('fixture');
    const summary = summarizeBlock(block20, stacks);
    expect(summary.totalGround).toBe(6);
    expect(summary.freeGround).toBe(5);
  });
});

describe('labels from state names', () => {
  it('resolves names and survives deleted blocks', () => {
    const label = labelerFrom({ '1': 'المخزن' });
    expect(label({ block: 1, row: 1, col: 2, tier: 1 })).toBe('المخزن2-1-L');
    expect(label({ block: 9, row: 1, col: 2, tier: 2 })).toBe('؟2-1-H');
  });
});
