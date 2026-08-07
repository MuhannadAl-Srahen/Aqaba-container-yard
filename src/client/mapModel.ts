import type { ContainerDto, Position, Size, Tier, YardConfig } from '../shared/types';
import { GROUND_TIER, MAX_TIER } from '../shared/types';
import { slotKey } from '../shared/address';
import { canPlace, type Standing } from '../shared/rules';
import { normalizeNumber } from '../shared/iso6346';
import { zoneOf } from '../shared/rules';

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
    standing.push({ id: container.id, number: container.number, position: container.position });
  }
  return standing;
}

/**
 * Every position a container of this size may land on right now, keyed
 * `zone|row|col|tier`. Used to paint the green targets in moving mode — the
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
  const zone = zoneOf(yard, size);

  for (let row = 1; row <= zone.rows; row += 1) {
    for (let col = 1; col <= zone.cols; col += 1) {
      for (let tier = GROUND_TIER; tier <= MAX_TIER; tier += 1) {
        const position: Position = { zone: size, row, col, tier: tier as Tier };
        if (canPlace(yard, standing, size, position, ignoreId) === null) {
          targets.add(`${slotKey(position)}|${String(tier)}`);
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

export interface ZoneSummary {
  freeGround: number;
  totalGround: number;
}

export function summarizeZone(
  yard: YardConfig,
  stacks: ReadonlyMap<string, SlotStack>,
  zone: Size,
): ZoneSummary {
  const shape = zoneOf(yard, zone);
  const totalGround = shape.rows * shape.cols;
  let occupied = 0;
  for (const [key, stack] of stacks) {
    if (key.startsWith(`${String(zone)}|`) && stack.ground !== undefined) occupied += 1;
  }
  return { freeGround: totalGround - occupied, totalGround };
}
