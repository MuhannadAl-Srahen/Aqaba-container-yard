import type { BlockConfig, BlockSize } from './types';
import { MIXED_SIZE } from './types';

/**
 * The yard's drawing metrics and the block geometry built on them, shared so
 * the server refuses the same overlaps the editor shows in red. All numbers
 * are "yard units" — pixels at scale 1.
 */

export const CELL_W = 60;
export const CELL_H = 34;
/** A 40 lies ALONG the line, so its slot is twice as tall, plus the gap. */
export const CELL_H_40 = CELL_H * 2 + 7;
export const CELL_GAP = 7;
export const TITLE_H = 40;
export const HEADER_H = 20;
export const LABEL_GUTTER = 26;
export const BLOCK_PAD = 14;

export interface CellSize {
  readonly w: number;
  readonly h: number;
}

/** Slot footprint per block policy; a mixed slot is drawn like a 20's. */
export function cellSize(size: BlockSize): CellSize {
  return size === 40 ? { w: CELL_W, h: CELL_H_40 } : { w: CELL_W, h: CELL_H };
}

export interface Frame {
  readonly width: number;
  readonly height: number;
}

/** The block's full panel box before rotation — title bar, headers and all. */
export function blockFrame(block: Pick<BlockConfig, 'size' | 'rows' | 'cols'>): Frame {
  const cell = cellSize(block.size);
  return {
    width: BLOCK_PAD * 2 + block.cols * (cell.w + CELL_GAP) - CELL_GAP + LABEL_GUTTER,
    height: TITLE_H + HEADER_H + block.rows * (cell.h + CELL_GAP) - CELL_GAP + BLOCK_PAD,
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

/**
 * The first-run shape: one 20 block above one 40 block, right-aligned where
 * reading starts. Setup previews it and the server persists it; the ids here
 * are placeholders the server replaces on insert.
 */
export function defaultLayout(
  twenty: { rows: number; cols: number },
  forty: { rows: number; cols: number },
): BlockConfig[] {
  const frame20 = blockFrame({ size: 20, rows: twenty.rows, cols: twenty.cols });
  const frame40 = blockFrame({ size: 40, rows: forty.rows, cols: forty.cols });
  const width = Math.max(frame20.width, frame40.width);
  const margin = 30;
  return [
    {
      id: 1,
      name: 'منطقة 20',
      size: 20,
      rows: twenty.rows,
      cols: twenty.cols,
      x: width - frame20.width,
      y: 0,
      angle: 0,
      state: 'NORMAL',
    },
    {
      id: 2,
      name: 'منطقة 40',
      size: 40,
      rows: forty.rows,
      cols: forty.cols,
      x: width - frame40.width,
      y: frame20.height + margin,
      angle: 0,
      state: 'NORMAL',
    },
  ];
}
