import type { BlockConfig, BlockSize } from './types';
import { MIXED_SIZE } from './types';

/**
 * The yard's drawing metrics and the block geometry built on them, shared so
 * the server refuses the same overlaps the editor shows in red. All numbers
 * are "yard units" — pixels at scale 1.
 */

/**
 * One location's footprint. The same box in every area: two lanes wide and
 * forty feet deep, whether it holds two 40s lying along the lanes or four
 * 20s two-by-two. Wide enough to carry `A-01` and the count side by side.
 */
export const CELL_W = 110;
export const CELL_H = 46;
export const CELL_GAP = 7;
/**
 * The title block carries two lines — the letter with the size it takes, then
 * how the column is built. Two lines, because one long line spilled out past
 * the panel's own edge and read as a drawing mistake. The panel WIDTH is
 * deliberately unchanged: columns already stand a fixed distance apart in the
 * owner's drawing, and a wider panel would make them collide.
 */
export const TITLE_H = 46;
/** The strip under the title that says what the column's locations hold. */
export const HEADER_H = 22;
export const BLOCK_PAD = 14;

export interface Frame {
  readonly width: number;
  readonly height: number;
}

/** The block's full panel box before rotation — title bar, header and all. */
export function blockFrame(block: Pick<BlockConfig, 'rows'>): Frame {
  return {
    width: BLOCK_PAD * 2 + CELL_W,
    height: TITLE_H + HEADER_H + block.rows * (CELL_H + CELL_GAP) - CELL_GAP + BLOCK_PAD,
  };
}

/** Does this block's policy accept a container of that size? */
export function blockTakes(blockSize: BlockSize, containerSize: 20 | 40): boolean {
  return blockSize === MIXED_SIZE || blockSize === containerSize;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The frame's centre — the point the block rotates around. */
export function blockCenter(block: BlockConfig): Point {
  const frame = blockFrame(block);
  return { x: block.x + frame.width / 2, y: block.y + frame.height / 2 };
}

/** The four corners of the rotated panel, clockwise. */
export function blockCorners(block: BlockConfig): readonly Point[] {
  const frame = blockFrame(block);
  const center = blockCenter(block);
  const rad = (block.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local: Point[] = [
    { x: block.x, y: block.y },
    { x: block.x + frame.width, y: block.y },
    { x: block.x + frame.width, y: block.y + frame.height },
    { x: block.x, y: block.y + frame.height },
  ];
  return local.map((p) => ({
    x: center.x + (p.x - center.x) * cos - (p.y - center.y) * sin,
    y: center.y + (p.x - center.x) * sin + (p.y - center.y) * cos,
  }));
}

/**
 * Do two rotated panels overlap? Separating-axis test on the two rectangles:
 * they are apart exactly when some edge normal of either separates them.
 */
export function blocksOverlap(a: BlockConfig, b: BlockConfig): boolean {
  const cornersA = blockCorners(a);
  const cornersB = blockCorners(b);

  for (const corners of [cornersA, cornersB]) {
    for (let i = 0; i < 4; i += 1) {
      const p1 = corners[i];
      const p2 = corners[(i + 1) % 4];
      if (p1 === undefined || p2 === undefined) continue;
      const axis = { x: p2.y - p1.y, y: p1.x - p2.x };

      let minA = Infinity, maxA = -Infinity;
      for (const p of cornersA) {
        const dot = p.x * axis.x + p.y * axis.y;
        minA = Math.min(minA, dot);
        maxA = Math.max(maxA, dot);
      }
      let minB = Infinity, maxB = -Infinity;
      for (const p of cornersB) {
        const dot = p.x * axis.x + p.y * axis.y;
        minB = Math.min(minB, dot);
        maxB = Math.max(maxB, dot);
      }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

/** Every pair of live blocks that collides, for red outlines and refusals. */
export function overlappingPairs(
  blocks: readonly BlockConfig[],
): ReadonlyArray<readonly [BlockConfig, BlockConfig]> {
  const pairs: Array<readonly [BlockConfig, BlockConfig]> = [];
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      const a = blocks[i];
      const b = blocks[j];
      if (a !== undefined && b !== undefined && blocksOverlap(a, b)) pairs.push([a, b]);
    }
  }
  return pairs;
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The box around every rotated panel — what the map must fit on screen. */
export function yardBounds(blocks: readonly BlockConfig[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const block of blocks) {
    for (const corner of blockCorners(block)) {
      minX = Math.min(minX, corner.x);
      minY = Math.min(minY, corner.y);
      maxX = Math.max(maxX, corner.x);
      maxY = Math.max(maxY, corner.y);
    }
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** What the owner fills in per column on the first run. */
export interface ColumnShape {
  readonly rows: number;
  readonly placesPerTier: number;
  readonly tiers: number;
}

/**
 * The first-run shape: column A for the 20s beside column B for the 40s,
 * laid out from the reading-start edge. Setup previews it and the server
 * persists it; the ids here are placeholders the server replaces on insert.
 */
export function defaultLayout(twenty: ColumnShape, forty: ColumnShape): BlockConfig[] {
  const frame20 = blockFrame(twenty);
  const margin = 30;
  return [
    { id: 1, name: 'A', size: 20, ...twenty, x: 0, y: 0, angle: 0 },
    { id: 2, name: 'B', size: 40, ...forty, x: frame20.width + margin, y: 0, angle: 0 },
  ];
}
