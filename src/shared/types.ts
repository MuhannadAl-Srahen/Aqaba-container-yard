/**
 * The one vocabulary both sides speak. The server enforces everything here;
 * the client only mirrors checks for a faster answer on screen.
 */

/** The two container sizes this yard receives, in feet. */
export const SIZES = [20, 40] as const;
export type Size = (typeof SIZES)[number];

/**
 * A container's footprint inside a location, counted in twenty-foot places.
 * A location is two lanes wide and forty feet deep: four 20s fit (two in
 * front, two behind), or two 40s lying along the lanes.
 */
export const PLACES_20 = 1;
export const PLACES_40 = 2;

/**
 * A block's size policy: dedicated to one size, or MIXED_SIZE (wire value 0)
 * where a location takes either size and each container claims its own
 * places. The policy decides who may enter; the places decide how many.
 */
export const MIXED_SIZE = 0;
export type BlockSize = Size | typeof MIXED_SIZE;

/**
 * One column of locations, placed freely on the yard canvas. The block's
 * name IS the column letter the yard says out loud — A, B, C… — and its
 * locations are numbered 01, 03, 05 down the column.
 */
export interface BlockConfig {
  /** Stable identity; positions and history refer to it. Assigned by the server. */
  readonly id: number;
  /** The owner's own name for the column, unique among live blocks. */
  readonly name: string;
  readonly size: BlockSize;
  /** How many locations the column holds. */
  readonly rows: number;
  /** Twenty-foot places one location takes per tier. A 40 fills two of them. */
  readonly placesPerTier: number;
  /** How high this column stacks. Capacity is placesPerTier × tiers. */
  readonly tiers: number;
  /** Top-left corner of the unrotated frame, in yard units. */
  readonly x: number;
  readonly y: number;
  /** Degrees clockwise around the frame's centre, snapped to ANGLE_STEP. */
  readonly angle: number;
}

export interface YardConfig {
  readonly blocks: readonly BlockConfig[];
}

/** Bounds for block shapes — sanity limits of the site, not of the software. */
export const MAX_LOCATIONS = 60;
export const MAX_PLACES_PER_TIER = 12;
export const MAX_TIERS = 6;
export const MAX_BLOCKS = 30;
export const MAX_BLOCK_NAME = 40;
/** What a fresh column starts as, before the owner shapes it. */
export const DEFAULT_LOCATIONS = 15;
export const DEFAULT_PLACES_PER_TIER = 4;
export const DEFAULT_TIERS = 2;
/** Rotation granularity: every angle on the wire is a multiple of this. */
export const ANGLE_STEP = 15;

/**
 * A location on the ground: where a column crosses a row. Nothing finer —
 * the crew fills it like a basket and the register only says which basket.
 */
export interface Position {
  /** The block's id — the column. */
  readonly block: number;
  /** 1-based location down the column, written 01, 03, 05… */
  readonly row: number;
}

/**
 * What an employee is allowed to do. The owner holds every one of these plus
 * the three that are never granted: the yard editor, employee management and
 * the development tools.
 */
export const PERMISSIONS = ['GATE_IN', 'MOVE', 'GATE_OUT', 'EDIT', 'DELETE', 'REPORTS'] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** The owner is not a row in `users`; this is the id their session carries. */
export const OWNER_ID = 0;

export interface UserDto {
  readonly id: number;
  readonly name: string;
  readonly permissions: readonly Permission[];
}

/** Who is signed in, and what the screen may offer them. */
export interface MeDto {
  readonly id: number;
  readonly name: string;
  readonly owner: boolean;
  readonly permissions: readonly Permission[];
}

export interface ContainerDto {
  readonly id: number;
  readonly number: string;
  /** Number verdict (ISO or the yard's 4+4 form). Advisory only — never refused. */
  readonly numberValid: boolean;
  readonly size: Size;
  readonly customer: string;
  /** ISO timestamps, UTC. */
  readonly enteredAt: string;
  readonly exitedAt: string | null;
  /** Null once the container has left the yard. */
  readonly position: Position | null;
  /** Free text: the condition it arrived in, and anything else worth saying. */
  readonly notes: string;
  /** The gate paperwork. Blank when it was not recorded. */
  readonly weight: string;
  readonly truckIn: string;
  readonly driverIn: string;
  /** The seal (الرصاصة) on the door at the gate — one each way. */
  readonly sealIn: string;
  readonly sealOut: string;
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
  /** The seal of THIS gate moment — entry's on an IN row, exit's on an OUT. */
  readonly seal: string;
  readonly notes: string;
  /** Who worked the gate; «المالك» when the owner did it himself. */
  readonly user: string;
  /** Days in the yard — exits only. */
  readonly dwellDays: number | null;
}

/** One row of كشف الحاويات بالساحة — a snapshot of what is standing now. */
export interface StandingReportRow {
  readonly containerId: number;
  readonly number: string;
  readonly size: Size;
  readonly customer: string;
  readonly position: Position | null;
  readonly seal: string;
  readonly enteredAt: string;
  /** Calendar days from the entry to today. */
  readonly dwellDays: number;
  /** Who received it at the gate. */
  readonly user: string;
  readonly notes: string;
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
  /** Who did it; «المالك» when the owner did it himself. */
  readonly user: string;
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
  'FORBIDDEN',
  'USER_EXISTS',
  'NOT_SETUP',
  'ALREADY_SETUP',
  'VALIDATION',
  'NOT_FOUND',
  'OUT_OF_BOUNDS',
  'WRONG_ZONE',
  'LOCATION_FULL',
  'NUMBER_IN_YARD',
  'ALREADY_OUT',
  'SHRINK_OCCUPIED',
  'CAPACITY_OCCUPIED',
  'SAME_SLOT',
  'BLOCK_OVERLAP',
  'BLOCK_NOT_EMPTY',
  'NAME_TAKEN',
  'NOT_DELETED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  readonly code: ErrorCode;
  /** Optional machine details (addresses, numbers) for message interpolation. */
  readonly details?: Record<string, string | number>;
}
