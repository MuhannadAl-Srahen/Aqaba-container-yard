import type { DatabaseSync } from 'node:sqlite';
import type {
  BatchDto,
  BatchMatch,
  BatchRowDto,
  BatchRowStatus,
  BatchSummaryDto,
  BillKind,
  CardSheetRow,
  CarrierDto,
  ContainerDto,
  CustomZoneDto,
  DriverHaulRow,
  GateCallRow,
  HaulDirection,
  PermitDto,
  PermitReportRow,
  PhotoDto,
  RetiredZoneDto,
  Handling,
  LogReportRow,
  MachineReportRow,
  OrphanWageRow,
  MovementDto,
  MovementType,
  Permission,
  Position,
  Size,
  TaskCloseNote,
  TaskDto,
  TaskKind,
  TaskStatus,
  Tier,
  TruckDto,
  UserDto,
  Zone,
} from '../shared/types';
import { HANDLING, OWNER_ID, PERMISSIONS } from '../shared/types';
import type { PlateDriver } from '../shared/fleet';
import { normalizePlate } from '../shared/fleet';
import type { Standing } from '../shared/rules';
import type { SheetRow } from '../shared/customsSheet';
import { hashSecret } from './auth';

/** How a movement names the owner, who is not a row in `users`. */
export const OWNER_NAME = 'المالك';

/**
 * Row ↔ DTO mapping and every SQL statement, in one file. The services above
 * this never see a raw row, and nothing outside it writes SQL.
 *
 * A position is the official five-part slot: zone, bay, stack, tier — the
 * yard digit derives from the zone and is never stored.
 */

interface ContainerRow {
  id: number;
  number: string;
  number_valid: number;
  size: number;
  bill: string;
  bill_kind: string | null;
  notes: string;
  entered_at: string;
  exited_at: string | null;
  zone: string | null;
  bay: number | null;
  stack: number | null;
  tier: string | null;
  weight: string;
  handling: string;
  truck_in: string;
  driver_in: string;
  seal_in: string;
  card_in: number | null;
  card_in_year: number | null;
  truck_out: string;
  driver_out: string;
  seal_out: string;
  card_out: number | null;
  card_out_year: number | null;
  deleted_at: string | null;
}

function slotOf(
  zone: string | null,
  bay: number | null,
  stack: number | null,
  tier: string | null,
): Position | null {
  if (zone === null || bay === null || stack === null || tier === null) return null;
  return { zone: zone as Zone, bay, stack, tier: tier as Tier };
}

function toDto(row: ContainerRow): ContainerDto {
  return {
    id: row.id,
    number: row.number,
    numberValid: row.number_valid === 1,
    size: row.size as Size,
    bill: row.bill,
    billKind: (row.bill_kind ?? null) as ContainerDto['billKind'],
    enteredAt: row.entered_at,
    exitedAt: row.exited_at,
    position: slotOf(row.zone, row.bay, row.stack, row.tier),
    notes: row.notes,
    weight: row.weight,
    handling: row.handling === '' ? null : (row.handling as Handling),
    truckIn: row.truck_in,
    driverIn: row.driver_in,
    sealIn: row.seal_in,
    cardIn: row.card_in,
    cardInYear: row.card_in_year,
    truckOut: row.truck_out,
    driverOut: row.driver_out,
    cardOut: row.card_out,
    cardOutYear: row.card_out_year,
  };
}

/** The stored comma-separated codes, filtered back to the known vocabulary. */
function parsePermissions(text: string): Permission[] {
  const given = new Set(text.split(',').map((code) => code.trim()));
  return PERMISSIONS.filter((code) => given.has(code));
}

interface UserRow {
  id: number;
  name: string;
  pin_hash: string;
  perms: string;
  machine: string;
  deleted_at: string | null;
}

/** The stored machine, filtered back to the vocabulary — '' means office. */
function parseMachine(text: string): Handling | '' {
  return (HANDLING as readonly string[]).includes(text) ? (text as Handling) : '';
}

function toUser(row: UserRow): UserDto {
  return {
    id: row.id,
    name: row.name,
    permissions: parsePermissions(row.perms),
    machine: parseMachine(row.machine),
  };
}

/** The employees who can sign in today. */
export function listUsers(db: DatabaseSync): UserDto[] {
  const rows = db
    .prepare('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY id')
    .all() as unknown as UserRow[];
  return rows.map(toUser);
}

export function getUser(db: DatabaseSync, id: number): UserDto | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id) as
    | UserRow
    | undefined;
  return row === undefined ? null : toUser(row);
}

/** The stored PIN hash of a live employee, for the sign-in check. */
export function userPinHash(db: DatabaseSync, id: number): string | null {
  const row = db
    .prepare('SELECT pin_hash FROM users WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { pin_hash: string } | undefined;
  return row?.pin_hash ?? null;
}

/** Is that name free among the employees who still work here? */
export function userNameTaken(db: DatabaseSync, name: string, exceptId?: number): boolean {
  const row = db
    .prepare('SELECT id FROM users WHERE name = ? AND deleted_at IS NULL')
    .get(name) as { id: number } | undefined;
  return row !== undefined && row.id !== exceptId;
}

export function insertUser(
  db: DatabaseSync,
  user: {
    name: string;
    pin: string;
    permissions: readonly Permission[];
    machine: Handling | '';
  },
): number {
  const result = db
    .prepare('INSERT INTO users (name, pin_hash, perms, machine) VALUES (?, ?, ?, ?)')
    .run(user.name, hashSecret(user.pin), user.permissions.join(','), user.machine);
  return Number(result.lastInsertRowid);
}

/** Rename, re-permission, re-machine, and optionally set a fresh PIN. */
export function updateUser(
  db: DatabaseSync,
  id: number,
  user: {
    name: string;
    permissions: readonly Permission[];
    machine?: Handling | '' | undefined;
    pin?: string | undefined;
  },
): void {
  db.prepare('UPDATE users SET name = ?, perms = ? WHERE id = ? AND deleted_at IS NULL').run(
    user.name,
    user.permissions.join(','),
    id,
  );
  if (user.machine !== undefined) {
    db.prepare('UPDATE users SET machine = ? WHERE id = ? AND deleted_at IS NULL').run(
      user.machine,
      id,
    );
  }
  if (user.pin !== undefined) {
    db.prepare('UPDATE users SET pin_hash = ? WHERE id = ? AND deleted_at IS NULL').run(
      hashSecret(user.pin),
      id,
    );
  }
}

export function softDeleteUser(db: DatabaseSync, id: number, at: string): void {
  db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(at, id);
}

/** Names of EVERY employee ever, so an old register still names its signer. */
export function listUserNames(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare('SELECT id, name FROM users').all() as unknown as Array<{
    id: number;
    name: string;
  }>;
  const names: Record<string, string> = {};
  for (const row of rows) names[String(row.id)] = row.name;
  return names;
}

/** The actor a movement names: an employee's name, or the owner. */
export function userLabel(names: Readonly<Record<string, string>>, id: number | null): string {
  if (id === null || id === OWNER_ID) return OWNER_NAME;
  return names[String(id)] ?? OWNER_NAME;
}

// ---- مهام الآليات — the machine task queue ----------------------------------

/**
 * A task row joined with its container: the driver reads everything off one
 * card. The join keeps DELETED containers — a closed task on a struck record
 * must still render in the history it belongs to.
 */
interface TaskRow {
  id: number;
  kind: string;
  container_id: number;
  machine: string;
  urgent: number;
  status: string;
  created_at: string;
  created_by: number | null;
  done_at: string | null;
  done_by: number | null;
  closed_note: string;
  pos_zone: string | null;
  pos_bay: number | null;
  pos_stack: number | null;
  pos_tier: string | null;
  truck: string;
  number: string;
  size: number;
  bill: string;
  notes: string;
  weight: string;
  truck_in: string;
  driver_in: string;
  truck_out: string;
  driver_out: string;
  live_zone: string | null;
  live_bay: number | null;
  live_stack: number | null;
  live_tier: string | null;
}

const TASK_SELECT = `
  SELECT t.*, k.number, k.size, k.bill, k.notes, k.weight,
         k.truck_in, k.driver_in, k.truck_out, k.driver_out,
         k.zone AS live_zone, k.bay AS live_bay, k.stack AS live_stack, k.tier AS live_tier
    FROM tasks t
    JOIN containers k ON k.id = t.container_id`;

/**
 * The truck this piece of work is waiting on, and who drives it — the one
 * rule, so the machine's card and the gate's banner can never disagree.
 * An entry task's truck is the one that BROUGHT the box and still stands
 * outside the gate; an exit task's is the plate the gate wrote as it left,
 * falling back to the record's own exit plate. A تجهيز whose truck nobody
 * has named yet reads blank, which is the truth and not a gap to fill.
 */
export function gateTruckOf(source: {
  kind: string;
  truck: string | null;
  truck_in: string | null;
  driver_in: string | null;
  truck_out: string | null;
  driver_out: string | null;
}): { truck: string; driver: string } {
  if (source.kind === 'IN') {
    return { truck: source.truck_in ?? '', driver: source.driver_in ?? '' };
  }
  const pinned = source.truck ?? '';
  return {
    truck: pinned === '' ? (source.truck_out ?? '') : pinned,
    driver: source.driver_out ?? '',
  };
}

function toTask(row: TaskRow, names: Readonly<Record<string, string>>): TaskDto {
  return {
    id: row.id,
    kind: row.kind as TaskKind,
    containerId: row.container_id,
    machine: row.machine as Handling,
    urgent: row.urgent !== 0,
    status: row.status as TaskStatus,
    createdAt: row.created_at,
    createdBy: userLabel(names, row.created_by),
    doneAt: row.done_at,
    doneBy: row.done_at === null ? null : userLabel(names, row.done_by),
    closedNote: row.closed_note as TaskCloseNote | '',
    truck: row.truck,
    number: row.number,
    size: row.size as Size,
    bill: row.bill,
    notes: row.notes,
    weight: row.weight,
    // Which truck is waiting on this work — the machine reads it on the
    // card before it calls the gate to admit that very plate.
    ...(() => {
      const gate = gateTruckOf(row);
      return { gateTruck: gate.truck, gateDriver: gate.driver };
    })(),
    // The live slot while the box stands; the birth snapshot once it no
    // longer does — the driver must still be told where it stood.
    position:
      slotOf(row.live_zone, row.live_bay, row.live_stack, row.live_tier) ??
      slotOf(row.pos_zone, row.pos_bay, row.pos_stack, row.pos_tier),
  };
}

export interface NewTask {
  kind: TaskKind;
  containerId: number;
  machine: Handling;
  at: string;
  /** null = the owner, exactly as movements write it. */
  createdBy: number | null;
  /** The slot at birth, kept for after the live position is wiped. */
  position: Position | null;
  truck?: string;
}

export function insertTask(db: DatabaseSync, task: NewTask): number {
  const result = db
    .prepare(
      `INSERT INTO tasks (kind, container_id, machine, created_at, created_by,
                          pos_zone, pos_bay, pos_stack, pos_tier, truck)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      task.kind,
      task.containerId,
      task.machine,
      task.at,
      task.createdBy,
      task.position?.zone ?? null,
      task.position?.bay ?? null,
      task.position?.stack ?? null,
      task.position?.tier ?? null,
      task.truck ?? '',
    );
  return Number(result.lastInsertRowid);
}

export function getTask(db: DatabaseSync, id: number): TaskDto | null {
  const row = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) as TaskRow | undefined;
  return row === undefined ? null : toTask(row, listUserNames(db));
}

/**
 * The queue as the tablet reads it. PENDING: «مستعجل» first, then the oldest
 * first — the order the owner chose. DONE: the freshest first, capped.
 */
export function listTasks(
  db: DatabaseSync,
  filter: { machine?: Handling | undefined; status: TaskStatus; limit?: number | undefined },
): TaskDto[] {
  const where = ['t.status = ?'];
  const args: Array<string | number> = [filter.status];
  if (filter.machine !== undefined) {
    where.push('t.machine = ?');
    args.push(filter.machine);
  }
  const order =
    filter.status === 'PENDING'
      ? 'ORDER BY t.urgent DESC, t.created_at, t.id'
      : 'ORDER BY t.done_at DESC, t.id DESC';
  const limit = Math.min(filter.limit ?? 200, 500);
  const rows = db
    .prepare(`${TASK_SELECT} WHERE ${where.join(' AND ')} ${order} LIMIT ?`)
    .all(...args, limit) as unknown as TaskRow[];
  const names = listUserNames(db);
  return rows.map((row) => toTask(row, names));
}

/** Is a PENDING task of this kind already open on the container? */
export function pendingTaskExists(db: DatabaseSync, containerId: number, kind: TaskKind): boolean {
  const row = db
    .prepare(`SELECT id FROM tasks WHERE container_id = ? AND kind = ? AND status = 'PENDING'`)
    .get(containerId, kind) as { id: number } | undefined;
  return row !== undefined;
}

/**
 * Close every PENDING task on a container (optionally one kind) — the gate
 * acted, so the queue must not keep asking. Returns how many closed.
 */
export function closePendingTasks(
  db: DatabaseSync,
  containerId: number,
  kind: TaskKind | null,
  at: string,
  byId: number | null,
  note: TaskCloseNote,
): number {
  const result =
    kind === null
      ? db
          .prepare(
            `UPDATE tasks SET status = 'DONE', done_at = ?, done_by = ?, closed_note = ?
             WHERE container_id = ? AND status = 'PENDING'`,
          )
          .run(at, byId, note, containerId)
      : db
          .prepare(
            `UPDATE tasks SET status = 'DONE', done_at = ?, done_by = ?, closed_note = ?
             WHERE container_id = ? AND kind = ? AND status = 'PENDING'`,
          )
          .run(at, byId, note, containerId, kind);
  return Number(result.changes);
}

/** The driver's own «تم»: closed by hand, with no close code. */
export function setTaskDone(db: DatabaseSync, id: number, at: string, byId: number | null): void {
  db.prepare(`UPDATE tasks SET status = 'DONE', done_at = ?, done_by = ? WHERE id = ?`).run(
    at,
    byId,
    id,
  );
}

export function setTaskUrgent(db: DatabaseSync, id: number, urgent: boolean): void {
  db.prepare('UPDATE tasks SET urgent = ? WHERE id = ?').run(urgent ? 1 : 0, id);
}

export function setTaskMachine(db: DatabaseSync, id: number, machine: Handling): void {
  db.prepare('UPDATE tasks SET machine = ? WHERE id = ?').run(machine, id);
}

// ---- دمج أسماء السائقين — the duplicate-spelling repair -------------------

/**
 * Every driver name the gate ever wrote (live rows), with how many hauls
 * stand under each spelling — the raw material of the merge tool: «حماد
 * عودة» in three spellings is three rows here and three lines in the
 * accounting, until the owner folds them into one.
 */
export function driverNameCounts(db: DatabaseSync): Array<{ name: string; hauls: number }> {
  const rows = db
    .prepare(
      `SELECT name, SUM(n) AS hauls FROM (
         SELECT driver_in AS name, COUNT(*) AS n FROM containers
          WHERE deleted_at IS NULL AND driver_in != '' GROUP BY driver_in
         UNION ALL
         SELECT driver_out, COUNT(*) FROM containers
          WHERE deleted_at IS NULL AND driver_out != '' GROUP BY driver_out
       ) GROUP BY name ORDER BY name`,
    )
    .all() as unknown as Array<{ name: string; hauls: number }>;
  return rows;
}

/**
 * Fold the dropped spellings into the kept one — a spelling repair, so it
 * touches EVERY row (deleted history included: an old register should read
 * the canonical name too) and the fleet's default drivers with them.
 */
export function mergeDriverNames(
  db: DatabaseSync,
  keep: string,
  drop: readonly string[],
): { hauls: number; trucks: number } {
  const marks = drop.map(() => '?').join(', ');
  const inChanged = db
    .prepare(`UPDATE containers SET driver_in = ? WHERE driver_in IN (${marks})`)
    .run(keep, ...drop);
  const outChanged = db
    .prepare(`UPDATE containers SET driver_out = ? WHERE driver_out IN (${marks})`)
    .run(keep, ...drop);
  const trucksChanged = db
    .prepare(`UPDATE trucks SET driver = ? WHERE driver IN (${marks})`)
    .run(keep, ...drop);
  return {
    hauls: Number(inChanged.changes) + Number(outChanged.changes),
    trucks: Number(trucksChanged.changes),
  };
}

/**
 * كشف إنتاجية الآليات: what each hand finished per machine in the period,
 * with the mean minutes from the order's birth to its «تم». Auto-closed
 * tasks (closed_note != '') are the gate's bookkeeping, not work done, and
 * are left out.
 */
export function machineProductivity(
  db: DatabaseSync,
  fromIso: string,
  toIso: string,
): MachineReportRow[] {
  const rows = db
    .prepare(
      `SELECT machine, done_by,
              SUM(kind = 'IN')  AS in_done,
              SUM(kind = 'OUT') AS out_done,
              COUNT(*)          AS total,
              AVG((julianday(done_at) - julianday(created_at)) * 24 * 60) AS avg_minutes
         FROM tasks
        WHERE status = 'DONE' AND closed_note = ''
          AND done_at >= ? AND done_at < ?
        GROUP BY machine, done_by
        ORDER BY machine, total DESC`,
    )
    .all(fromIso, toIso) as unknown as Array<{
    machine: string;
    done_by: number | null;
    in_done: number;
    out_done: number;
    total: number;
    avg_minutes: number | null;
  }>;
  const names = listUserNames(db);
  return rows.map((row) => ({
    machine: row.machine as Handling,
    doer: userLabel(names, row.done_by),
    inDone: row.in_done,
    outDone: row.out_done,
    total: row.total,
    avgMinutes: row.avg_minutes === null ? null : Math.round(row.avg_minutes),
  }));
}

/** Everyone currently standing in the yard, as the rules see them. */
export function listStanding(db: DatabaseSync): Standing[] {
  const rows = db
    .prepare('SELECT * FROM containers WHERE zone IS NOT NULL AND deleted_at IS NULL')
    .all() as unknown as ContainerRow[];
  return rows.map((row) => {
    const position = slotOf(row.zone, row.bay, row.stack, row.tier);
    if (position === null) throw new Error(`container ${String(row.id)} standing without a slot`);
    return { id: row.id, number: row.number, size: row.size as Size, position };
  });
}

export function listInYard(db: DatabaseSync): ContainerDto[] {
  const rows = db
    .prepare(
      'SELECT * FROM containers WHERE zone IS NOT NULL AND deleted_at IS NULL ORDER BY entered_at',
    )
    .all() as unknown as ContainerRow[];
  return rows.map(toDto);
}

export function getContainer(db: DatabaseSync, id: number): ContainerDto | null {
  const row = db
    .prepare('SELECT * FROM containers WHERE id = ? AND deleted_at IS NULL')
    .get(id) as ContainerRow | undefined;
  return row === undefined ? null : toDto(row);
}

/** The standing container with this number, if the number is in the yard now. */
export function findStandingByNumber(db: DatabaseSync, number: string): ContainerDto | null {
  const row = db
    .prepare(
      'SELECT * FROM containers WHERE number = ? AND zone IS NOT NULL AND deleted_at IS NULL',
    )
    .get(number) as ContainerRow | undefined;
  return row === undefined ? null : toDto(row);
}

/**
 * كشف البوليصة: every container that ever travelled under this bill —
 * the standing ones first (they need attention), then the departed.
 */
export function listByBill(db: DatabaseSync, bill: string): ContainerDto[] {
  const rows = db
    .prepare(
      `SELECT * FROM containers
       WHERE bill = ? AND deleted_at IS NULL
       ORDER BY (zone IS NULL), entered_at, id`,
    )
    .all(bill) as unknown as ContainerRow[];
  return rows.map(toDto);
}

/**
 * كشف البوليصة مفتوحاً على كل شيء: every live container record, the standing
 * ones first with their slots, then the departed — the same order one bill's
 * sheet reads in, across all bills at once.
 */
export function listBillRegister(db: DatabaseSync): ContainerDto[] {
  const rows = db
    .prepare(
      `SELECT * FROM containers
       WHERE deleted_at IS NULL
       ORDER BY (zone IS NULL), entered_at, id`,
    )
    .all() as unknown as ContainerRow[];
  return rows.map(toDto);
}

export function searchContainers(db: DatabaseSync, rawQuery: string): ContainerDto[] {
  // The office types digits however the keyboard offers them: a search for
  // ٣٢١٠ is asking for 3210, so the Arabic-Indic digits fold first.
  const query = rawQuery.replace(/[٠-٩]/g, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0x0660 + 0x30),
  );
  // Escape the two LIKE wildcards so a literal % in a search cannot scan
  // everything; \ is the declared escape character below.
  const escaped = query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const like = `%${escaped}%`;
  const rows = db
    .prepare(
      `SELECT * FROM containers
       WHERE deleted_at IS NULL
         AND (number LIKE ? ESCAPE '\\' OR bill LIKE ? ESCAPE '\\'
              OR seal_in LIKE ? ESCAPE '\\')
       ORDER BY (zone IS NULL), entered_at DESC
       LIMIT 50`,
    )
    .all(like, like, like) as unknown as ContainerRow[];
  return rows.map(toDto);
}

export interface NewContainer {
  number: string;
  numberValid: boolean;
  size: Size;
  bill: string;
  /** فردية أو على كشف — what the gate was told; null when it was not asked. */
  billKind: BillKind | null;
  notes: string;
  position: Position;
  at: string;
  weight: string;
  handling: Handling;
  truckIn: string;
  driverIn: string;
  sealIn: string;
  cardIn: number;
  /** The year the entry serial counts within — the counter restarts each one. */
  cardInYear: number;
}

export function insertContainer(db: DatabaseSync, container: NewContainer): number {
  const result = db
    .prepare(
      `INSERT INTO containers
         (number, number_valid, size, bill, bill_kind, notes, entered_at, zone, bay, stack, tier,
          weight, handling, truck_in, driver_in, seal_in, card_in, card_in_year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      container.number,
      container.numberValid ? 1 : 0,
      container.size,
      container.bill,
      container.billKind,
      container.notes,
      container.at,
      container.position.zone,
      container.position.bay,
      container.position.stack,
      container.position.tier,
      container.weight,
      container.handling,
      container.truckIn,
      container.driverIn,
      container.sealIn,
      container.cardIn,
      container.cardInYear,
    );
  return Number(result.lastInsertRowid);
}

/**
 * تصحيح الفئة: the class alone, one column.
 *
 * Never `updateContainer` — that rewrites fourteen columns and no position
 * column, and routing a class through it IS the corruption: a 40 addressed at
 * an odd bay. The class and the address move together, in one transaction, or
 * not at all.
 */
export function setSize(db: DatabaseSync, id: number, size: Size): void {
  db.prepare('UPDATE containers SET size = ? WHERE id = ?').run(size, id);
}

export function setPosition(db: DatabaseSync, id: number, position: Position | null): void {
  db.prepare('UPDATE containers SET zone = ?, bay = ?, stack = ?, tier = ? WHERE id = ?').run(
    position?.zone ?? null,
    position?.bay ?? null,
    position?.stack ?? null,
    position?.tier ?? null,
    id,
  );
}

export interface GateOut {
  truck: string;
  driver: string;
  cardOut: number;
  cardOutYear: number;
}

/**
 * `seal_out` is not written: the exit stopped asking for a seal, so the one
 * recorded at entry is the container's seal and the only one anything shows.
 * The column stays where it is, holding what the old exits recorded.
 */
export function markExited(db: DatabaseSync, id: number, at: string, gate: GateOut): void {
  db.prepare(
    `UPDATE containers SET exited_at = ?, zone = NULL, bay = NULL, stack = NULL, tier = NULL,
       truck_out = ?, driver_out = ?, card_out = ?, card_out_year = ?
     WHERE id = ?`,
  ).run(at, gate.truck, gate.driver, gate.cardOut, gate.cardOutYear, id);
}

export interface ContainerEdit {
  number: string;
  numberValid: boolean;
  bill: string;
  billKind: BillKind | null;
  size: Size;
  notes: string;
  weight: string;
  handling: Handling | null;
  truckIn: string;
  driverIn: string;
  sealIn: string;
  truckOut: string;
  driverOut: string;
  enteredAt: string;
  exitedAt: string | null;
}

/**
 * تحويل مهمة إدخال يصحّح المناولة: the entry card must print what actually
 * lifted the box off the truck, so re-routing the task rewrites the fact.
 */
export function setHandling(db: DatabaseSync, id: number, handling: Handling): void {
  db.prepare('UPDATE containers SET handling = ? WHERE id = ?').run(handling, id);
}

export function updateContainer(db: DatabaseSync, id: number, edit: ContainerEdit): void {
  db.prepare(
    `UPDATE containers SET number = ?, number_valid = ?, bill = ?, bill_kind = ?, size = ?,
       notes = ?, weight = ?, handling = ?,
       truck_in = ?, driver_in = ?, seal_in = ?,
       truck_out = ?, driver_out = ?,
       entered_at = ?, exited_at = ?
     WHERE id = ?`,
  ).run(
    edit.number,
    edit.numberValid ? 1 : 0,
    edit.bill,
    edit.billKind,
    edit.size,
    edit.notes,
    edit.weight,
    edit.handling ?? '',
    edit.truckIn,
    edit.driverIn,
    edit.sealIn,
    edit.truckOut,
    edit.driverOut,
    edit.enteredAt,
    edit.exitedAt,
    id,
  );
}

/**
 * Move a recorded gate instant to match a corrected date. The registers read
 * `movements.at`, the container card reads `entered_at`/`exited_at` — leave
 * one behind and the same container sits in two different weeks depending on
 * which sheet you open. The first IN and the last OUT are the gate's own.
 */
export function retimeMovement(
  db: DatabaseSync,
  containerId: number,
  type: 'IN' | 'OUT',
  at: string,
): void {
  db.prepare(
    `UPDATE movements SET at = ?
     WHERE id = (
       SELECT id FROM movements WHERE container_id = ? AND type = ?
       ORDER BY at ${type === 'IN' ? 'ASC' : 'DESC'}, id ${type === 'IN' ? 'ASC' : 'DESC'}
       LIMIT 1
     )`,
  ).run(at, containerId, type);
}

export function softDelete(db: DatabaseSync, id: number, at: string): void {
  // Deleting also vacates the slot; a deleted record must not keep ground.
  db.prepare(
    'UPDATE containers SET deleted_at = ?, zone = NULL, bay = NULL, stack = NULL, tier = NULL WHERE id = ?',
  ).run(at, id);
}

/** The record whether it is deleted or not — the restore path needs both. */
export function getContainerAny(
  db: DatabaseSync,
  id: number,
): (ContainerDto & { deleted: boolean }) | null {
  const row = db.prepare('SELECT * FROM containers WHERE id = ?').get(id) as
    | ContainerRow
    | undefined;
  return row === undefined ? null : { ...toDto(row), deleted: row.deleted_at !== null };
}

/**
 * Does a LIVE record already carry the serial this one holds?
 *
 * It cannot happen under the never-reuse rule — the count climbs past a
 * struck-out record rather than into its seat. But a book kept under the OLD
 * rule is full of these: closing the hole a deletion left moved a live card
 * onto a number the struck-out record was still holding. The owner's own
 * database carries thirteen of them. Restoring such a record would put two
 * live cards on one number, so it is given a fresh one instead — its card was
 * voided when it was struck out, and the number it used to carry is printed on
 * somebody else's paper now.
 */
export function serialClashes(db: DatabaseSync, id: number, kind: 'in' | 'out'): boolean {
  const serial = kind === 'in' ? 'card_in' : 'card_out';
  const stamped = kind === 'in' ? 'card_in_year' : 'card_out_year';
  const row = db
    .prepare(
      `SELECT 1 AS hit FROM containers me
         JOIN containers other
           ON other.${serial} = me.${serial} AND other.${stamped} = me.${stamped}
          AND other.id <> me.id AND other.deleted_at IS NULL
        WHERE me.id = ? AND me.${serial} IS NOT NULL AND me.${stamped} IS NOT NULL
        LIMIT 1`,
    )
    .get(id) as { hit: number } | undefined;
  return row !== undefined;
}

/** Write one gate serial, and nothing else. */
export function setCardSerial(
  db: DatabaseSync,
  id: number,
  kind: 'in' | 'out',
  serial: number,
): void {
  const column = kind === 'in' ? 'card_in' : 'card_out';
  db.prepare(`UPDATE containers SET ${column} = ? WHERE id = ?`).run(serial, id);
}

/** Where the container stood at the moment it was deleted, if anywhere. */
export function lastDeletePosition(db: DatabaseSync, id: number): Position | null {
  const row = db
    .prepare(
      `SELECT from_zone, from_bay, from_stack, from_tier FROM movements
       WHERE container_id = ? AND type = 'DELETE' ORDER BY at DESC, id DESC LIMIT 1`,
    )
    .get(id) as
    | { from_zone: string | null; from_bay: number | null; from_stack: number | null; from_tier: string | null }
    | undefined;
  if (row === undefined) return null;
  return slotOf(row.from_zone, row.from_bay, row.from_stack, row.from_tier);
}

/**
 * Where it stood as it left — read off the OUT movement, which records the
 * slot it was lifted from. Needed to take an exit back: the container returns
 * to its own slot or to nowhere.
 */
export function lastExitPosition(db: DatabaseSync, id: number): Position | null {
  const row = db
    .prepare(
      `SELECT from_zone, from_bay, from_stack, from_tier FROM movements
       WHERE container_id = ? AND type = 'OUT' ORDER BY at DESC, id DESC LIMIT 1`,
    )
    .get(id) as
    | { from_zone: string | null; from_bay: number | null; from_stack: number | null; from_tier: string | null }
    | undefined;
  if (row === undefined) return null;
  return slotOf(row.from_zone, row.from_bay, row.from_stack, row.from_tier);
}

/**
 * An exit taken back: the container stands again where it stood, and its exit
 * paperwork is voided outright — the truck, the driver and THE CARD. The card
 * is not kept "for the record": it was never a departure, and leaving its
 * serial behind would hold a number out of the year's count for nothing.
 */
export function cancelExit(db: DatabaseSync, id: number, position: Position): void {
  db.prepare(
    `UPDATE containers
        SET exited_at = NULL, zone = ?, bay = ?, stack = ?, tier = ?,
            truck_out = '', driver_out = '', card_out = NULL, card_out_year = NULL
      WHERE id = ?`,
  ).run(position.zone, position.bay, position.stack, position.tier, id);
}

/** Undo a soft delete, standing the container back where it was (or out). */
export function restoreContainer(db: DatabaseSync, id: number, position: Position | null): void {
  db.prepare(
    'UPDATE containers SET deleted_at = NULL, zone = ?, bay = ?, stack = ?, tier = ? WHERE id = ?',
  ).run(
    position?.zone ?? null,
    position?.bay ?? null,
    position?.stack ?? null,
    position?.tier ?? null,
    id,
  );
}

/** `userId` is null for the owner, who is not a row in `users`. */
export function recordMovement(
  db: DatabaseSync,
  containerId: number,
  type: MovementType,
  at: string,
  from: Position | null,
  to: Position | null,
  note: string,
  userId: number | null,
  /** A printed card of its own — only a MOVE carries one. */
  card: { serial: number; year: number } | null = null,
): number {
  const result = db
    .prepare(
      `INSERT INTO movements
       (container_id, type, at, from_zone, from_bay, from_stack, from_tier,
        to_zone, to_bay, to_stack, to_tier, note, user_id, card, card_year)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      containerId,
      type,
      at,
      from?.zone ?? null,
      from?.bay ?? null,
      from?.stack ?? null,
      from?.tier ?? null,
      to?.zone ?? null,
      to?.bay ?? null,
      to?.stack ?? null,
      to?.tier ?? null,
      note,
      userId === OWNER_ID ? null : userId,
      card?.serial ?? null,
      card?.year ?? null,
    );
  return Number(result.lastInsertRowid);
}

interface MovementRow {
  id: number;
  type: string;
  at: string;
  from_zone: string | null;
  from_bay: number | null;
  from_stack: number | null;
  from_tier: string | null;
  to_zone: string | null;
  to_bay: number | null;
  to_stack: number | null;
  to_tier: string | null;
  note: string;
  user_id: number | null;
  card: number | null;
  card_year: number | null;
}

/** One movement as the wire carries it — a MOVE brings its card along. */
function movementOf(row: MovementRow, names: Readonly<Record<string, string>>): MovementDto {
  return {
    id: row.id,
    type: row.type as MovementType,
    at: row.at,
    from: slotOf(row.from_zone, row.from_bay, row.from_stack, row.from_tier),
    to: slotOf(row.to_zone, row.to_bay, row.to_stack, row.to_tier),
    note: row.note,
    card: row.card,
    cardYear: row.card_year,
    user: userLabel(names, row.user_id),
  };
}

export function getMovement(db: DatabaseSync, id: number): MovementDto | null {
  const row = db.prepare('SELECT * FROM movements WHERE id = ?').get(id) as
    | unknown as MovementRow
    | undefined;
  return row === undefined ? null : movementOf(row, listUserNames(db));
}

export function listMovements(db: DatabaseSync, containerId: number): MovementDto[] {
  const rows = db
    .prepare('SELECT * FROM movements WHERE container_id = ? ORDER BY at, id')
    .all(containerId) as unknown as MovementRow[];
  const names = listUserNames(db);
  return rows.map((row) => movementOf(row, names));
}

/**
 * The next serial for a printed gate card: one sequence per direction PER
 * YEAR, and it is READ FROM THE RECORDS THEMSELVES rather than from a counter
 * kept beside them.
 *
 * That is the whole point. A stored counter only ever climbs, so striking out
 * a record that should never have been written left a hole in the register
 * that nothing could fill — «في حال حذف الحاوية او سجل خطأ يجب ان لا يتم
 * القفز عن الرقم التسلسلي». Taking the highest serial actually in use means a
 * mistake deleted at once hands its number straight back to the next one, and
 * the register reads 1, 2, 3 with nothing missing.
 *
 * Nothing else moves a serial. A container that is carried across the yard
 * keeps the number printed on its card, because a move writes a movement and
 * never touches these columns.
 *
 * Four places is the room the card and the registers leave for it — 9999
 * movements one way in one year, which this yard does not approach — and the
 * year is printed beside it, so two cards a year apart cannot be confused.
 */
export function nextCardNumber(db: DatabaseSync, kind: 'in' | 'out', year: number): number {
  const serial = kind === 'in' ? 'card_in' : 'card_out';
  const stamped = kind === 'in' ? 'card_in_year' : 'card_out_year';
  const row = db
    .prepare(
      // DELETED ROWS COUNT. «ما بدي حدا يوخذ مكانها خلص يضل يكمل»: a serial
      // that has been printed once is never printed again, so the year's
      // count climbs past a struck-out record instead of stepping into its
      // seat. The register may carry a hole; it may never carry the same
      // number twice.
      `SELECT MAX(${serial}) AS top FROM containers WHERE ${stamped} = ?`,
    )
    .get(year) as { top: number | null };

  /**
   * The high-water mark, so a count can only ever climb.
   *
   * Reading the records alone was one path short. «إلغاء الخروج» VOIDS an
   * exit card — it clears the number off the record — so cancelling the
   * NEWEST departure dropped the maximum, and the next box out was handed a
   * number already printed and carried away on somebody's paper. Two papers,
   * one number, which is the one thing this book may never do. The mark
   * remembers what was issued even when nothing carries it any more.
   */
  const key = `card_${kind}_high_${String(year)}`;
  const mark = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  const issued = mark === undefined ? 0 : Number(mark.value);
  const next = Math.max(row.top ?? 0, Number.isFinite(issued) ? issued : 0) + 1;
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(key, String(next));
  return next;
}

/**
 * The next serial for a printed MOVE card. A container is moved many times,
 * so this card belongs to the MOVEMENT and not to the container — the ledger
 * is the movements table, counted per year like the two gate ledgers.
 *
 * A struck-out record's move cards count too — the paper was printed and
 * handed to a crane driver, and no second card may ever carry its number.
 */
export function nextMoveCardNumber(db: DatabaseSync, year: number): number {
  const row = db
    .prepare(
      `SELECT MAX(card) AS top FROM movements
        WHERE type = 'MOVE' AND card_year = ?`,
    )
    .get(year) as { top: number | null };
  return (row.top ?? 0) + 1;
}

/**
 * الترقيم لا يُعاد أبداً.
 *
 * A renumbering pass lived here: it re-seated every live card of a year to
 * run 1 … N with no hole, and it ran on delete, on restore, on an exit taken
 * back, on a corrected gate date, and on every database open. It is gone,
 * and its absence is the rule — «ما بدي حدا يوخذ مكانها خلص يضل يكمل».
 *
 * Closing a hole moved the numbers of records that had nothing to do with
 * the mistake, so a card already printed and handed to a driver stopped
 * matching the register it came from. A hole is visible and harmless; a
 * number that changes hands is neither. A serial is written once, at the
 * gate, and nothing rewrites it — except a restore whose old number a live
 * record has since been given by the OLD rule, settled in the restore route
 * by moving that one record and nobody else.
 */


interface GateRow {
  container_id: number;
  at: string;
  bill: string;
  z: string | null;
  b: number | null;
  s: number | null;
  t: string | null;
  number: string;
  size: number;
  weight: string;
  notes: string;
  /** Where the container IS now — null once it has left. */
  live_zone: string | null;
  live_bay: number | null;
  live_stack: number | null;
  live_tier: string | null;
  truck_in: string;
  driver_in: string;
  seal_in: string;
  card_in: number | null;
  card_in_year: number | null;
  truck_out: string;
  driver_out: string;
  seal_out: string;
  card_out: number | null;
  card_out_year: number | null;
  entered_at: string;
  user_id: number | null;
}

/**
 * An OUT movement that a later RETURN («إلغاء الخروج») took back is not a
 * departure. The exit register, the daily counts, the truck sheet and the
 * card book all skip it — the box never left, in the register's eyes — while
 * the operations log, which is the history, still shows all three steps.
 * Ordered by id rather than by `at`: an exit instant can be edited later.
 * Found live: two exits cancelled and redone printed twice in كشف الخروج.
 */
const OUT_STANDS = `NOT EXISTS (
         SELECT 1 FROM movements r
          WHERE r.container_id = m.container_id AND r.type = 'RETURN' AND r.id > m.id)`;

/** Every IN or OUT movement in [from, to), joined with its container's paperwork. */
export function listGateMovements(
  db: DatabaseSync,
  type: 'IN' | 'OUT',
  fromIso: string,
  toIso: string,
): GateReportRowInternal[] {
  // The MOVEMENT's own slot is kept as the fallback: on an OUT row it is
  // where the container stood as it left, which is the last thing that was
  // true of it.
  const positionColumns =
    type === 'IN'
      ? 'm.to_zone AS z, m.to_bay AS b, m.to_stack AS s, m.to_tier AS t'
      : 'm.from_zone AS z, m.from_bay AS b, m.from_stack AS s, m.from_tier AS t';
  const names = listUserNames(db);
  const rows = db
    .prepare(
      `SELECT m.container_id, m.at, m.user_id, ${positionColumns},
              k.zone AS live_zone, k.bay AS live_bay, k.stack AS live_stack, k.tier AS live_tier,
              k.number, k.size, k.bill, k.weight, k.notes,
              k.truck_in, k.driver_in, k.seal_in, k.card_in, k.card_in_year,
              k.truck_out, k.driver_out, k.seal_out, k.card_out, k.card_out_year,
              k.entered_at
       FROM movements m
       JOIN containers k ON k.id = m.container_id
       WHERE m.type = ? AND m.at >= ? AND m.at < ? AND k.deleted_at IS NULL
         AND (m.type <> 'OUT' OR ${OUT_STANDS})
       ORDER BY m.at, m.id`,
    )
    .all(type, fromIso, toIso) as unknown as GateRow[];

  const mapped: GateReportRowInternal[] = rows.map((row) => ({
    containerId: row.container_id,
    at: row.at,
    card: type === 'IN' ? row.card_in : row.card_out,
    cardYear: type === 'IN' ? row.card_in_year : row.card_out_year,
    truck: type === 'IN' ? row.truck_in : row.truck_out,
    driver: type === 'IN' ? row.driver_in : row.driver_out,
    // One seal per container — the one it came in under. The exit stopped
    // recording a second, so both directions name the same one.
    seal: row.seal_in,
    number: row.number,
    bill: row.bill,
    weight: row.weight,
    notes: row.notes,
    size: row.size as Size,
    // WHERE IT IS, not where it was set down. A container carried across the
    // yard has to be findable from the sheet that names it — the old slot
    // lives on in the operations log, which is the record of the move itself.
    position:
      slotOf(row.live_zone, row.live_bay, row.live_stack, row.live_tier) ??
      slotOf(row.z, row.b, row.s, row.t),
    user: userLabel(names, row.user_id),
    enteredAt: row.entered_at,
  }));

  // A number either register would otherwise skip stands in its own place,
  // carrying nothing, so neither book reads as though a page were torn out —
  // «الأربعة الباقية في كشف الخروج تصير بطاقة ملغاة مثل اخواتها».
  return withVoidedSerials(mapped);
}

export interface GateReportRowInternal {
  containerId: number;
  at: string;
  bill: string;
  card: number | null;
  cardYear: number | null;
  truck: string;
  driver: string;
  seal: string;
  number: string;
  weight: string;
  notes: string;
  size: Size;
  position: Position | null;
  user: string;
  enteredAt: string;
  /** A voided serial standing in its own place, carrying nothing. */
  voided?: boolean;
}

/**
 * بطاقة ملغاة: the stub a numbered book keeps where a paper was spoiled —
 * «اريد ارجاع البطاقة لكي لا يختل الرقم التسلسلي ولكن محتوياتها اصفار».
 *
 * A serial goes missing from a register two ways, and this covers both
 * without needing to know which: the record that held it was struck out, or
 * the paper was voided by «إلغاء الخروج» and its number is written nowhere
 * at all. Either way nothing LIVE carries the number, so the sheet would
 * skip from 1021 to 1023 — and the register would look tampered with.
 *
 * The holes are read off the rows themselves: any number between two
 * neighbouring serials that no row carries. So the answer is always right
 * for whatever range was asked for, and it needs no second query.
 */
function withVoidedSerials(rows: readonly GateReportRowInternal[]): GateReportRowInternal[] {
  // The holes are read off the SET of serials, never off neighbouring rows:
  // the sheet is ordered by time, and a record whose date was corrected by
  // hand can sit far from its own number. Comparing neighbours invented
  // thirty stubs on the practice yard, whose papers are deliberately
  // backdated across days — the set cannot be fooled that way.
  const present = new Map<number, Set<number>>();
  for (const row of rows) {
    if (row.card === null || row.cardYear === null) continue;
    const year = present.get(row.cardYear) ?? new Set<number>();
    year.add(row.card);
    present.set(row.cardYear, year);
  }

  // Each stub is filed after the paper whose number comes just before it —
  // by NUMBER, wherever that paper happens to sit. The sheet's own order is
  // otherwise left exactly as it was; a stub must never re-sort the register.
  const after = new Map<number, GateReportRowInternal[]>();
  for (const [year, serials] of present) {
    let low = Number.POSITIVE_INFINITY;
    let high = 0;
    for (const serial of serials) {
      if (serial < low) low = serial;
      if (serial > high) high = serial;
    }
    for (let serial = low + 1; serial < high; serial += 1) {
      if (serials.has(serial)) continue;
      let anchor = 0;
      let anchorCard = -1;
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (row === undefined || row.cardYear !== year || row.card === null) continue;
        if (row.card < serial && row.card > anchorCard) {
          anchorCard = row.card;
          anchor = i;
        }
      }
      const list = after.get(anchor) ?? [];
      list.push({
        containerId: 0,
        // The instant of the paper before it: the stub is a number, not a
        // movement, and this keeps it in place in a sheet ordered by time.
        at: rows[anchor]?.at ?? new Date().toISOString(),
        bill: '',
        card: serial,
        cardYear: year,
        truck: '',
        driver: '',
        seal: '',
        number: '',
        weight: '',
        notes: '',
        size: 20,
        position: null,
        user: '',
        enteredAt: '',
        voided: true,
      });
      after.set(anchor, list);
    }
  }
  if (after.size === 0) return [...rows];

  const out: GateReportRowInternal[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row !== undefined) out.push(row);
    const stubs = after.get(i);
    if (stubs !== undefined) {
      stubs.sort((a, b) => (a.card ?? 0) - (b.card ?? 0));
      out.push(...stubs);
    }
  }
  return out;
}

/**
 * الطباعة الكلية للبطاقات — the DATA of every entry or exit card of the
 * range, in the order a bound book reads: by card serial within its year.
 * Facts only; the Arabic card around them is the client's to write.
 *
 * The slot repeats the single card's own rule (PrintCard): where the
 * container IS — and once it has left, the slot it stood in as it went.
 */
export function bulkGateCards(
  db: DatabaseSync,
  type: 'IN' | 'OUT',
  fromIso: string,
  toIso: string,
): CardSheetRow[] {
  const positionColumns =
    type === 'IN'
      ? 'm.to_zone AS z, m.to_bay AS b, m.to_stack AS s, m.to_tier AS t'
      : 'm.from_zone AS z, m.from_bay AS b, m.from_stack AS s, m.from_tier AS t';
  const serial = type === 'IN' ? 'k.card_in' : 'k.card_out';
  const serialYear = type === 'IN' ? 'k.card_in_year' : 'k.card_out_year';
  const names = listUserNames(db);
  const rows = db
    .prepare(
      `SELECT m.container_id, m.at, ${positionColumns},
              k.zone AS live_zone, k.bay AS live_bay, k.stack AS live_stack, k.tier AS live_tier,
              k.number, k.size, k.bill, k.weight, k.notes, k.handling,
              k.truck_in, k.driver_in, k.seal_in, k.card_in, k.card_in_year,
              k.truck_out, k.driver_out, k.card_out, k.card_out_year,
              k.entered_at, m.user_id
       FROM movements m
       JOIN containers k ON k.id = m.container_id
       WHERE m.type = ? AND m.at >= ? AND m.at < ? AND k.deleted_at IS NULL
         AND (m.type <> 'OUT' OR ${OUT_STANDS})
       ORDER BY (${serial} IS NULL), ${serialYear}, ${serial}, m.at`,
    )
    .all(type, fromIso, toIso) as unknown as Array<
    GateRow & { handling: string | null; container_id: number; at: string }
  >;

  // Which photos each entry card can carry as pages. The whole yard holds a
  // few dozen photos, so the map is read whole rather than by an IN(...)
  // list that would trip SQLite's parameter ceiling on a long register.
  const photoIds = new Map<number, number[]>();
  if (type === 'IN') {
    const photos = db
      .prepare('SELECT id, container_id FROM photos WHERE deleted_at IS NULL ORDER BY id')
      .all() as unknown as Array<{ id: number; container_id: number }>;
    for (const photo of photos) {
      const list = photoIds.get(photo.container_id);
      if (list === undefined) photoIds.set(photo.container_id, [photo.id]);
      else list.push(photo.id);
    }
  }

  return rows.map(
    (row): CardSheetRow => ({
      containerId: row.container_id,
      number: row.number,
      serial: type === 'IN' ? row.card_in : row.card_out,
      serialYear: type === 'IN' ? row.card_in_year : row.card_out_year,
      at: row.at,
      bill: row.bill,
      size: row.size as Size,
      weight: row.weight,
      seal: row.seal_in,
      notes: row.notes,
      enteredAt: row.entered_at,
      handling: type === 'IN' ? ((row.handling ?? null) as CardSheetRow['handling']) : null,
      truck: type === 'IN' ? row.truck_in : row.truck_out,
      driver: type === 'IN' ? row.driver_in : row.driver_out,
      // Who did this very paperwork — the movement's own hand, not the
      // container's, so a card reprinted years later still names them.
      user: userLabel(names, row.user_id),
      slot:
        slotOf(row.live_zone, row.live_bay, row.live_stack, row.live_tier) ??
        slotOf(row.z, row.b, row.s, row.t),
      from: null,
      to: null,
      note: '',
      photoIds: type === 'IN' ? (photoIds.get(row.container_id) ?? []) : [],
    }),
  );
}

/**
 * بطاقات النقل للفترة: every numbered MOVE of the range, by its card serial.
 * The note rides raw — its JSON lists the drops the lift brought down, and
 * the client parses it exactly as the single card does.
 */
export function bulkMoveCards(db: DatabaseSync, fromIso: string, toIso: string): CardSheetRow[] {
  const rows = db
    .prepare(
      `SELECT m.container_id, m.at, m.card, m.card_year, m.note,
              m.from_zone, m.from_bay, m.from_stack, m.from_tier,
              m.to_zone, m.to_bay, m.to_stack, m.to_tier,
              k.number, k.size, k.bill, k.weight, k.notes, k.seal_in, k.entered_at
       FROM movements m
       JOIN containers k ON k.id = m.container_id
       WHERE m.type = 'MOVE' AND m.card IS NOT NULL
         AND m.at >= ? AND m.at < ? AND k.deleted_at IS NULL
       ORDER BY m.card_year, m.card`,
    )
    .all(fromIso, toIso) as unknown as Array<
    MovementRow & {
      container_id: number;
      number: string;
      size: number;
      bill: string;
      weight: string;
      notes: string;
      seal_in: string;
      entered_at: string;
    }
  >;
  return rows.map(
    (row): CardSheetRow => ({
      containerId: row.container_id,
      number: row.number,
      serial: row.card,
      serialYear: row.card_year,
      at: row.at,
      bill: row.bill,
      size: row.size as Size,
      weight: row.weight,
      seal: row.seal_in,
      notes: row.notes,
      enteredAt: row.entered_at,
      handling: null,
      truck: '',
      driver: '',
      // A move card names no employee on the paper; the field rides along
      // empty so one shape serves all three kinds.
      user: '',
      slot: null,
      from: slotOf(row.from_zone, row.from_bay, row.from_stack, row.from_tier),
      to: slotOf(row.to_zone, row.to_bay, row.to_stack, row.to_tier),
      note: row.note,
      photoIds: [],
    }),
  );
}

interface StandingRow extends ContainerRow {
  in_user: number | null;
}

/**
 * كشف الحاويات بالساحة: everything standing right now, oldest first, each
 * with the employee who received it at the gate. The dwell itself is counted
 * by the caller against the Amman calendar.
 */
export function listStandingContainers(
  db: DatabaseSync,
): Array<ContainerDto & { user: string }> {
  const names = listUserNames(db);
  const rows = db
    .prepare(
      `SELECT k.*,
              (SELECT m.user_id FROM movements m
                WHERE m.container_id = k.id AND m.type = 'IN'
                ORDER BY m.at, m.id LIMIT 1) AS in_user
       FROM containers k
       WHERE k.zone IS NOT NULL AND k.deleted_at IS NULL
       ORDER BY k.entered_at, k.id`,
    )
    .all() as unknown as StandingRow[];
  return rows.map((row) => ({ ...toDto(row), user: userLabel(names, row.in_user) }));
}

/**
 * سجل العمليات: every operation on every container in the range — deletions
 * and deleted records included, because an audit that hides mistakes is not
 * an audit.
 */
export function listOperationsLog(
  db: DatabaseSync,
  fromIso: string,
  toIso: string,
): LogReportRow[] {
  const names = listUserNames(db);
  const rows = db
    .prepare(
      `SELECT m.container_id, m.type, m.at, m.note, m.user_id,
              m.from_zone, m.from_bay, m.from_stack, m.from_tier,
              m.to_zone, m.to_bay, m.to_stack, m.to_tier,
              k.number, k.deleted_at
       FROM movements m
       JOIN containers k ON k.id = m.container_id
       WHERE m.at >= ? AND m.at < ?
       ORDER BY m.at, m.id`,
    )
    .all(fromIso, toIso) as unknown as Array<
    MovementRow & {
      container_id: number;
      number: string;
      deleted_at: string | null;
    }
  >;
  return rows.map((row) => ({
    containerId: row.container_id,
    at: row.at,
    type: row.type as MovementType,
    number: row.number,
    from: slotOf(row.from_zone, row.from_bay, row.from_stack, row.from_tier),
    to: slotOf(row.to_zone, row.to_bay, row.to_stack, row.to_tier),
    note: row.note,
    user: userLabel(names, row.user_id),
    deleted: row.deleted_at !== null,
  }));
}

/** كشف سيارة: the gate movements one truck carried, both directions. */
export function listTruckMovements(
  db: DatabaseSync,
  truck: string,
  fromIso: string,
  toIso: string,
): Array<GateReportRowInternal & { type: 'IN' | 'OUT' }> {
  const rows = db
    .prepare(
      `SELECT m.type, m.container_id, m.at, m.user_id,
              m.from_zone, m.from_bay, m.from_stack, m.from_tier,
              m.to_zone, m.to_bay, m.to_stack, m.to_tier,
              k.zone AS live_zone, k.bay AS live_bay, k.stack AS live_stack, k.tier AS live_tier,
              k.number, k.size, k.bill, k.weight, k.notes,
              k.truck_in, k.driver_in, k.seal_in, k.card_in, k.card_in_year,
              k.truck_out, k.driver_out, k.seal_out, k.card_out, k.card_out_year,
              k.entered_at
       FROM movements m
       JOIN containers k ON k.id = m.container_id
       WHERE m.at >= ? AND m.at < ? AND k.deleted_at IS NULL
         AND ((m.type = 'IN' AND k.truck_in = ?) OR (m.type = 'OUT' AND k.truck_out = ?))
         AND (m.type <> 'OUT' OR ${OUT_STANDS})
       ORDER BY m.at, m.id`,
    )
    .all(fromIso, toIso, truck, truck) as unknown as Array<MovementRow & GateRow>;
  const names = listUserNames(db);
  return rows.map((row) => {
    const type = row.type === 'IN' ? ('IN' as const) : ('OUT' as const);
    return {
      type,
      containerId: row.container_id,
      at: row.at,
      card: type === 'IN' ? row.card_in : row.card_out,
      cardYear: type === 'IN' ? row.card_in_year : row.card_out_year,
      truck: type === 'IN' ? row.truck_in : row.truck_out,
      driver: type === 'IN' ? row.driver_in : row.driver_out,
      // One seal per container — the one it came in under. The exit stopped
    // recording a second, so both directions name the same one.
    seal: row.seal_in,
      number: row.number,
      bill: row.bill,
      weight: row.weight,
      notes: row.notes,
      size: row.size as Size,
      // Where it is now; failing that, the slot of this very movement.
      position:
        slotOf(row.live_zone, row.live_bay, row.live_stack, row.live_tier) ??
        (type === 'IN'
          ? slotOf(row.to_zone, row.to_bay, row.to_stack, row.to_tier)
          : slotOf(row.from_zone, row.from_bay, row.from_stack, row.from_tier)),
      user: userLabel(names, row.user_id),
      enteredAt: row.entered_at,
    };
  });
}

/** Every IN/OUT instant up to `toIso`, for the daily counts and running total. */
export function listMovementInstants(
  db: DatabaseSync,
  toIso: string,
): Array<{ type: 'IN' | 'OUT'; at: string }> {
  const rows = db
    .prepare(
      `SELECT m.type, m.at FROM movements m
       JOIN containers k ON k.id = m.container_id
       WHERE m.type IN ('IN', 'OUT') AND m.at < ? AND k.deleted_at IS NULL
         AND (m.type <> 'OUT' OR ${OUT_STANDS})
       ORDER BY m.at`,
    )
    .all(toIso) as unknown as Array<{ type: 'IN' | 'OUT'; at: string }>;
  return rows;
}

// ---------------------------------------------------------------------------
// الناقلون والسيارات — the carrier registry. It sits BESIDE the gate records:
// the gate keeps writing the plate as free text, and everything here is
// matched to those texts by normalized plate (src/shared/fleet.ts), so
// registering, moving or deleting a truck never rewrites a single record.
// ---------------------------------------------------------------------------

interface CarrierRow {
  id: number;
  name: string;
  deleted_at: string | null;
}

interface TruckRow {
  id: number;
  carrier_id: number;
  code: string;
  number: string;
  driver: string;
  deleted_at: string | null;
}

const toTruck = (row: TruckRow): TruckDto => ({
  id: row.id,
  carrierId: row.carrier_id,
  code: row.code,
  number: row.number,
  driver: row.driver,
});

/** The carriers working with the yard today, oldest first. */
export function listCarriers(db: DatabaseSync): CarrierDto[] {
  const rows = db
    .prepare('SELECT * FROM carriers WHERE deleted_at IS NULL ORDER BY id')
    .all() as unknown as CarrierRow[];
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export function getCarrier(db: DatabaseSync, id: number): CarrierDto | null {
  const row = db.prepare('SELECT * FROM carriers WHERE id = ? AND deleted_at IS NULL').get(id) as
    | CarrierRow
    | undefined;
  return row === undefined ? null : { id: row.id, name: row.name };
}

/** Is that name free among the carriers still on the books? */
export function carrierNameTaken(db: DatabaseSync, name: string, exceptId?: number): boolean {
  const row = db
    .prepare('SELECT id FROM carriers WHERE name = ? AND deleted_at IS NULL')
    .get(name) as { id: number } | undefined;
  return row !== undefined && row.id !== exceptId;
}

export function insertCarrier(db: DatabaseSync, name: string): number {
  return Number(db.prepare('INSERT INTO carriers (name) VALUES (?)').run(name).lastInsertRowid);
}

export function renameCarrier(db: DatabaseSync, id: number, name: string): void {
  db.prepare('UPDATE carriers SET name = ? WHERE id = ? AND deleted_at IS NULL').run(name, id);
}

export function softDeleteCarrier(db: DatabaseSync, id: number, at: string): void {
  db.prepare('UPDATE carriers SET deleted_at = ? WHERE id = ?').run(at, id);
}

/** How many live trucks still stand under this carrier. */
export function carrierTruckCount(db: DatabaseSync, id: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM trucks WHERE carrier_id = ? AND deleted_at IS NULL')
    .get(id) as { n: number };
  return row.n;
}

/** Every live registered truck, its carrier's fleet in plate order. */
export function listTrucks(db: DatabaseSync): TruckDto[] {
  const rows = db
    .prepare('SELECT * FROM trucks WHERE deleted_at IS NULL ORDER BY code, number')
    .all() as unknown as TruckRow[];
  return rows.map(toTruck);
}

export function getTruck(db: DatabaseSync, id: number): TruckDto | null {
  const row = db.prepare('SELECT * FROM trucks WHERE id = ? AND deleted_at IS NULL').get(id) as
    | TruckRow
    | undefined;
  return row === undefined ? null : toTruck(row);
}

export function insertTruck(
  db: DatabaseSync,
  truck: { carrierId: number; code: string; number: string; driver: string },
): number {
  return Number(
    db
      .prepare('INSERT INTO trucks (carrier_id, code, number, driver) VALUES (?, ?, ?, ?)')
      .run(truck.carrierId, truck.code, truck.number, truck.driver).lastInsertRowid,
  );
}

/** Re-plate, re-driver, or hand the truck to another carrier — «توزيع». */
export function updateTruck(
  db: DatabaseSync,
  id: number,
  truck: { carrierId: number; code: string; number: string; driver: string },
): void {
  db.prepare(
    'UPDATE trucks SET carrier_id = ?, code = ?, number = ?, driver = ? WHERE id = ? AND deleted_at IS NULL',
  ).run(truck.carrierId, truck.code, truck.number, truck.driver, id);
}

export function softDeleteTruck(db: DatabaseSync, id: number, at: string): void {
  db.prepare('UPDATE trucks SET deleted_at = ? WHERE id = ?').run(at, id);
}

/**
 * Every plate spelling the gate has recorded on a live container, with how
 * many gate movements it made and the driver name most recently typed beside
 * it — the raw material «توزيع السيارات» filters against the registry.
 * Newest first within each plate, so `driver` and the display spelling are
 * the latest word the gate had.
 */
export function listPlateUsage(
  db: DatabaseSync,
): Array<{ plate: string; at: string; driver: string }> {
  return db
    .prepare(
      `SELECT truck_in AS plate, driver_in AS driver, entered_at AS at
         FROM containers WHERE deleted_at IS NULL AND truck_in <> ''
       UNION ALL
       SELECT truck_out AS plate, driver_out AS driver, exited_at AS at
         FROM containers
        WHERE deleted_at IS NULL AND truck_out <> '' AND exited_at IS NOT NULL
       ORDER BY at DESC`,
    )
    .all() as unknown as Array<{ plate: string; at: string; driver: string }>;
}

/**
 * دفتر اللوحات: one row per plate the gate has ever written, carrying the
 * LAST driver name typed beside it — «بدي مجرد ما كتبت رقم سيارته خلص يكتب
 * اسمه تلقائي». Folded here rather than in SQL because a plate's identity is
 * its normalized text (src/shared/fleet.ts), which SQL cannot be trusted
 * with. Sixty-odd rows for this yard, so the whole book travels at once and
 * the lookup is a memory hit with no round trip per keystroke.
 *
 * A name with no letter in it — the placeholder «-» a tired hand types — is
 * passed over, so the fold falls through to the last REAL name instead.
 */
export function listPlateDrivers(db: DatabaseSync): PlateDriver[] {
  const book = new Map<string, PlateDriver>();
  for (const row of listPlateUsage(db)) {
    const plate = normalizePlate(row.plate);
    if (plate === '' || book.has(plate)) continue;
    if (!/\p{L}/u.test(row.driver)) continue;
    book.set(plate, { plate, driver: row.driver.trim(), at: row.at });
  }
  return [...book.values()];
}

/**
 * Every gate movement in [from, to), both directions — the pool the carrier
 * register is sieved out of. The sieve itself (which plates are this
 * carrier's) is normalized-text matching, which SQL cannot be trusted with;
 * the route filters these rows through src/shared/fleet.ts.
 */
export function listGateMovementsBoth(
  db: DatabaseSync,
  fromIso: string,
  toIso: string,
): Array<GateReportRowInternal & { type: 'IN' | 'OUT' }> {
  const rows = db
    .prepare(
      `SELECT m.type, m.container_id, m.at, m.user_id,
              m.from_zone, m.from_bay, m.from_stack, m.from_tier,
              m.to_zone, m.to_bay, m.to_stack, m.to_tier,
              k.zone AS live_zone, k.bay AS live_bay, k.stack AS live_stack, k.tier AS live_tier,
              k.number, k.size, k.bill, k.weight, k.notes,
              k.truck_in, k.driver_in, k.seal_in, k.card_in, k.card_in_year,
              k.truck_out, k.driver_out, k.seal_out, k.card_out, k.card_out_year,
              k.entered_at
       FROM movements m
       JOIN containers k ON k.id = m.container_id
       WHERE m.at >= ? AND m.at < ? AND m.type IN ('IN', 'OUT')
         AND k.deleted_at IS NULL
         AND (m.type <> 'OUT' OR ${OUT_STANDS})
       ORDER BY m.at, m.id`,
    )
    .all(fromIso, toIso) as unknown as Array<MovementRow & GateRow>;
  const names = listUserNames(db);
  return rows.map((row) => {
    const type = row.type === 'IN' ? ('IN' as const) : ('OUT' as const);
    return {
      type,
      containerId: row.container_id,
      at: row.at,
      card: type === 'IN' ? row.card_in : row.card_out,
      cardYear: type === 'IN' ? row.card_in_year : row.card_out_year,
      truck: type === 'IN' ? row.truck_in : row.truck_out,
      driver: type === 'IN' ? row.driver_in : row.driver_out,
      seal: row.seal_in,
      number: row.number,
      bill: row.bill,
      weight: row.weight,
      notes: row.notes,
      size: row.size as Size,
      position:
        slotOf(row.live_zone, row.live_bay, row.live_stack, row.live_tier) ??
        (type === 'IN'
          ? slotOf(row.to_zone, row.to_bay, row.to_stack, row.to_tier)
          : slotOf(row.from_zone, row.from_bay, row.from_stack, row.from_tier)),
      user: userLabel(names, row.user_id),
      enteredAt: row.entered_at,
    };
  });
}

// ---------------------------------------------------------------------------
// تصريح تحميل وخروج داخلي — the permit ledger. One bill, its containers as
// listed the moment the paper was issued, and the truck assigned to each.
// A numbered yearly ledger like the gate cards, held to the same 1 … N rule.
// ---------------------------------------------------------------------------

interface PermitRow {
  id: number;
  serial: number;
  serial_year: number;
  bill: string;
  yard: number;
  at: string;
  user_id: number | null;
  deleted_at: string | null;
}

/** The next serial in this year's permit book, counted over live permits. */
export function nextPermitNumber(db: DatabaseSync, year: number): number {
  const row = db
    .prepare(
      // A voided permit keeps its number for ever, like every other paper
      // that left the office under a stamp.
      'SELECT MAX(serial) AS top FROM permits WHERE serial_year = ?',
    )
    .get(year) as { top: number | null };
  return (row.top ?? 0) + 1;
}

export function insertPermit(
  db: DatabaseSync,
  permit: {
    serial: number;
    serialYear: number;
    bill: string;
    at: string;
    userId: number | null;
    /** The yard the paper names, read off the containers at issue time. */
    yard: number;
    /** Each line pins the container's facts as the paper is issued. */
    items: ReadonlyArray<{
      containerId: number;
      truck: string;
      number: string;
      cardIn: number | null;
      cardInYear: number | null;
      enteredAt: string;
      weight: string;
      /** v24: pinned, now that «تصحيح الفئة» can change the live one. */
      size: Size;
    }>;
  },
): number {
  const id = Number(
    db
      .prepare(
        'INSERT INTO permits (serial, serial_year, bill, at, user_id, yard) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(permit.serial, permit.serialYear, permit.bill, permit.at, permit.userId, permit.yard)
      .lastInsertRowid,
  );
  const addItem = db.prepare(
    `INSERT INTO permit_items
       (permit_id, container_id, truck, number, card_in, card_in_year, entered_at, weight, size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of permit.items) {
    addItem.run(
      id,
      item.containerId,
      item.truck,
      item.number,
      item.cardIn,
      item.cardInYear,
      item.enteredAt,
      item.weight,
      item.size,
    );
  }
  return id;
}

/** One permit with its items — the paper exactly as it was issued. */
export function getPermit(db: DatabaseSync, id: number): PermitDto | null {
  const row = db.prepare('SELECT * FROM permits WHERE id = ? AND deleted_at IS NULL').get(id) as
    | PermitRow
    | undefined;
  if (row === undefined) return null;
  const names = listUserNames(db);
  // The lines are read from the permit's own snapshot, never from the live
  // container: what left the office under the stamp is what a reprint says,
  // even after the container is corrected, renumbered or struck out.
  //
  // The size used to join live, licensed by a lock that no longer exists:
  // «تصحيح الفئة» can now change it, and a stamped paper's «عشرين / أربعين»
  // totals line must not change under the customs officer holding it. Pinned
  // at v24 like every other fact on the line.
  const items = db
    .prepare(
      `SELECT i.container_id, i.truck, i.number, i.card_in, i.card_in_year, i.entered_at,
              i.weight, i.size
       FROM permit_items i
       WHERE i.permit_id = ? AND i.deleted_at IS NULL
       ORDER BY i.id`,
    )
    .all(id) as unknown as Array<{
    container_id: number;
    truck: string;
    number: string;
    card_in: number | null;
    card_in_year: number | null;
    entered_at: string;
    weight: string;
    size: number;
  }>;
  return {
    id: row.id,
    serial: row.serial,
    serialYear: row.serial_year,
    bill: row.bill,
    at: row.at,
    yard: row.yard,
    user: userLabel(names, row.user_id),
    items: items.map((item) => ({
      containerId: item.container_id,
      number: item.number,
      cardIn: item.card_in,
      cardInYear: item.card_in_year,
      enteredAt: item.entered_at,
      weight: item.weight,
      size: (item.size === 40 ? 40 : 20) as Size,
      truck: item.truck,
    })),
  };
}

/**
 * Strike containers off an issued permit — «اجاني مخلص قلي انا بدي اخرج 15
 * حاوية اليوم وكذب، قام جاب فقط 5 سيارات … اريد ان استطيع ان اعدل على
 * التصريح … دون الحاجة لحذف التصريح». The paper keeps its number and its
 * date; only the lines that never left are struck, and they stay in the
 * file with the hand and the hour that struck them.
 */
export function dropPermitItems(
  db: DatabaseSync,
  permitId: number,
  containerIds: readonly number[],
  at: string,
  byId: number | null,
): number {
  if (containerIds.length === 0) return 0;
  const marks = containerIds.map(() => '?').join(', ');
  return Number(
    db
      .prepare(
        `UPDATE permit_items SET deleted_at = ?, deleted_by = ?
          WHERE permit_id = ? AND deleted_at IS NULL AND container_id IN (${marks})`,
      )
      .run(at, byId, permitId, ...containerIds).changes,
  );
}

/** How many lines this permit still carries — the guard against an empty paper. */
export function permitItemCount(db: DatabaseSync, permitId: number): number {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS n FROM permit_items WHERE permit_id = ? AND deleted_at IS NULL',
    )
    .get(permitId) as { n: number };
  return row.n;
}

/** كشف خروج وتحميل داخلي: the permits issued in [from, to), oldest first. */
export function listPermits(db: DatabaseSync, fromIso: string, toIso: string): PermitReportRow[] {
  const names = listUserNames(db);
  const rows = db
    .prepare(
      // BY NUMBER, not by the clock. The permit register is a numbered
      // BOOK: the clerk walks down it looking for a serial, and the row
      // counter beside it has to agree with the number printed on the
      // paper. Ordered by time they part company the moment a serial is
      // reissued out of sequence — «فتحت التسلسل 290 طلعتلي 293».
      `SELECT p.*, (SELECT COUNT(*) FROM permit_items i
                 WHERE i.permit_id = p.id AND i.deleted_at IS NULL) AS containers
       FROM permits p
       WHERE p.at >= ? AND p.at < ? AND p.deleted_at IS NULL
       ORDER BY p.serial_year, p.serial, p.id`,
    )
    .all(fromIso, toIso) as unknown as Array<PermitRow & { containers: number }>;
  const live: PermitReportRow[] = rows.map((row) => ({
    id: row.id,
    serial: row.serial,
    serialYear: row.serial_year,
    at: row.at,
    bill: row.bill,
    containers: row.containers,
    user: userLabel(names, row.user_id),
    yard: row.yard,
  }));

  // The struck permits of the same period tell where the book REACHES: a
  // voided newest permit must show its stub at once, not wait for the next
  // one to be issued above it.
  const struck = db
    .prepare(
      `SELECT serial, serial_year, at, yard FROM permits
       WHERE at >= ? AND at < ? AND deleted_at IS NOT NULL`,
    )
    .all(fromIso, toIso) as unknown as Array<{
    serial: number;
    serial_year: number;
    at: string;
    yard: number;
  }>;
  return withVoidedPermits(live, struck);
}

/**
 * تصريح ملغى — «بدي اذا حذفت تصريح بدي يعمل مثل ما بعمل ببطاقات الخروج
 * بحيث يحط تصريح ملغي بس اقدر اطبعه لحتى ما يكون في فجوات بالتسلسل».
 *
 * Every serial of a year, from the lowest the period reaches to the highest,
 * that NO live permit carries gets a stub in its own seat. The stub is
 * decided by the live set alone, never by a struck row: a number whose
 * cancelled paper was reissued to a live permit (290 and 291, 2026) is not
 * a hole, and must not be shown twice.
 */
function withVoidedPermits(
  live: readonly PermitReportRow[],
  struck: ReadonlyArray<{ serial: number; serial_year: number; at: string; yard: number }>,
): PermitReportRow[] {
  const years = new Set<number>([
    ...live.map((row) => row.serialYear),
    ...struck.map((row) => row.serial_year),
  ]);
  const out: PermitReportRow[] = [];
  for (const year of [...years].sort((a, b) => a - b)) {
    const mine = live.filter((row) => row.serialYear === year);
    const gone = struck.filter((row) => row.serial_year === year);
    const taken = new Set(mine.map((row) => row.serial));
    const reach = [...mine.map((row) => row.serial), ...gone.map((row) => row.serial)];
    if (reach.length === 0) continue;
    const low = Math.min(...reach);
    const high = Math.max(...reach);
    const bySerial = new Map<number, PermitReportRow[]>();
    for (const row of mine) bySerial.set(row.serial, [...(bySerial.get(row.serial) ?? []), row]);
    let previous: PermitReportRow | undefined;
    for (let serial = low; serial <= high; serial += 1) {
      if (taken.has(serial)) {
        for (const row of bySerial.get(serial) ?? []) {
          out.push(row);
          previous = row;
        }
        continue;
      }
      const paper = gone.find((row) => row.serial === serial);
      out.push({
        id: 0,
        serial,
        serialYear: year,
        // The instant of its own struck paper when there is one; otherwise
        // the paper before it. Never shown — the stub prints dashes.
        at: paper?.at ?? previous?.at ?? mine[0]?.at ?? '',
        bill: '',
        containers: 0,
        user: '',
        yard: paper?.yard ?? previous?.yard ?? mine[0]?.yard ?? 2,
        voided: true,
      });
    }
  }
  return out;
}

export function softDeletePermit(db: DatabaseSync, id: number, at: string): void {
  db.prepare('UPDATE permits SET deleted_at = ? WHERE id = ?').run(at, id);
}


// ---- الزونات التي يعرّفها المالك ----

interface CustomZoneRow {
  id: number;
  yard: number;
  name: string;
  bays: number;
  stacks: number;
  closed: string;
  x: number | null;
  y: number | null;
}

/** The closed slots come out of JSON defensively: a bad pair is dropped. */
function toCustomZone(row: CustomZoneRow): CustomZoneDto {
  let closed: ReadonlyArray<readonly [number, number]> = [];
  try {
    const parsed: unknown = JSON.parse(row.closed);
    if (Array.isArray(parsed)) {
      closed = parsed
        .filter(
          (pair): pair is [number, number] =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            Number.isInteger(pair[0]) &&
            Number.isInteger(pair[1]),
        )
        .map((pair) => [pair[0], pair[1]] as const);
    }
  } catch {
    closed = [];
  }
  return {
    id: row.id,
    yard: row.yard,
    zone: row.name,
    bays: row.bays,
    stacks: row.stacks,
    closed,
    x: row.x,
    y: row.y,
  };
}

export function listCustomZones(db: DatabaseSync): CustomZoneDto[] {
  const rows = db
    .prepare('SELECT * FROM custom_zones WHERE deleted_at IS NULL ORDER BY id')
    .all() as unknown as CustomZoneRow[];
  return rows.map(toCustomZone);
}

/**
 * The letters of struck zones that history still needs: a zone that ever
 * held a container keeps naming its yard — old papers print 1-F-… after
 * zone F is gone, so no new zone may take the letter. But a zone deleted
 * before any box ever stood in it left no paper behind: its letter comes
 * back free («حذفته واريد ادخال نفس الرمز») and the struck row stays in
 * the table as archaeology only. One row per letter — the newest — and
 * none where a living zone owns the letter, so the registry never forks.
 *
 * Asked inside every yard-write transaction (the effective layout is
 * composed per request), so each arm probes its own index: one EXISTS per
 * movement column, never an OR across two — SQLite cannot use an index for
 * either side of an OR, and the scan it falls back to costs a third of a
 * second on a full history.
 */
export function listRetiredZones(db: DatabaseSync): RetiredZoneDto[] {
  const rows = db
    .prepare(
      `SELECT name, yard FROM custom_zones z
        WHERE z.deleted_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM custom_zones l
                           WHERE l.name = z.name AND l.deleted_at IS NULL)
          AND z.id = (SELECT MAX(w.id) FROM custom_zones w
                       WHERE w.name = z.name AND w.deleted_at IS NOT NULL)
          AND (EXISTS (SELECT 1 FROM movements m WHERE m.from_zone = z.name)
            OR EXISTS (SELECT 1 FROM movements m WHERE m.to_zone = z.name)
            OR EXISTS (SELECT 1 FROM containers k WHERE k.zone = z.name))
        ORDER BY z.id`,
    )
    .all() as unknown as Array<{ name: string; yard: number }>;
  return rows.map((row) => ({ zone: row.name, yard: row.yard }));
}

export function getCustomZone(db: DatabaseSync, id: number): CustomZoneDto | null {
  const row = db
    .prepare('SELECT * FROM custom_zones WHERE id = ? AND deleted_at IS NULL')
    .get(id) as CustomZoneRow | undefined;
  return row === undefined ? null : toCustomZone(row);
}

export function insertCustomZone(
  db: DatabaseSync,
  zone: { yard: number; name: string; bays: number; stacks: number },
): number {
  return Number(
    db
      .prepare('INSERT INTO custom_zones (yard, name, bays, stacks) VALUES (?, ?, ?, ?)')
      .run(zone.yard, zone.name, zone.bays, zone.stacks).lastInsertRowid,
  );
}

export function updateCustomZone(
  db: DatabaseSync,
  id: number,
  shape: {
    bays: number;
    stacks: number;
    closed: ReadonlyArray<readonly [number, number]>;
    x: number | null;
    y: number | null;
  },
): void {
  db.prepare(
    'UPDATE custom_zones SET bays = ?, stacks = ?, closed = ?, x = ?, y = ? WHERE id = ?',
  ).run(shape.bays, shape.stacks, JSON.stringify(shape.closed), shape.x, shape.y, id);
}

export function softDeleteCustomZone(db: DatabaseSync, id: number, at: string): void {
  db.prepare('UPDATE custom_zones SET deleted_at = ? WHERE id = ?').run(at, id);
}

// ---------------------------------------------------------------- photos ----

/** The photos a container carries, facts only — the bytes are served by id. */
export function listPhotos(db: DatabaseSync, containerId: number): PhotoDto[] {
  return db
    .prepare(
      `SELECT id, mime, size, at FROM photos
       WHERE container_id = ? AND deleted_at IS NULL ORDER BY id`,
    )
    .all(containerId) as unknown as PhotoDto[];
}

export function getPhoto(
  db: DatabaseSync,
  id: number,
): { mime: string; bytes: Uint8Array } | null {
  const row = db
    .prepare('SELECT mime, bytes FROM photos WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { mime: string; bytes: Uint8Array } | undefined;
  return row === undefined ? null : row;
}

export function insertPhoto(
  db: DatabaseSync,
  photo: {
    containerId: number;
    mime: string;
    bytes: Uint8Array;
    at: string;
    userId: number | null;
  },
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO photos (container_id, mime, bytes, size, at, user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        photo.containerId,
        photo.mime,
        photo.bytes,
        photo.bytes.byteLength,
        photo.at,
        photo.userId,
      ).lastInsertRowid,
  );
}

export function softDeletePhoto(db: DatabaseSync, id: number, at: string): boolean {
  return (
    db.prepare('UPDATE photos SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(at, id)
      .changes > 0
  );
}

// ----------------------------------------------------------------- wages ----

/**
 * Every haul of the period: the container's IN and its OUT are two separate
 * hauls, because «قد يكون حملت هذه السيارة اكثر من مره» — the figure and the
 * receipt belong to the haul, never to the truck.
 *
 * A blank driver name does NOT drop the haul. The name is optional at the
 * gate, and filtering on it once hid eight real hauls from the wage book
 * with nothing to say they existed — «بعطي 77 وهاد الشي غير صحيح». A haul
 * with no name is carried by its PLATE instead («ضعها تحت نفس رقم
 * السيارة»), which is why the sheet's total now equals كشف السيارات for the
 * same period. The nameless sort FIRST — '' precedes every name — so the
 * hauls still waiting for a name open the sheet instead of hiding at its end.
 */
export function listHauls(db: DatabaseSync, fromIso: string, toIso: string): DriverHaulRow[] {
  const names = listUserNames(db);
  const rows = db
    .prepare(
      `SELECT c.id AS containerId, 'IN' AS direction, c.number AS number,
              c.size AS size, c.bill AS bill, c.truck_in AS truck,
              c.driver_in AS driver, c.entered_at AS at,
              c.card_in AS card, c.card_in_year AS cardYear,
              w.amount AS amount, w.paid_at AS paidAt, w.paid_by AS paidBy
       FROM containers c
       LEFT JOIN wages w
         ON w.container_id = c.id AND w.direction = 'IN' AND w.deleted_at IS NULL
       WHERE c.deleted_at IS NULL
         AND c.entered_at >= ? AND c.entered_at < ?
       UNION ALL
       SELECT c.id, 'OUT', c.number, c.size, c.bill, c.truck_out,
              c.driver_out, c.exited_at, c.card_out, c.card_out_year,
              w.amount, w.paid_at, w.paid_by
       FROM containers c
       LEFT JOIN wages w
         ON w.container_id = c.id AND w.direction = 'OUT' AND w.deleted_at IS NULL
       WHERE c.deleted_at IS NULL AND c.exited_at IS NOT NULL
         AND c.exited_at >= ? AND c.exited_at < ?
       ORDER BY driver, at, containerId`,
    )
    .all(fromIso, toIso, fromIso, toIso) as unknown as Array<
    Omit<DriverHaulRow, 'paidBy'> & { paidBy: number | null }
  >;
  return rows.map((row) => ({
    ...row,
    paidBy:
      row.paidAt === null
        ? null
        : row.paidBy === null
          ? OWNER_NAME
          : (names[String(row.paidBy)] ?? OWNER_NAME),
  }));
}

export function getWage(
  db: DatabaseSync,
  containerId: number,
  direction: HaulDirection,
): { amount: number; paidAt: string | null } | null {
  const row = db
    .prepare(
      `SELECT amount, paid_at AS paidAt FROM wages
       WHERE container_id = ? AND direction = ? AND deleted_at IS NULL`,
    )
    .get(containerId, direction) as { amount: number; paidAt: string | null } | undefined;
  return row === undefined ? null : row;
}

/** Write (or rewrite) the figure of one haul — the amount alone, no receipt. */
export function setWage(
  db: DatabaseSync,
  wage: {
    containerId: number;
    direction: HaulDirection;
    amount: number;
    at: string;
    userId: number | null;
  },
): void {
  const changed = db
    .prepare(
      `UPDATE wages SET amount = ?, at = ?, user_id = ?
       WHERE container_id = ? AND direction = ? AND deleted_at IS NULL`,
    )
    .run(wage.amount, wage.at, wage.userId, wage.containerId, wage.direction).changes;
  if (changed === 0) {
    db.prepare(
      `INSERT INTO wages (container_id, direction, amount, at, user_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(wage.containerId, wage.direction, wage.amount, wage.at, wage.userId);
  }
}

/**
 * The figure ERASED, not zeroed: clearing the box on the screen used to leave
 * the old amount standing in the book — «ومسحه … تبقى القيمة موجودة». Soft
 * delete, like every other record here, so the struck figure stays auditable.
 */
export function clearWage(
  db: DatabaseSync,
  containerId: number,
  direction: HaulDirection,
  at: string,
): boolean {
  return (
    db
      .prepare(
        `UPDATE wages SET deleted_at = ?
          WHERE container_id = ? AND direction = ? AND deleted_at IS NULL`,
      )
      .run(at, containerId, direction).changes > 0
  );
}

/** Stamp — or lift — the receipt: the driver took this haul's wage. */
export function setWagePaid(
  db: DatabaseSync,
  receipt: {
    containerId: number;
    direction: HaulDirection;
    paid: boolean;
    at: string;
    userId: number | null;
  },
): void {
  db.prepare(
    `UPDATE wages SET paid_at = ?, paid_by = ?
     WHERE container_id = ? AND direction = ? AND deleted_at IS NULL`,
  ).run(
    receipt.paid ? receipt.at : null,
    receipt.paid ? receipt.userId : null,
    receipt.containerId,
    receipt.direction,
  );
}

// ------------------------------------------------------ correcting a move ----

/** Whose record a movement belongs to — the correction's first question. */
export function movementContainerId(db: DatabaseSync, id: number): number | null {
  const row = db
    .prepare('SELECT container_id AS containerId FROM movements WHERE id = ?')
    .get(id) as { containerId: number } | undefined;
  return row === undefined ? null : row.containerId;
}

/** The movement that last put this container somewhere — only IT corrects. */
export function latestPlacementId(db: DatabaseSync, containerId: number): number | null {
  const row = db
    .prepare(
      `SELECT id FROM movements WHERE container_id = ? AND to_zone IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
    )
    .get(containerId) as { id: number } | undefined;
  return row === undefined ? null : row.id;
}

/**
 * Rewrite where a move landed. The correction IS the record — a reprint of
 * the move's card reads the corrected slot; no second card is born.
 */
export function retargetMovement(db: DatabaseSync, id: number, to: Position): void {
  db.prepare(
    'UPDATE movements SET to_zone = ?, to_bay = ?, to_stack = ?, to_tier = ? WHERE id = ?',
  ).run(to.zone, to.bay, to.stack, to.tier, id);
}

/**
 * The mirror of `retargetMovement` for a departure: an OUT movement keeps the
 * slot it LEFT in `from_*`, and that is the address «إلغاء الخروج» reads back
 * to stand the container up again. Correcting the class of a container that
 * has gone must move this with it, or the record remembers a slot whose
 * parity contradicts its own class and can never be un-exited.
 */
export function refromMovement(db: DatabaseSync, id: number, from: Position): void {
  db.prepare(
    'UPDATE movements SET from_zone = ?, from_bay = ?, from_stack = ?, from_tier = ? WHERE id = ?',
  ).run(from.zone, from.bay, from.stack, from.tier, id);
}

/** The id of the departure whose slot `lastExitPosition` reads. */
export function lastExitMovementId(db: DatabaseSync, id: number): number | null {
  const row = db
    .prepare(
      `SELECT id FROM movements WHERE container_id = ? AND type = 'OUT'
       ORDER BY at DESC, id DESC LIMIT 1`,
    )
    .get(id) as { id: number } | undefined;
  return row === undefined ? null : row.id;
}

// ------------------------------------------------------ دفعات كشف الجمارك ----
// The transfer sheet, kept as the paper's literal mirror. A row stores what
// the sheet said and NOTHING about arrival: whether the container has come is
// computed here, at read time, by joining its normalized number against the
// yard book — so delete, restore and unexit all heal the statuses by
// themselves, and the gate's own transactions are never touched.

export interface NewBatch {
  name: string;
  filename: string;
  at: string;
  /** Who uploaded — null for the owner, as movements record it. */
  createdBy: number | null;
}

export function insertBatch(db: DatabaseSync, batch: NewBatch): number {
  const result = db
    .prepare('INSERT INTO batches (name, filename, created_at, created_by) VALUES (?, ?, ?, ?)')
    .run(batch.name, batch.filename, batch.at, batch.createdBy);
  return Number(result.lastInsertRowid);
}

export function insertBatchRows(
  db: DatabaseSync,
  batchId: number,
  rows: readonly SheetRow[],
): void {
  const insert = db.prepare(
    `INSERT INTO batch_rows (batch_id, seq, number, size, size_raw, bill, line_op)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(batchId, row.seq, row.number, row.size, row.sizeRaw, row.bill, row.lineOp);
  }
}

export function listBatches(db: DatabaseSync): BatchSummaryDto[] {
  const rows = db
    .prepare(
      `SELECT b.id, b.name, b.filename, b.created_at, b.created_by,
              COUNT(r.id) AS total,
              COALESCE(SUM(EXISTS (
                SELECT 1 FROM containers c
                 WHERE c.number = r.number AND c.deleted_at IS NULL)), 0) AS arrived
         FROM batches b
         LEFT JOIN batch_rows r ON r.batch_id = b.id
        WHERE b.deleted_at IS NULL
        GROUP BY b.id
        ORDER BY b.id DESC`,
    )
    .all() as unknown as Array<{
    id: number;
    name: string;
    filename: string;
    created_at: string;
    created_by: number | null;
    total: number;
    arrived: number;
  }>;
  const names = listUserNames(db);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    filename: row.filename,
    createdAt: row.created_at,
    createdBy: userLabel(names, row.created_by),
    total: row.total,
    arrived: row.arrived,
  }));
}

interface BatchRowJoined {
  id: number;
  seq: number | null;
  number: string;
  size: number | null;
  size_raw: string;
  bill: string;
  line_op: string;
  container_id: number | null;
  entered_at: string | null;
  exited_at: string | null;
  standing: number | null;
}

const toBatchRow = (row: BatchRowJoined): BatchRowDto => {
  const status: BatchRowStatus =
    row.container_id === null ? 'PENDING' : row.standing === 1 ? 'STANDING' : 'EXITED';
  return {
    id: row.id,
    seq: row.seq,
    number: row.number,
    size: row.size === 20 ? 20 : row.size === 40 ? 40 : null,
    sizeRaw: row.size_raw,
    bill: row.bill,
    lineOp: row.line_op,
    status,
    containerId: row.container_id,
    enteredAt: row.entered_at,
    exitedAt: row.exited_at,
  };
};

export function getBatch(db: DatabaseSync, id: number): BatchDto | null {
  const head = db
    .prepare(
      `SELECT id, name, filename, created_at, created_by
         FROM batches WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id) as
    | { id: number; name: string; filename: string; created_at: string; created_by: number | null }
    | undefined;
  if (head === undefined) return null;

  // Each row meets the LATEST live visit of its number — a container that
  // left and came back answers with the visit that is standing now.
  const rows = db
    .prepare(
      `SELECT r.id, r.seq, r.number, r.size, r.size_raw, r.bill, r.line_op,
              c.id AS container_id, c.entered_at, c.exited_at,
              (c.zone IS NOT NULL) AS standing
         FROM batch_rows r
         LEFT JOIN containers c ON c.id = (
           SELECT c2.id FROM containers c2
            WHERE c2.number = r.number AND c2.deleted_at IS NULL
            ORDER BY c2.entered_at DESC, c2.id DESC LIMIT 1)
        WHERE r.batch_id = ?
        ORDER BY r.id`,
    )
    .all(id) as unknown as BatchRowJoined[];

  const names = listUserNames(db);
  return {
    id: head.id,
    name: head.name,
    filename: head.filename,
    createdAt: head.created_at,
    createdBy: userLabel(names, head.created_by),
    rows: rows.map(toBatchRow),
  };
}

/**
 * تعديل اسم الكشف: the name is the office's own label for a دفعة — taken
 * from the file it arrived in and often wrong there — not a fact the sheet
 * carried. It is the one thing about a batch that may be corrected; the rows
 * are what the customs sheet said and they never change.
 */
export function renameBatch(db: DatabaseSync, id: number, name: string): void {
  db.prepare('UPDATE batches SET name = ? WHERE id = ? AND deleted_at IS NULL').run(name, id);
}

export function softDeleteBatch(db: DatabaseSync, id: number, at: string): void {
  db.prepare('UPDATE batches SET deleted_at = ? WHERE id = ?').run(at, id);
}

/**
 * The gate's live question: does any live دفعة still EXPECT this number?
 * A row already answered by a live yard record — standing or exited — is no
 * longer open, so a stale sheet can never fill a bill onto a returning box.
 * The newest batch answers when two sheets carry the same number.
 */
export function lookupOpenBatchRow(db: DatabaseSync, number: string): BatchMatch | null {
  const row = db
    .prepare(
      `SELECT r.batch_id, b.name, r.size, r.bill
         FROM batch_rows r
         JOIN batches b ON b.id = r.batch_id AND b.deleted_at IS NULL
        WHERE r.number = ?
          AND NOT EXISTS (
            SELECT 1 FROM containers c
             WHERE c.number = r.number AND c.deleted_at IS NULL)
        ORDER BY b.id DESC, r.id LIMIT 1`,
    )
    .get(number) as
    | { batch_id: number; name: string; size: number | null; bill: string }
    | undefined;
  if (row === undefined) return null;
  return {
    batchId: row.batch_id,
    batchName: row.name,
    size: row.size === 20 ? 20 : row.size === 40 ? 40 : null,
    bill: row.bill,
  };
}

// ------------------------------------------------ أجور على سجلات محذوفة ----

/**
 * Every live figure whose haul no longer exists: the record was struck after
 * the wage was written (or paid). `listHauls` reads live records only, so
 * these would otherwise stand invisible — «أضيف طريقة لإلغاء أجر على سجل
 * محذوف من كشف الحساب».
 */
export function listOrphanWages(db: DatabaseSync): OrphanWageRow[] {
  const names = listUserNames(db);
  const rows = db
    .prepare(
      `SELECT w.container_id AS containerId, w.direction AS direction, c.number AS number,
              CASE w.direction WHEN 'IN' THEN c.truck_in ELSE c.truck_out END AS truck,
              CASE w.direction WHEN 'IN' THEN c.driver_in ELSE c.driver_out END AS driver,
              CASE w.direction WHEN 'IN' THEN c.entered_at ELSE c.exited_at END AS at,
              w.amount AS amount, w.paid_at AS paidAt, w.paid_by AS paidBy,
              c.deleted_at AS deletedAt
         FROM wages w
         JOIN containers c ON c.id = w.container_id
        WHERE w.deleted_at IS NULL AND c.deleted_at IS NOT NULL
        ORDER BY c.deleted_at DESC, w.container_id, w.direction`,
    )
    .all() as unknown as Array<Omit<OrphanWageRow, 'paidBy'> & { paidBy: number | null }>;
  return rows.map((row) => ({
    ...row,
    paidBy:
      row.paidAt === null
        ? null
        : row.paidBy === null
          ? OWNER_NAME
          : (names[String(row.paidBy)] ?? OWNER_NAME),
  }));
}

/**
 * أي حاويات هذه لها تصريح حيّ بالفعل — «تنبيه عند إصدار تصريح ثانٍ لنفس
 * الحاوية». Found live: 86 containers carry two papers or more, because a
 * clerk wanting a second copy issued a NEW permit instead of reprinting the
 * one that exists. The screen warns before the stamp; nothing is refused.
 */
export function permitsOfContainers(
  db: DatabaseSync,
  ids: readonly number[],
): Array<{ containerId: number; serial: number; serialYear: number; at: string }> {
  if (ids.length === 0) return [];
  const marks = ids.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT i.container_id AS containerId, p.serial AS serial,
              p.serial_year AS serialYear, p.at AS at
         FROM permit_items i
         JOIN permits p ON p.id = i.permit_id
        WHERE p.deleted_at IS NULL AND i.deleted_at IS NULL AND i.container_id IN (${marks})
        ORDER BY p.serial_year, p.serial`,
    )
    .all(...ids) as unknown as Array<{
    containerId: number;
    serial: number;
    serialYear: number;
    at: string;
  }>;
}

// ------------------------------------------------------ نداء إدخال شاحنة ----
// The machine calls the gate: a truck is standing here, come and record it.
// Answered, never deleted — the same work-ledger discipline as the tasks.

// The row's shape lives in src/shared/types.ts, so the banner the clerk
// reads and the row the server builds can never drift apart.
export type { GateCallRow };

interface GateCallDb {
  id: number;
  at: string;
  by_user: number | null;
  machine: string;
  status: string;
  done_at: string | null;
  done_by: number | null;
  task_id: number | null;
  // Joined through the task, so a plate corrected afterwards corrects the
  // banner with it. Null on the bare call that names no box.
  task_kind: string | null;
  task_truck: string | null;
  container_id: number | null;
  number: string | null;
  truck_in: string | null;
  driver_in: string | null;
  truck_out: string | null;
  driver_out: string | null;
}

/**
 * The call and the work it is for, in one read. LEFT JOINs throughout: a
 * bare call (task_id NULL) and a call whose container was later struck out
 * both still answer — the clerk must always be able to close the banner.
 */
const GATE_CALL_SELECT = `
  SELECT g.id, g.at, g.by_user, g.machine, g.status, g.done_at, g.done_by, g.task_id,
         t.kind AS task_kind, t.truck AS task_truck, t.container_id AS container_id,
         k.number AS number, k.truck_in AS truck_in, k.driver_in AS driver_in,
         k.truck_out AS truck_out, k.driver_out AS driver_out
    FROM gate_calls g
    LEFT JOIN tasks t ON t.id = g.task_id
    LEFT JOIN containers k ON k.id = t.container_id`;

/**
 * Which truck the clerk is being told to admit — the task's own rule, so
 * the machine's card and the gate's banner can never name two trucks. A
 * bare call (no task) names none, which is what it always was.
 */
const callTruckOf = (row: GateCallDb): { truck: string; driver: string } =>
  row.task_kind === null
    ? { truck: '', driver: '' }
    : gateTruckOf({
        kind: row.task_kind,
        truck: row.task_truck,
        truck_in: row.truck_in,
        driver_in: row.driver_in,
        truck_out: row.truck_out,
        driver_out: row.driver_out,
      });

const toGateCall = (row: GateCallDb, names: Readonly<Record<string, string>>): GateCallRow => ({
  id: row.id,
  at: row.at,
  by: userLabel(names, row.by_user),
  machine: row.machine,
  status: row.status === 'DONE' ? 'DONE' : 'PENDING',
  doneAt: row.done_at,
  doneBy: row.done_at === null ? null : userLabel(names, row.done_by),
  taskId: row.task_id,
  containerId: row.container_id,
  number: row.number ?? '',
  ...callTruckOf(row),
});

export function insertGateCall(
  db: DatabaseSync,
  call: { at: string; byId: number | null; machine: string; taskId: number | null },
): number {
  const result = db
    .prepare('INSERT INTO gate_calls (at, by_user, machine, task_id) VALUES (?, ?, ?, ?)')
    .run(call.at, call.byId, call.machine, call.taskId);
  return Number(result.lastInsertRowid);
}

/**
 * The bare call — one PENDING per machine, «كبسة ادخال الشاحنة» pressed
 * twice is the same truck. A call that names a box is NOT one of these: two
 * boxes are two trucks, so they stand side by side.
 */
export function pendingGateCall(db: DatabaseSync, machine: string): GateCallRow | null {
  const row = db
    .prepare(
      `${GATE_CALL_SELECT} WHERE g.machine = ? AND g.status = 'PENDING' AND g.task_id IS NULL
        ORDER BY g.id LIMIT 1`,
    )
    .get(machine) as GateCallDb | undefined;
  return row === undefined ? null : toGateCall(row, listUserNames(db));
}

/** A second press on the SAME box is the same truck, so it answers with it. */
export function pendingGateCallForTask(db: DatabaseSync, taskId: number): GateCallRow | null {
  const row = db
    .prepare(`${GATE_CALL_SELECT} WHERE g.task_id = ? AND g.status = 'PENDING' ORDER BY g.id LIMIT 1`)
    .get(taskId) as GateCallDb | undefined;
  return row === undefined ? null : toGateCall(row, listUserNames(db));
}

export function listGateCalls(db: DatabaseSync, status: 'PENDING' | 'DONE'): GateCallRow[] {
  const rows = db
    .prepare(
      `${GATE_CALL_SELECT} WHERE g.status = ?
        ORDER BY ${status === 'PENDING' ? 'g.id' : 'g.done_at DESC, g.id DESC'} LIMIT 50`,
    )
    .all(status) as unknown as GateCallDb[];
  const names = listUserNames(db);
  return rows.map((row) => toGateCall(row, names));
}

export function getGateCall(db: DatabaseSync, id: number): GateCallRow | null {
  const row = db.prepare(`${GATE_CALL_SELECT} WHERE g.id = ?`).get(id) as GateCallDb | undefined;
  return row === undefined ? null : toGateCall(row, listUserNames(db));
}

export function answerGateCall(
  db: DatabaseSync,
  id: number,
  at: string,
  byId: number | null,
): void {
  db.prepare("UPDATE gate_calls SET status = 'DONE', done_at = ?, done_by = ? WHERE id = ?").run(
    at,
    byId,
    id,
  );
}
