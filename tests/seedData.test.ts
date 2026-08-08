import { describe, expect, it } from 'vitest';
import type { YardConfig } from '../src/shared/types';
import { buildSeedPlan } from '../src/server/seedData';
import { checkNumber } from '../src/shared/iso6346';
import { positionKey } from '../src/shared/address';
import { blockTakes } from '../src/shared/geometry';

/**
 * The demo plan's invariants: whatever the seed, the seeder must never write
 * a yard the rules and the unique position index would refuse.
 */

const yard: YardConfig = {
  blocks: [
    { id: 1, name: 'A', size: 0, rows: 30, cols: 2, x: 0, y: 0, angle: 0, state: 'NORMAL' },
    { id: 2, name: 'B', size: 20, rows: 30, cols: 2, x: 300, y: 0, angle: 0, state: 'NORMAL' },
    { id: 3, name: 'C', size: 40, rows: 10, cols: 2, x: 600, y: 0, angle: 0, state: 'NORMAL' },
  ],
};

const NOW = new Date('2026-08-08T10:00:00.000Z');

describe('seed plan', () => {
  const plan = buildSeedPlan(42, NOW, yard);
  const standing = plan.containers.filter((c) => c.position !== null);
  const exited = plan.containers.filter((c) => c.exitedAt !== null);

  it('is deterministic for the same seed and differs across seeds', () => {
    const again = buildSeedPlan(42, NOW, yard);
    expect(again).toEqual(plan);
    const other = buildSeedPlan(43, NOW, yard);
    expect(other.containers.map((c) => c.number)).not.toEqual(
      plan.containers.map((c) => c.number),
    );
  });

  it('fills the yard believably: dozens standing, some stacked, some gone', () => {
    expect(standing.length).toBeGreaterThanOrEqual(20);
    expect(standing.some((c) => c.position?.tier === 2)).toBe(true);
    expect(exited.length).toBeGreaterThanOrEqual(3);
    expect(plan.containers.some((c) => c.status !== 'NORMAL')).toBe(true);
    expect(plan.containers.some((c) => !c.numberValid)).toBe(true);
  });

  it('never doubles a position and every stack stands on something legal', () => {
    const seen = new Set<string>();
    const byKey = new Map<string, (typeof standing)[number]>();
    for (const container of standing) {
      if (container.position === null) continue;
      const key = positionKey(container.position);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      byKey.set(key, container);
    }
    for (const container of standing) {
      if (container.position === null || container.position.tier !== 2) continue;
      const below = byKey.get(positionKey({ ...container.position, tier: 1 }));
      expect(below).toBeDefined();
      // Never a 40 on a 20.
      expect(container.size === 40 && below?.size === 20).toBe(false);
    }
  });

  it('respects every block size policy and stays in bounds', () => {
    for (const container of standing) {
      if (container.position === null) continue;
      const block = yard.blocks.find((b) => b.id === container.position?.block);
      expect(block).toBeDefined();
      if (block === undefined) continue;
      expect(blockTakes(block.size, container.size)).toBe(true);
      expect(container.position.row).toBeLessThanOrEqual(block.rows);
      expect(container.position.col).toBeLessThanOrEqual(block.cols);
    }
  });

  it('keeps time coherent: IN.at ≡ enteredAt, movements ordered, exits after entries', () => {
    for (const container of plan.containers) {
      const first = container.movements[0];
      expect(first?.type).toBe('IN');
      expect(first?.at).toBe(container.enteredAt);
      let previous = 0;
      for (const movement of container.movements) {
        const at = new Date(movement.at).getTime();
        expect(at).toBeGreaterThanOrEqual(previous);
        previous = at;
      }
      if (container.exitedAt !== null) {
        expect(new Date(container.exitedAt).getTime()).toBeGreaterThan(
          new Date(container.enteredAt).getTime(),
        );
        expect(container.movements.at(-1)?.type).toBe('OUT');
      }
      expect(new Date(container.enteredAt).getTime()).toBeLessThan(NOW.getTime());
    }
  });

  it('numbers are unique and their validity flags are honest', () => {
    const numbers = plan.containers.map((c) => c.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const container of plan.containers) {
      expect(checkNumber(container.number).valid).toBe(container.numberValid);
    }
  });

  it('card serials count each direction from 1 in gate order', () => {
    const ins = [...plan.containers].sort(
      (a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime(),
    );
    ins.forEach((container, index) => {
      expect(container.cardIn).toBe(index + 1);
    });
    const outs = plan.containers
      .filter((c) => c.exitedAt !== null)
      .sort((a, b) => new Date(a.exitedAt ?? '').getTime() - new Date(b.exitedAt ?? '').getTime());
    outs.forEach((container, index) => {
      expect(container.cardOut).toBe(index + 1);
    });
    expect(plan.cardInNext).toBe(ins.length + 1);
    expect(plan.cardOutNext).toBe(outs.length + 1);
  });
});
