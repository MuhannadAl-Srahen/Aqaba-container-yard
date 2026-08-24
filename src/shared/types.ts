/**
 * The one vocabulary both sides speak. The server enforces everything here;
 * the client only mirrors checks for a faster answer on screen.
 *
 * Since schema v9 the yard is the official ASEZA yard: the ground truth lives
 * in `asezaLayout.ts`, generated from the authority's own drawing and locked
 * by tests to its printed totals (A+B+C+D = 571, E = 110, TOTAL = 681 — all
 * of it SAHA 2; yards 1 and 3 are other grounds, not modelled yet).
 */

/** The two container sizes this yard receives, in feet. */
export const SIZES = [20, 40] as const;
export type Size = (typeof SIZES)[number];

/** The five zones of the official plan, all of them inside SAHA 2. */
export const ZONES = ['A', 'B', 'C', 'D', 'E'] as const;
export type Zone = (typeof ZONES)[number];

/**
 * What lifted the container off the truck: a crane or a straddle carrier.
 * Recorded once, at the gate, and printed on the ENTRY CARD alone — the
 * owner's instruction: «بدي اياها تبين ب ورقة الدخول فقط». It is deliberately
 * absent from every register.
 */
export const HANDLING = ['CRANE', 'STRADDLE'] as const;
export type Handling = (typeof HANDLING)[number];

/**
 * Three tiers: A on the ground, B over it, and C — the reserve floor the
 * owner asked for («طابق 3 للكل احتياط») — on top of B.
 */
export const TIERS = ['A', 'B', 'C'] as const;
export type Tier = (typeof TIERS)[number];

/** The tier physically under this one; null on the ground. */
export function tierBelow(tier: Tier): Tier | null {
  const index = TIERS.indexOf(tier);
  return index <= 0 ? null : (TIERS[index - 1] ?? null);
}

/** The tier physically above this one; null at the top of the stack. */
export function tierAbove(tier: Tier): Tier | null {
  const index = TIERS.indexOf(tier);
  return index >= TIERS.length - 1 ? null : (TIERS[index + 1] ?? null);
}

/**
 * Which yard a zone belongs to — the address digit nobody types by hand.
 *
 * Every zone this system knows is in SAHA 2: the whole decoded drawing is
 * that one ground, and the owner's yards 1 and 3 are separate grounds it does
 * not model yet. So every address reads `2-…`. When another yard is decoded,
 * this stops being a constant and starts reading the zone's own layout entry.
 */
export function yardOf(_zone: Zone): number {
  return 2;
}

/**
 * The bay's parity IS the container size: an odd bay takes a 20-footer; an
 * even bay is a 40-footer lying across the two odd bays around it (a 40 over
 * bays 01 and 03 is addressed as bay 02).
 */
export function sizeOfBay(bay: number): Size {
  return bay % 2 === 1 ? 20 : 40;
}

/**
 * One exact slot on the official grid: the five-part code the yard writes as
 * `1-A-03-01-A` — yard (derived from the zone), zone, bay, stack, tier.
 * Tracking is precise to this slot; «الغلط صفر» was the owner's brief.
 */
export interface Position {
  readonly zone: Zone;
  /** Odd for a 20; even for a 40 straddling bay−1 and bay+1. */
  readonly bay: number;
  /** 1…10 across the strip; the walls clip some (they are not in the layout). */
  readonly stack: number;
  readonly tier: Tier;
}

/** A rectangle on the yard canvas, in yard units. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One zone as the official drawing defines it. */
export interface ZoneDef extends Rect {
  readonly zone: Zone;
  readonly yard: number;
  /** The odd bay numbers, in drawing order. */
  readonly bays: readonly number[];
  /** Usable stacks per odd bay, keyed by the bay number as a string. */
  readonly stacks: Readonly<Record<string, readonly number[]>>;
}

/** Orientation marks from the printed plan — nothing stands on them. */
export type LandmarkKind = 'hangar' | 'building' | 'tower' | 'caravan';
export interface Landmark extends Rect {
  readonly kind: LandmarkKind;
  readonly label: string;
}

/** The whole official yard: the decoded zones plus the landmarks. */
export interface YardLayout {
  readonly zones: readonly ZoneDef[];
  readonly landmarks: readonly Landmark[];
}

/**
 * What an employee is allowed to do. The owner holds every one of these plus
 * the two that are never granted: employee management and the reset tools.
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

/**
 * ناقل: the trucking company whose fleet serves the yard. Soft-deleted like
 * everything else — an old register still names who carried the box.
 */
export interface CarrierDto {
  readonly id: number;
  readonly name: string;
}

/**
 * One registered truck of one carrier. `code` is the plate's ترميز — the
 * category prefix Jordanian plates carry (the owner's fleet reads 60) — and
 * `driver` is the driver usually behind its wheel, offered to the gate as a
 * suggestion, never forced.
 */
export interface TruckDto {
  readonly id: number;
  readonly carrierId: number;
  readonly code: string;
  readonly number: string;
  readonly driver: string;
}

/** The whole registry in one answer: who the carriers are and what they run. */
export interface FleetDto {
  readonly carriers: readonly CarrierDto[];
  readonly trucks: readonly TruckDto[];
}

/**
 * A plate the gate has recorded that matches no registered truck yet — the
 * raw material of «توزيع السيارات»: the owner assigns each to its carrier.
 */
export interface UnassignedPlateRow {
  /** The most recent spelling the gate used. */
  readonly plate: string;
  readonly trips: number;
  /** The most recent driver name typed alongside it, if any. */
  readonly driver: string;
}

export interface ContainerDto {
  readonly id: number;
  readonly number: string;
  /** Number verdict (ISO or the yard's 4+4 form). Advisory only — never refused. */
  readonly numberValid: boolean;
  readonly size: Size;
  /**
   * رقم البوليصة — the bill of lading this container travels under. One bill
   * gathers a group of containers (twenties and forties mixed); blank when
   * none was recorded.
   */
  readonly bill: string;
  /** ISO timestamps, UTC. */
  readonly enteredAt: string;
  readonly exitedAt: string | null;
  /** Null once the container has left the yard. */
  readonly position: Position | null;
  /** Free text: the condition it arrived in, and anything else worth saying. */
  readonly notes: string;
  /** الوزن — as the scale ticket reads it. Blank when unrecorded. */
  readonly weight: string;
  /** Crane or straddle. Null on records from before the field existed. */
  readonly handling: Handling | null;
  readonly truckIn: string;
  readonly driverIn: string;
  /**
   * الرصاصة on the door, recorded once at entry. The exit stopped asking for
   * a second one, so this is the container's seal wherever it is shown.
   */
  readonly sealIn: string;
  /**
   * Serial of the printed entry card; null on rows from before the cards.
   * The count starts again at 1 every January, so a serial only identifies a
   * card together with the year it was issued in — hence the pair.
   */
  readonly cardIn: number | null;
  readonly cardInYear: number | null;
  readonly truckOut: string;
  readonly driverOut: string;
  /** Serial of the exit card; null until the container leaves. */
  readonly cardOut: number | null;
  readonly cardOutYear: number | null;
}

/** Up to four places, then the year it belongs to: «0091/2026». */
export function cardSerial(number: number | null, year: number | null): string | null {
  if (number === null) return null;
  const padded = String(number).padStart(4, '0');
  return year === null ? padded : `${padded}/${String(year)}`;
}

/** One row of كشف حركة الدخول/الخروج. */
export interface GateReportRow {
  readonly containerId: number;
  readonly at: string;
  /** The card's serial and the year that serial counts within. */
  readonly card: number | null;
  readonly cardYear: number | null;
  readonly truck: string;
  readonly driver: string;
  readonly number: string;
  readonly weight: string;
  readonly size: Size;
  readonly bill: string;
  /**
   * Where the container IS, not where it was put down: a box carried across
   * the yard has to be findable from the sheet that names it. Null only for
   * one that has left, where it is the slot it left from.
   */
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
  readonly bill: string;
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

/**
 * تصريح تحميل وخروج داخلي: the paper مؤسسة الحق issues for one bill of
 * lading — permission to load the containers listed on it out of the yard
 * and into موقع المقص only. A numbered ledger of its own, counted per year
 * like the gate cards, and the paper itself carries the storage-directorate
 * signature block. Issuing one changes nothing on the ground: the actual
 * departures are still recorded at the gate, container by container.
 */
export interface PermitItemDto {
  readonly containerId: number;
  readonly number: string;
  /** سند بطاقة الإدخال — the entry card's serial and its year. */
  readonly cardIn: number | null;
  readonly cardInYear: number | null;
  readonly enteredAt: string;
  /**
   * For the paper's totals line, the bill sheet's own «n حاوية — عشرين ·
   * أربعين». Read live rather than snapshotted, which is safe for this one
   * fact alone: a container's size is locked for life (SIZE_LOCKED).
   */
  readonly size: Size;
  /** The truck that will carry this container out; blank = written by hand. */
  readonly truck: string;
}

export interface PermitDto {
  readonly id: number;
  readonly serial: number;
  readonly serialYear: number;
  readonly bill: string;
  readonly at: string;
  readonly user: string;
  readonly items: readonly PermitItemDto[];
}

/** One row of كشف خروج وتحميل داخلي. */
export interface PermitReportRow {
  readonly id: number;
  readonly serial: number;
  readonly serialYear: number;
  readonly at: string;
  readonly bill: string;
  readonly containers: number;
  readonly user: string;
}

/** One row of سجل العمليات — every operation on every container, ever. */
export interface LogReportRow {
  readonly containerId: number;
  readonly at: string;
  readonly type: MovementType;
  readonly number: string;
  readonly from: Position | null;
  readonly to: Position | null;
  readonly note: string;
  /** Who did it; «المالك» when the owner did it himself. */
  readonly user: string;
  /** The record was later soft-deleted as a mistake. */
  readonly deleted: boolean;
}

/**
 * `DROP` is gravity, not a person: when a container is lifted out, everything
 * resting on it comes down one tier, and each of those descents is its own
 * movement so the log never claims a member of staff moved a box they never
 * touched. Its `note` carries the number of the container whose removal
 * caused the descent.
 */
/** RETURN: an exit taken back — the container never left after all. */
export type MovementType =
  | 'IN'
  | 'MOVE'
  | 'DROP'
  | 'OUT'
  | 'EDIT'
  | 'DELETE'
  | 'RESTORE'
  | 'RETURN';

export interface MovementDto {
  readonly id: number;
  readonly type: MovementType;
  readonly at: string;
  readonly from: Position | null;
  readonly to: Position | null;
  readonly note: string;
  /**
   * The serial of the printed card this movement produced, and the year that
   * count runs in. Only a MOVE has one: the crane is handed a paper saying
   * which container goes from which slot to which. Everything else is null.
   */
  readonly card: number | null;
  readonly cardYear: number | null;
}

/**
 * Everything the map needs, in one response. The yard's shape is NOT here —
 * the official layout is compiled into both sides as `ASEZA`.
 */
export interface YardStateDto {
  readonly containers: readonly ContainerDto[];
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
  /** The slot does not exist on the official plan (wall, parity, bad zone). */
  'BAD_SLOT',
  /** Somebody is already standing exactly there. */
  'OCCUPIED',
  /** Tier B with nothing (or the wrong thing) underneath. */
  'NO_SUPPORT',
  /**
   * Lifting this one out would leave the container above it with nowhere to
   * land — the classic case is a 40 bridging two 20s when only one of the two
   * is being removed. `details.other` names the container to relocate first.
   */
  'BLOCKED_DESCENT',
  'SAME_SLOT',
  'NUMBER_IN_YARD',
  'ALREADY_OUT',
  'NAME_TAKEN',
  'NOT_DELETED',
  /** Asked to take back an exit for a container that is standing in the yard. */
  'NOT_EXITED',
  /**
   * The class is fixed for the life of the record: a 40 occupies two slots
   * and a 20 one, so changing it after the fact would falsify the ground.
   * To change it: strike the record out and receive the container again.
   */
  'SIZE_LOCKED',
  /** The uploaded restore file is not a yard backup this version can read. */
  'BAD_BACKUP',
  /** A live truck with this very plate is already registered. */
  'TRUCK_EXISTS',
  /** A carrier still holding trucks cannot be struck out. */
  'CARRIER_HAS_TRUCKS',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  readonly code: ErrorCode;
  /** Optional machine details (addresses, numbers) for message interpolation. */
  readonly details?: Record<string, string | number>;
}
