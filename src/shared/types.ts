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
/**
 * A zone name. The official plan paints A…E; the owner's own zones (in his
 * yards 1 and 3, or added beside the plan) carry whatever letter he gives
 * them — so the type is open, and the LAYOUT is the judge of what exists.
 */
export type Zone = string;

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
 * الزون الذي يعرّفه المالك بنفسه: في ساحة من ساحاته (1، 3…) أو بجانب
 * المخطط الرسمي. شبكة بايات فردية للعشرينات وستاكات، وثلاثة طوابق دائماً —
 * وما أغلقه المالك من خانات (bay, stack) يمنع الوضع فيه كما تفعل حوائط
 * الساحة 2 تماماً.
 */
export interface CustomZoneDto {
  readonly id: number;
  readonly yard: number;
  /** The letter painted on the ground — unique across every yard. */
  readonly zone: string;
  /** How many twenty-foot bays: bays 1, 3, 5 … (2n−1). */
  readonly bays: number;
  /** How many stacks across the strip: 1 … n. */
  readonly stacks: number;
  /** Ground slots the owner closed, as [oddBay, stack] pairs. */
  readonly closed: ReadonlyArray<readonly [number, number]>;
  /** Where he parked it on the drawing; null = lined up automatically. */
  readonly x: number | null;
  readonly y: number | null;
}

/** A struck zone's surviving fact: its letter still names the yard it was in. */
export interface RetiredZoneDto {
  readonly zone: string;
  readonly yard: number;
}

/**
 * صورة حاوية — the bytes live in the database itself so the backup carries
 * them with everything else; the wire lists the facts and serves the bytes
 * by id.
 */
export interface PhotoDto {
  readonly id: number;
  readonly mime: string;
  readonly size: number;
  readonly at: string;
}

export type HaulDirection = 'IN' | 'OUT';

/**
 * نقلة سائق — one gate movement with a named driver, the unit the owner
 * pays: a manual figure per haul (no currency, his call), and a receipt
 * confirmation per haul, because one truck may haul many times.
 */
export interface DriverHaulRow {
  readonly containerId: number;
  readonly direction: HaulDirection;
  readonly number: string;
  readonly size: Size;
  readonly bill: string;
  readonly truck: string;
  readonly driver: string;
  readonly at: string;
  readonly card: number | null;
  readonly cardYear: number | null;
  readonly amount: number | null;
  readonly paidAt: string | null;
  readonly paidBy: string | null;
}

/**
 * أجر على سجل محذوف — a figure written, or even paid, for a haul whose record
 * was struck afterwards. The statement lists live hauls only, so without
 * this the figure would sit on nothing, unseen, for ever. Shown so it can be
 * voided; the money side of a paid one is the owner's to settle.
 */
export interface OrphanWageRow {
  readonly containerId: number;
  readonly direction: HaulDirection;
  readonly number: string;
  readonly truck: string;
  readonly driver: string;
  /** The haul's own instant — entry or exit. */
  readonly at: string;
  readonly amount: number;
  readonly paidAt: string | null;
  readonly paidBy: string | null;
  /** When the record was struck. */
  readonly deletedAt: string;
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
export const PERMISSIONS = [
  'GATE_IN',
  'MOVE',
  'GATE_OUT',
  'EDIT',
  'DELETE',
  'REPORTS',
  'ACCOUNTING',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** The owner is not a row in `users`; this is the id their session carries. */
export const OWNER_ID = 0;

export interface UserDto {
  readonly id: number;
  readonly name: string;
  readonly permissions: readonly Permission[];
  /**
   * أي آلية يقودها هذا الحساب: '' = حساب مكتب. A non-empty machine marks a
   * DRIVER account — the tablet lands on that machine's task queue and its
   * session lasts a whole shift instead of the office hour.
   */
  readonly machine: Handling | '';
}

/** Who is signed in, and what the screen may offer them. */
export interface MeDto {
  readonly id: number;
  readonly name: string;
  readonly owner: boolean;
  readonly permissions: readonly Permission[];
  /** The signed-in account's machine; '' for office accounts and the owner. */
  readonly machine: Handling | '';
}

/**
 * مهام الآليات — the WhatsApp photo group, replaced: a task is born the
 * instant the gate acts and appears on the machine's tablet. IN = a received
 * container to be stacked at its slot; OUT = a تجهيز — fetch it to the truck.
 */
export const TASK_KINDS = ['IN', 'OUT'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = ['PENDING', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Why a task closed without a driver's «تم» — codes on the wire, Arabic in
 * ar.ts alone: closed by the exit being recorded, by the exit being undone,
 * or by the container's record being struck.
 */
export const TASK_CLOSE_NOTES = ['AUTO_EXIT', 'AUTO_RETURN', 'AUTO_DELETE'] as const;
export type TaskCloseNote = (typeof TASK_CLOSE_NOTES)[number];

export interface TaskDto {
  readonly id: number;
  readonly kind: TaskKind;
  readonly containerId: number;
  readonly machine: Handling;
  readonly urgent: boolean;
  readonly status: TaskStatus;
  readonly createdAt: string;
  /** Resolved name label, the way report rows carry `user`. */
  readonly createdBy: string;
  readonly doneAt: string | null;
  readonly doneBy: string | null;
  readonly closedNote: TaskCloseNote | '';
  /** Exit-born OUT tasks carry the plate the box leaves on. */
  readonly truck: string;
  // The container as the driver needs it, joined server-side:
  readonly number: string;
  readonly size: Size;
  readonly bill: string;
  readonly notes: string;
  /** As the scale ticket was copied at the gate — «ضع الوزن ايضا عند المهام». */
  readonly weight: string;
  /** The live slot while it stands; the birth snapshot once it no longer does. */
  readonly position: Position | null;
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

/** فردية أو على كشف — what the gate was told about the bill. */
export type BillKind = 'SINGLE' | 'MANIFEST';

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
  /**
   * «أسأل الموظف عند الإدخال»: is this bill a lone container (فردية) or a
   * manifest with more coming (على كشف)? The gate asks, so the first box of
   * a big bill is never mistaken for a single. Null on records from before
   * the question existed.
   */
  readonly billKind: BillKind | null;
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
  /**
   * بطاقة ملغاة — a serial the register would otherwise skip: its record was
   * struck out, or its paper was voided by «إلغاء الخروج». The owner's rule:
   * «اريد ارجاع البطاقة لكي لا يختل الرقم التسلسلي ولكن محتوياتها اصفار».
   * The row carries the NUMBER and nothing else, so the count runs 1, 2, 3
   * down the page with no hole and no invented content.
   */
  readonly voided?: boolean;
}

/**
 * One card's worth of DATA for the owner's bulk printing — «بدي طريقة اطبع
 * جميع بطاقات الدخول مره واحدة». The server hands only facts; the client
 * writes the Arabic card around them, because Arabic lives in ar.ts alone.
 * One shape serves all three papers; fields a kind does not use are null
 * or empty.
 */
export interface CardSheetRow {
  readonly containerId: number;
  readonly number: string;
  /** The card's serial and its counting year — the sort order of the file. */
  readonly serial: number | null;
  readonly serialYear: number | null;
  /** The moment the paper is about: the gate moment, or the lift itself. */
  readonly at: string;
  readonly bill: string;
  readonly size: Size;
  readonly weight: string;
  readonly seal: string;
  readonly notes: string;
  /** Always the date it went INTO store — the exit card shows it too. */
  readonly enteredAt: string;
  /** Crane or straddle — the entry card alone carries it. */
  readonly handling: Handling | null;
  /** Empty on a move card: nothing left the yard. */
  readonly truck: string;
  readonly driver: string;
  /** Who did the paperwork this card is about — printed on the entry card. */
  readonly user: string;
  /** Entry/exit cards: where it stands — or the slot it left from. */
  readonly slot: Position | null;
  /** Move cards only: the two slots the paper exists to name. */
  readonly from: Position | null;
  readonly to: Position | null;
  /** Move cards: the raw note whose JSON lists the drops that came down. */
  readonly note: string;
  /** Entry cards: the photos that can ride as pages, by id. */
  readonly photoIds: readonly number[];
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
 * كشف إنتاجية الآليات: one row per (machine, hand that finished) over the
 * period — how many entry and تجهيز tasks each closed, and how quickly.
 * Auto-closed tasks (exit/return/delete) are nobody's work and stay out.
 */
export interface MachineReportRow {
  readonly machine: Handling;
  /** Who pressed «تم» — a driver's name, or whoever closed it by hand. */
  readonly doer: string;
  readonly inDone: number;
  readonly outDone: number;
  readonly total: number;
  /** Mean minutes from the order's birth to its «تم»; null when unknowable. */
  readonly avgMinutes: number | null;
}

/**
 * دفعات كشف الجمارك: the transfer sheet («نقل حاويات إلى مديرية التخزين —
 * دفعة N») uploaded as a file and kept as the paper's literal mirror. A row
 * stores what the sheet said — nothing more — and whether that container has
 * arrived is COMPUTED against the yard book by number, never stored, so the
 * registry can never disagree with the ground.
 */
export const BATCH_ROW_STATUSES = ['PENDING', 'STANDING', 'EXITED'] as const;
export type BatchRowStatus = (typeof BATCH_ROW_STATUSES)[number];

export interface BatchSummaryDto {
  readonly id: number;
  readonly name: string;
  readonly filename: string;
  readonly createdAt: string;
  /** Resolved label — who uploaded it; the owner's role label for the owner. */
  readonly createdBy: string;
  readonly total: number;
  /** Rows whose number stands in the yard book (standing or exited). */
  readonly arrived: number;
}

export interface BatchRowDto {
  readonly id: number;
  /** The sheet's own «#» counter; null when the sheet carried none. */
  readonly seq: number | null;
  /** Normalized as the gate normalizes, so the two books join by equality. */
  readonly number: string;
  /** 20/40 — or null when the sheet wrote something else (see sizeRaw). */
  readonly size: Size | null;
  /** The size cell exactly as the sheet wrote it («45» stays «45»). */
  readonly sizeRaw: string;
  readonly bill: string;
  /** The shipping line column, when the sheet carries one (WHL, PIL…). */
  readonly lineOp: string;
  readonly status: BatchRowStatus;
  /** The yard-book record behind the status; null while لم تصل. */
  readonly containerId: number | null;
  readonly enteredAt: string | null;
  readonly exitedAt: string | null;
}

export interface BatchDto {
  readonly id: number;
  readonly name: string;
  readonly filename: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly rows: readonly BatchRowDto[];
}

/** What the gate's live lookup answers for a typed number: the sheet's word. */
export interface BatchMatch {
  readonly batchId: number;
  readonly batchName: string;
  readonly size: Size | null;
  readonly bill: string;
}

/**
 * تصريح خروج من الساحة: the paper the yard issues for one bill of
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
  /** الوزن كما كُتب لحظة الإصدار — part of the stamped snapshot. */
  readonly weight: string;
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
  /** The yard the paper names — pinned at issue time like every other fact. */
  readonly yard: number;
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
  /**
   * Who did it — the resolved name label, the way report rows carry `user`.
   * The gate card prints it: «أسم الموظف الي عمل المعاملة او الأدخال».
   */
  readonly user: string;
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
  /**
   * NOT a refusal: the server itself broke. It wore `VALIDATION` for a long
   * time, so every fault in the application reached the office as «توجد
   * بيانات ناقصة أو غير صحيحة» and sent the owner hunting a field that was
   * never wrong. A fault must never blame the person typing.
   */
  'SERVER_FAULT',
  /**
   * تصحيح الفئة: something is standing ON this container, so changing what it
   * IS would change what THEY stand on. `details.other` names one of them.
   * Not `MOVE_BURIED`, which means «you may not correct a move while it holds
   * others up» — a different sentence about a different act.
   */
  'RECLASS_BURIED',
  /**
   * A reclass moves no steel: the zone, the stack and the tier are invariant
   * and the bay moves by exactly one. Unreachable from the screen; it exists
   * so a hand-made request is not answered with a sentence about walls.
   */
  'NOT_ADJACENT_BAY',
  /**
   * إلغاء الخروج / الاسترجاع: the slot the record remembers has the wrong
   * parity for the class it now carries. A belt-and-braces guard — `/reclass`
   * keeps the remembered slot in step — that turns a mystifying `BAD_SLOT`
   * into a sentence naming its own cause.
   */
  'RETURN_SIZE_CHANGED',
  /**
   * The four refusals below used to share the single `VALIDATION` code, so
   * every one of them reached the user as «توجد بيانات ناقصة أو غير صحيحة»
   * and none of them said WHICH rule was broken — «بقول المعلومات غير كاملة
   * او غير صحيحة». A refusal owes the cause and the remedy.
   */
  /** Exit paperwork offered on a container that is still standing. */
  'EXIT_ON_STANDING',
  /** A departed record may not lose its exit date or its exit plate. */
  'EXIT_PAPERS_MISSING',
  /** A gate instant later than now — the register would carry a row from a day that has not happened. */
  'TIME_IN_FUTURE',
  /** An exit earlier than the entry it belongs to. */
  'EXIT_BEFORE_ENTRY',
  'NUMBER_IN_YARD',
  'ALREADY_OUT',
  /** A pending تجهيز task already stands on this container. */
  'TASK_EXISTS',
  /** The task was already done or auto-closed; the screen is behind. */
  'TASK_CLOSED',
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
  /**
   * The zone still holds standing containers where the change would leave
   * them without ground — a delete, a shrink, or a closed slot under a box.
   * Move the containers first.
   */
  'ZONE_HAS_CONTAINERS',
  /** A live truck with this very plate is already registered. */
  'TRUCK_EXISTS',
  /** A carrier still holding trucks cannot be struck out. */
  'CARRIER_HAS_TRUCKS',
  /** Correction reaches only the LAST move; an older wrong move needs a new move. */
  'NOT_LAST_MOVE',
  /** The record shows others resting on this box — a correction moves no steel. */
  'MOVE_BURIED',
  /** النقل الجماعي: an outsider stands on one of the selected containers. */
  'GROUP_BURIED',
  /** النقل الجماعي: the destination bay takes only part of the group. */
  'GROUP_NO_ROOM',
  /** A container carries at most 30 photos. */
  'PHOTO_LIMIT',
  /** A settled haul's wage is locked until the receipt confirmation is lifted. */
  'WAGE_PAID',
  /** Receipt cannot be confirmed before a wage is written. */
  'WAGE_MISSING',
  /** دفعات كشف الجمارك: the file is a scan — pictures, not letters. OCR guesses, and one wrong character is a catastrophe, so the original Excel/Word must be asked for. */
  'SHEET_SCANNED',
  /** Old binary Excel (.xls) cannot be read literally; re-save as xlsx. */
  'SHEET_OLD_EXCEL',
  /** Not a format the reader can take literally (xlsx/docx/csv) — or a CSV in a non-UTF-8 codepage, refused rather than mis-decoded. */
  'SHEET_UNREADABLE',
  /** The file was read and no container-number column was found in it. */
  'SHEET_EMPTY',
  /** More rows than any one دفعة carries — split the file. */
  'SHEET_TOO_BIG',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  readonly code: ErrorCode;
  /** Optional machine details (addresses, numbers) for message interpolation. */
  readonly details?: Record<string, string | number>;
}
