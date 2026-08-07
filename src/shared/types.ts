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
 * One half of the yard, dedicated to one size. A slot in the 40 half is a
 * 40 ft ground position, so EVERY container occupies exactly one slot — the
 * split-yard design is what makes the two-slots-per-40ft bookkeeping of a
 * mixed yard unnecessary. The map still draws 40 ft cells twice as wide.
 */
export interface ZoneConfig {
  /** How many rows of slots. */
  readonly rows: number;
  /** How many slots in each row. */
  readonly cols: number;
}

export interface YardConfig {
  readonly twenty: ZoneConfig;
  readonly forty: ZoneConfig;
}

/** Bounds for the setup form — sanity limits, not capacity assumptions. */
export const MAX_ZONE_ROWS = 40;
export const MAX_ZONE_COLS = 60;

/** A physical position on the ground (or on top of it). */
export interface Position {
  readonly zone: Size;
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
  /** ISO 6346 verdict. Advisory only — an invalid number is never refused. */
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
}

export type MovementType = 'IN' | 'MOVE' | 'OUT' | 'EDIT';

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
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  readonly code: ErrorCode;
  /** Optional machine details (addresses, numbers) for message interpolation. */
  readonly details?: Record<string, string | number>;
}
