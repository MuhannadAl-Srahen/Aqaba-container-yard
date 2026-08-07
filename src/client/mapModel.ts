import type { ContainerDto, Position, Size, Tier, YardConfig } from '../shared/types';
import { GROUND_TIER, MAX_TIER } from '../shared/types';
import { positionLabel, slotKey, type BlockNamer } from '../shared/address';
import { canPlace, type Standing } from '../shared/rules';
import { blockTakes } from '../shared/geometry';
import { normalizeNumber } from '../shared/iso6346';

/**
 * Pure map arithmetic, kept out of the components so it can be tested without
 * rendering anything.
 */

export interface SlotStack {
  ground?: ContainerDto;
  upper?: ContainerDto;
}

export function buildStacks(containers: readonly ContainerDto[]): Map<string, SlotStack> {
  const stacks = new Map<string, SlotStack>();
  for (const container of containers) {
    if (container.position === null) continue;
    const key = slotKey(container.position);
    const stack = stacks.get(key) ?? {};
    if (container.position.tier === GROUND_TIER) stack.ground = container;
    else stack.upper = container;
    stacks.set(key, stack);
  }
  return stacks;
}

export function toStanding(containers: readonly ContainerDto[]): Standing[] {
  const standing: Standing[] = [];
  for (const container of containers) {
    if (container.position === null) continue;
    standing.push({
      id: container.id,
      number: container.number,
      size: container.size,
      position: container.position,
    });
  }
  return standing;
}

/**
 * Every position a container of this size may land on right now, keyed
 * `block|row|col|tier`. Used to paint the green targets in moving mode — the
 * SAME rule functions the server runs, so the paint cannot lie.
 */
export function legalTargets(
  yard: YardConfig,
  containers: readonly ContainerDto[],
  size: Size,
  ignoreId?: number,
): Set<string> {
  const standing = toStanding(containers);
  const targets = new Set<string>();

  for (const block of yard.blocks) {
    if (!blockTakes(block.size, size)) continue;
    for (let row = 1; row <= block.rows; row += 1) {
      for (let col = 1; col <= block.cols; col += 1) {
        for (let tier = GROUND_TIER; tier <= MAX_TIER; tier += 1) {
          const position: Position = { block: block.id, row, col, tier: tier as Tier };
          if (canPlace(yard, standing, size, position, ignoreId) === null) {
            targets.add(`${slotKey(position)}|${String(tier)}`);
          }
        }
      }
    }
  }
  return targets;
}

/** Container ids whose number or customer matches the query. */
export function searchMatches(
  containers: readonly ContainerDto[],
  query: string,
): Set<number> {
  const matches = new Set<number>();
  const trimmed = query.trim();
  if (trimmed === '') return matches;

  const asNumber = normalizeNumber(trimmed);
  const lower = trimmed.toLowerCase();

  for (const container of containers) {
    if (
      (asNumber.length > 0 && container.number.includes(asNumber)) ||
      container.customer.toLowerCase().includes(lower)
    ) {
      matches.add(container.id);
    }
  }
  return matches;
}

export interface BlockSummary {
  freeGround: number;
  totalGround: number;
}

export function summarizeBlock(
  block: { id: number; rows: number; cols: number },
  stacks: ReadonlyMap<string, SlotStack>,
): BlockSummary {
  const totalGround = block.rows * block.cols;
  let occupied = 0;
  for (const [key, stack] of stacks) {
    if (key.startsWith(`${String(block.id)}|`) && stack.ground !== undefined) occupied += 1;
  }
  return { freeGround: totalGround - occupied, totalGround };
}

/** A position labeler bound to the state's block names, `؟` for the unknown. */
export function labelerFrom(blockNames: Readonly<Record<string, string>>): (p: Position) => string {
  const nameOf: BlockNamer = (id) => blockNames[String(id)] ?? '؟';
  return (position) => positionLabel(nameOf, position);
}
