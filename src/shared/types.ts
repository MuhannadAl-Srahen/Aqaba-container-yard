/**
 * The one vocabulary both sides speak. The server enforces everything here;
 * the client only mirrors checks for a faster answer on screen.
 */

/** The two container sizes this yard receives, in feet. */
export const SIZES = [20, 40] as const;
export type Size = (typeof SIZES)[number];

/**
 * How high the yard stacks: the ground and one on top. A limit of the SITE
 * (its handling equipment), not of the software — raising it is this line.
 */
export const MAX_TIER = 2;
export const GROUND_TIER = 1;
export type Tier = 1 | 2;

/**
 * A block's slot policy: dedicated to one size, or MIXED_SIZE (wire value 0)
 * where each slot takes either size and the container itself carries the
 * truth. One slot holds exactly one container either way — the paper
 * register never gave a 40 two lines, and neither does the map.
 */
export const MIXED_SIZE = 0;
export type BlockSize = Size | typeof MIXED_SIZE;

/**
 * One rectangular block of slots, placed freely on the yard canvas. A slot
 * in a 40 block is a 40 ft ground position drawn twice as TALL — the box
 * lies along the line's direction, exactly as it does on the ground.
 */
export interface BlockConfig {
  /** Stable identity; positions and history refer to it. Assigned by the server. */
  readonly id: number;
  /** The owner's own name for the area, unique among live blocks. */
  readonly name: string;
  readonly size: BlockSize;
  /** How many rows of slots. */
  readonly rows: number;
  /** How many slots in each row. */
  readonly cols: number;
  /** Top-left corner of the unrotated frame, in yard units. */
  readonly x: number;
  readonly y: number;
  /** Degrees clockwise around the frame's centre, snapped to ANGLE_STEP. */
  readonly angle: number;
}

export interface YardConfig {
  readonly blocks: readonly BlockConfig[];
}

/** Bounds for block shapes — sanity limits, not capacity assumptions. */
export const MAX_ZONE_ROWS = 40;
export const MAX_ZONE_COLS = 60;
export const MAX_BLOCKS = 30;
export const MAX_BLOCK_NAME = 40;
/** Rotation granularity: every angle on the wire is a multiple of this. */
export const ANGLE_STEP = 15;

/** A physical position on the ground (or on top of it). */
export interface Position {
  /** The block's id. */
  readonly block: number;
  /** 1-based row, drawn as a letter (A, B, C…). */
  readonly row: number;
  /** 1-based slot within the row. Slot 1 sits at the reading-start edge. */
  readonly col: number;
  readonly tier: Tier;
}

export type CargoState = 'EMPTY' | 'LADEN';

export interface ContainerDto {
  readonly id: number;
  readonly number: string;
  /** Number verdict (ISO or the yard's 4+4 form). Advisory only — never refused. */
  readonly numberValid: boolean;
  readonly size: Size;
  readonly customer: string;
  readonly cargo: CargoState;
  /** ISO timestamps, UTC. */
  readonly enteredAt: string;
  readonly exitedAt: string | null;
  /** Null once the container has left the yard. */
  readonly position: Position | null;
  readonly notes: string;
  /** The gate paperwork. Blank when it was not recorded. */
  readonly weight: string;
  readonly truckIn: string;
  readonly driverIn: string;
  /** Serial of the printed entry card; null on rows from before the cards. */
  readonly cardIn: number | null;
  readonly truckOut: string;
  readonly driverOut: string;
  /** Serial of the exit card; null until the container leaves. */
  readonly cardOut: number | null;
}

/** One row of كشف حركة الدخول/الخروج. */
export interface GateReportRow {
  readonly containerId: number;
  readonly at: string;
  readonly card: number | null;
  readonly truck: string;
  readonly driver: string;
  readonly number: string;
  readonly weight: string;
  readonly size: Size;
  readonly customer: string;
  readonly position: Position | null;
  /** Days in the yard — exits only. */
  readonly dwellDays: number | null;
}

/** One row of the daily movement summary. */
export interface DailyReportRow {
  /** Amman-calendar date, YYYY-MM-DD. */
  readonly date: string;
  readonly inCount: number;
  readonly outCount: number;
  /** Containers standing at the end of that day. */
  readonly standing: number;
}

/** One row of سجل العمليات — every operation on every container, ever. */
export interface LogReportRow {
  readonly containerId: number;
  readonly at: string;
  readonly type: MovementType;
  readonly number: string;
  readonly customer: string;
  readonly from: Position | null;
  readonly to: Position | null;
  readonly note: string;
  /** The record was later soft-deleted as a mistake. */
  readonly deleted: boolean;
}

export type MovementType = 'IN' | 'MOVE' | 'OUT' | 'EDIT' | 'DELETE' | 'RESTORE';

export interface MovementDto {
  readonly id: number;
  readonly type: MovementType;
  readonly at: string;
  readonly from: Position | null;
  readonly to: Position | null;
  readonly note: string;
}

/** Everything the map needs, in one response. */
export interface YardStateDto {
  readonly yard: YardConfig;
  readonly containers: readonly ContainerDto[];
  /** Distinct customer names, for the gate-in suggestions. */
  readonly customers: readonly string[];
  /**
   * Names of ALL blocks ever, keyed by id as a string — history mentions
   * blocks that may have been deleted since, and their names must survive.
   */
  readonly blockNames: Readonly<Record<string, string>>;
}

/**
 * Machine-readable refusals. The client owns the Arabic sentence for each, so
 * the wire never carries display text.
 */
export const ERROR_CODES = [
  'BAD_PASSWORD',
  'UNAUTHORIZED',
  'NOT_SETUP',
  'ALREADY_SETUP',
  'VALIDATION',
  'NOT_FOUND',
  'OUT_OF_BOUNDS',
  'WRONG_ZONE',
  'SLOT_TAKEN',
  'NO_SUPPORT',
  'BURIED',
  'NUMBER_IN_YARD',
  'ALREADY_OUT',
  'SHRINK_OCCUPIED',
  'SAME_SLOT',
  'BLOCK_OVERLAP',
  'BLOCK_NOT_EMPTY',
  'NAME_TAKEN',
  'BAD_STACK',
  'NOT_DELETED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  readonly code: ErrorCode;
  /** Optional machine details (addresses, numbers) for message interpolation. */
  readonly details?: Record<string, string | number>;
}
