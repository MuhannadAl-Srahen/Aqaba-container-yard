import type { DatabaseSync } from 'node:sqlite';
import type {
  ContainerDto,
  Handling,
  LogReportRow,
  MovementDto,
  MovementType,
  Permission,
  Position,
  Size,
  Tier,
  UserDto,
  Zone,
} from '../shared/types';
import { OWNER_ID, PERMISSIONS } from '../shared/types';
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
  deleted_at: string | null;
}

function toUser(row: UserRow): UserDto {
  return { id: row.id, name: row.name, permissions: parsePermissions(row.perms) };
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
  user: { name: string; pin: string; permissions: readonly Permission[] },
): number {
  const result = db
    .prepare('INSERT INTO users (name, pin_hash, perms) VALUES (?, ?, ?)')
    .run(user.name, hashSecret(user.pin), user.permissions.join(','));
  return Number(result.lastInsertRowid);
}

/** Rename, re-permission, and optionally set a fresh PIN. */
export function updateUser(
  db: DatabaseSync,
  id: number,
  user: { name: string; permissions: readonly Permission[]; pin?: string | undefined },
): void {
  db.prepare('UPDATE users SET name = ?, perms = ? WHERE id = ? AND deleted_at IS NULL').run(
    user.name,
    user.permissions.join(','),
    id,
  );
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

export function searchContainers(db: DatabaseSync, query: string): ContainerDto[] {
  // Escape the two LIKE wildcards so a literal % in a search cannot scan
  // everything; \ is the declared escape character below.
  const escaped = query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const like = `%${escaped}%`;
  const rows = db
    .prepare(
      `SELECT * FROM containers
       WHERE deleted_at IS NULL
         AND (number LIKE ? ESCAPE '\\' OR bill LIKE ? ESCAPE '\\')
       ORDER BY (zone IS NULL), entered_at DESC
       LIMIT 50`,
    )
    .all(like, like) as unknown as ContainerRow[];
  return rows.map(toDto);
}

export interface NewContainer {
  number: string;
  numberValid: boolean;
  size: Size;
  bill: string;
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
         (number, number_valid, size, bill, notes, entered_at, zone, bay, stack, tier,
          weight, handling, truck_in, driver_in, seal_in, card_in, card_in_year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      container.number,
      container.numberValid ? 1 : 0,
      container.size,
      container.bill,
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

export function updateContainer(db: DatabaseSync, id: number, edit: ContainerEdit): void {
  db.prepare(
    `UPDATE containers SET number = ?, number_valid = ?, bill = ?, size = ?,
       notes = ?, weight = ?, handling = ?,
       truck_in = ?, driver_in = ?, seal_in = ?,
       truck_out = ?, driver_out = ?,
       entered_at = ?, exited_at = ?
     WHERE id = ?`,
  ).run(
    edit.number,
    edit.numberValid ? 1 : 0,
    edit.bill,
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
      `SELECT MAX(${serial}) AS top FROM containers
        WHERE ${stamped} = ? AND deleted_at IS NULL`,
    )
    .get(year) as { top: number | null };
  return (row.top ?? 0) + 1;
}

/**
 * The next serial for a printed MOVE card. A container is moved many times,
 * so this card belongs to the MOVEMENT and not to the container — the ledger
 * is the movements table, counted per year like the two gate ledgers.
 *
 * Movements of a struck-out record do not count, exactly as its gate cards do
 * not: a record written by mistake takes its whole paper trail out with it.
 */
export function nextMoveCardNumber(db: DatabaseSync, year: number): number {
  const row = db
    .prepare(
      `SELECT MAX(m.card) AS top FROM movements m
        JOIN containers k ON k.id = m.container_id
        WHERE m.type = 'MOVE' AND m.card_year = ? AND k.deleted_at IS NULL`,
    )
    .get(year) as { top: number | null };
  return (row.top ?? 0) + 1;
}

/** One card that is sitting on the wrong serial, and the one it belongs on. */
export interface CardFix {
  /** The row's id in its OWN table: a container for in/out, a movement for move. */
  readonly id: number;
  readonly kind: 'in' | 'out' | 'move';
  readonly serial: number;
}

/**
 * THE RULE THE REGISTER IS HELD TO: the live cards of one year carry 1, 2,
 * 3 … N in the order the gate issued them, with no hole anywhere — not where
 * a record was struck out, not where a counter of an older version of this
 * program skipped a number. Deleting the third of five used to leave the
 * fourth reading «0004» forever with nothing in front of it; the owner found
 * exactly that on the office machine and asked for it to be rebuilt.
 *
 * This says what would have to change to make it true. Handing back the plan
 * rather than doing it lets the caller take a copy of the file first, and
 * lets the whole thing be asserted in a test without a write.
 *
 * The seat a card takes is decided by the gate date — the entry date for an
 * entry card, the exit date for an exit one, the moment of the lift for a
 * move — and ties are broken by the serial already carried, so a register
 * that is already whole plans nothing and running this twice changes nothing
 * the second time.
 *
 * Three ledgers, one rule. The move cards live in the movements table, so
 * they are counted there, but a struck-out record takes its moves out of the
 * count with it exactly as it takes its gate cards.
 */
export function renumberPlan(db: DatabaseSync): CardFix[] {
  const fixes: CardFix[] = [];

  const moves = db
    .prepare(
      `SELECT m.id AS id, m.card_year AS year, m.card AS serial FROM movements m
        JOIN containers k ON k.id = m.container_id
        WHERE m.type = 'MOVE' AND m.card IS NOT NULL AND m.card_year IS NOT NULL
          AND k.deleted_at IS NULL
        ORDER BY m.card_year, m.at, m.card, m.id`,
    )
    .all() as Array<{ id: number; year: number; serial: number }>;
  let moveYear: number | null = null;
  let moveSeat = 0;
  for (const row of moves) {
    if (row.year !== moveYear) {
      moveYear = row.year;
      moveSeat = 0;
    }
    moveSeat += 1;
    if (row.serial !== moveSeat) fixes.push({ id: row.id, kind: 'move', serial: moveSeat });
  }

  for (const kind of ['in', 'out'] as const) {
    const column = kind === 'in' ? 'card_in' : 'card_out';
    const stamped = kind === 'in' ? 'card_in_year' : 'card_out_year';
    const dated = kind === 'in' ? 'entered_at' : 'exited_at';
    const rows = db
      .prepare(
        `SELECT id, ${stamped} AS year, ${column} AS serial FROM containers
          WHERE ${stamped} IS NOT NULL AND ${column} IS NOT NULL AND deleted_at IS NULL
          ORDER BY ${stamped}, ${dated}, ${column}, id`,
      )
      .all() as Array<{ id: number; year: number; serial: number }>;

    let year: number | null = null;
    let seat = 0;
    for (const row of rows) {
      if (row.year !== year) {
        year = row.year;
        seat = 0;
      }
      seat += 1;
      if (row.serial !== seat) fixes.push({ id: row.id, kind, serial: seat });
    }
  }
  return fixes;
}

export function applyCardFixes(db: DatabaseSync, fixes: readonly CardFix[]): void {
  const seat = {
    in: db.prepare('UPDATE containers SET card_in = ? WHERE id = ?'),
    out: db.prepare('UPDATE containers SET card_out = ? WHERE id = ?'),
    // A move card is addressed by its movement, not by its container.
    move: db.prepare('UPDATE movements SET card = ? WHERE id = ?'),
  };
  for (const fix of fixes) seat[fix.kind].run(fix.serial, fix.id);
}

/**
 * Hold the register to the rule, and say how many cards had to move. Called
 * after anything that changes which records are live — a deletion, a record
 * brought back, a corrected gate date — so a hole never outlives the
 * operation that opened it.
 */
export function renumberCards(db: DatabaseSync): number {
  const fixes = renumberPlan(db);
  applyCardFixes(db, fixes);
  return fixes.length;
}

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
