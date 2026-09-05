import type { DatabaseSync } from 'node:sqlite';
import type {
  BillKind,
  CardSheetRow,
  CarrierDto,
  ContainerDto,
  CustomZoneDto,
  DriverHaulRow,
  HaulDirection,
  PermitDto,
  PermitReportRow,
  PhotoDto,
  RetiredZoneDto,
  Handling,
  LogReportRow,
  MachineReportRow,
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
import type { Standing } from '../shared/rules';
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
  live_zone: string | null;
  live_bay: number | null;
  live_stack: number | null;
  live_tier: string | null;
}

const TASK_SELECT = `
  SELECT t.*, k.number, k.size, k.bill, k.notes,
         k.zone AS live_zone, k.bay AS live_bay, k.stack AS live_stack, k.tier AS live_tier
    FROM tasks t
    JOIN containers k ON k.id = t.container_id`;

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
function movementOf(row: MovementRow): MovementDto {
  return {
    id: row.id,
    type: row.type as MovementType,
    at: row.at,
    from: slotOf(row.from_zone, row.from_bay, row.from_stack, row.from_tier),
    to: slotOf(row.to_zone, row.to_bay, row.to_stack, row.to_tier),
    note: row.note,
    card: row.card,
    cardYear: row.card_year,
  };
}

export function getMovement(db: DatabaseSync, id: number): MovementDto | null {
  const row = db.prepare('SELECT * FROM movements WHERE id = ?').get(id) as
    | unknown as MovementRow
    | undefined;
  return row === undefined ? null : movementOf(row);
}

export function listMovements(db: DatabaseSync, containerId: number): MovementDto[] {
  const rows = db
    .prepare('SELECT * FROM movements WHERE container_id = ? ORDER BY at, id')
    .all(containerId) as unknown as MovementRow[];
  return rows.map(movementOf);
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
  return (row.top ?? 0) + 1;
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
       ORDER BY m.at, m.id`,
    )
    .all(type, fromIso, toIso) as unknown as GateRow[];

  return rows.map((row) => ({
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
  const rows = db
    .prepare(
      `SELECT m.container_id, m.at, ${positionColumns},
              k.zone AS live_zone, k.bay AS live_bay, k.stack AS live_stack, k.tier AS live_tier,
              k.number, k.size, k.bill, k.weight, k.notes, k.handling,
              k.truck_in, k.driver_in, k.seal_in, k.card_in, k.card_in_year,
              k.truck_out, k.driver_out, k.card_out, k.card_out_year,
              k.entered_at
       FROM movements m
       JOIN containers k ON k.id = m.container_id
       WHERE m.type = ? AND m.at >= ? AND m.at < ? AND k.deleted_at IS NULL
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
       WHERE i.permit_id = ?
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

/** كشف خروج وتحميل داخلي: the permits issued in [from, to), oldest first. */
export function listPermits(db: DatabaseSync, fromIso: string, toIso: string): PermitReportRow[] {
  const names = listUserNames(db);
  const rows = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM permit_items i WHERE i.permit_id = p.id) AS containers
       FROM permits p
       WHERE p.at >= ? AND p.at < ? AND p.deleted_at IS NULL
       ORDER BY p.at, p.id`,
    )
    .all(fromIso, toIso) as unknown as Array<PermitRow & { containers: number }>;
  return rows.map((row) => ({
    id: row.id,
    serial: row.serial,
    serialYear: row.serial_year,
    at: row.at,
    bill: row.bill,
    containers: row.containers,
    user: userLabel(names, row.user_id),
  }));
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
