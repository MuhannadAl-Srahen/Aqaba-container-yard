import type { DatabaseSync } from 'node:sqlite';
import type {
  BlockConfig,
  BlockSize,
  ContainerDto,
  ContainerStatus,
  LocationState,
  LogReportRow,
  MovementDto,
  MovementType,
  Position,
  Size,
  Tier,
  YardConfig,
} from '../shared/types';
import type { Standing } from '../shared/rules';
import { slotKey } from '../shared/address';
import type { SeedPlan } from './seedData';

/**
 * Row ↔ DTO mapping and every SQL statement, in one file. The services above
 * this never see a raw row, and nothing outside it writes SQL.
 */

interface ContainerRow {
  id: number;
  number: string;
  number_valid: number;
  size: number;
  customer: string;
  cargo: string;
  notes: string;
  entered_at: string;
  exited_at: string | null;
  block_id: number | null;
  row: number | null;
  col: number | null;
  tier: number | null;
  weight: string;
  truck_in: string;
  driver_in: string;
  card_in: number | null;
  truck_out: string;
  driver_out: string;
  card_out: number | null;
  status: string;
  deleted_at: string | null;
}

function positionOf(row: ContainerRow): Position | null {
  if (row.block_id === null || row.row === null || row.col === null || row.tier === null) {
    return null;
  }
  return {
    block: row.block_id,
    row: row.row,
    col: row.col,
    tier: row.tier as Tier,
  };
}

function toDto(row: ContainerRow): ContainerDto {
  return {
    id: row.id,
    number: row.number,
    numberValid: row.number_valid === 1,
    size: row.size as Size,
    customer: row.customer,
    cargo: row.cargo === 'LADEN' ? 'LADEN' : 'EMPTY',
    enteredAt: row.entered_at,
    exitedAt: row.exited_at,
    position: positionOf(row),
    notes: row.notes,
    weight: row.weight,
    truckIn: row.truck_in,
    driverIn: row.driver_in,
    cardIn: row.card_in,
    truckOut: row.truck_out,
    driverOut: row.driver_out,
    cardOut: row.card_out,
    status: row.status as ContainerStatus,
  };
}

interface BlockRow {
  id: number;
  name: string;
  size: number;
  rows: number;
  cols: number;
  x: number;
  y: number;
  angle: number;
  state: string;
  deleted_at: string | null;
}

function toBlock(row: BlockRow): BlockConfig {
  return {
    id: row.id,
    name: row.name,
    size: row.size as BlockSize,
    rows: row.rows,
    cols: row.cols,
    x: row.x,
    y: row.y,
    angle: row.angle,
    state: row.state as LocationState,
  };
}

/**
 * The development wipe: every container and movement gone FOR REAL, card
 * counters back to 1, the yard's blocks and the password untouched. Guarded
 * by the route — this is the one deliberate exception to soft-delete-only.
 */
export function devReset(db: DatabaseSync): void {
  db.exec(`
    DELETE FROM movements;
    DELETE FROM containers;
    DELETE FROM sqlite_sequence WHERE name IN ('movements', 'containers');
    DELETE FROM settings WHERE key IN ('card_in_next', 'card_out_next');
  `);
}

/**
 * The development demo fill: wipe like devReset, then write the whole plan —
 * back-dated visits, movements and card counters — with raw SQL, because no
 * public route accepts a timestamp (and none should). Blocks, slot states
 * and the password stay untouched.
 */
export function devSeed(db: DatabaseSync, plan: SeedPlan): void {
  devReset(db);
  const insert = db.prepare(
    `INSERT INTO containers
       (number, number_valid, size, customer, cargo, notes, entered_at, exited_at,
        block_id, row, col, tier, weight, truck_in, driver_in, card_in,
        truck_out, driver_out, card_out, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const container of plan.containers) {
    const result = insert.run(
      container.number,
      container.numberValid ? 1 : 0,
      container.size,
      container.customer,
      container.cargo,
      container.notes,
      container.enteredAt,
      container.exitedAt,
      container.position?.block ?? null,
      container.position?.row ?? null,
      container.position?.col ?? null,
      container.position?.tier ?? null,
      container.weight,
      container.truckIn,
      container.driverIn,
      container.cardIn,
      container.truckOut,
      container.driverOut,
      container.cardOut,
      container.status,
    );
    const id = Number(result.lastInsertRowid);
    for (const movement of container.movements) {
      recordMovement(db, id, movement.type, movement.at, movement.from, movement.to, '');
    }
  }
  const setCounter = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  setCounter.run('card_in_next', String(plan.cardInNext));
  setCounter.run('card_out_next', String(plan.cardOutNext));
}

/** The live yard: every block that has not been deleted. Null before setup. */
export function getYard(db: DatabaseSync): YardConfig | null {
  const rows = db
    .prepare('SELECT * FROM blocks WHERE deleted_at IS NULL ORDER BY id')
    .all() as unknown as BlockRow[];
  if (rows.length === 0) return null;
  return { blocks: rows.map(toBlock) };
}

/** Names of every block EVER — old history keeps naming deleted areas. */
export function listBlockNames(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare('SELECT id, name FROM blocks').all() as unknown as Array<{
    id: number;
    name: string;
  }>;
  const names: Record<string, string> = {};
  for (const row of rows) names[String(row.id)] = row.name;
  return names;
}

export function insertBlock(db: DatabaseSync, block: Omit<BlockConfig, 'id'>): number {
  const result = db
    .prepare(
      'INSERT INTO blocks (name, size, rows, cols, x, y, angle, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(block.name, block.size, block.rows, block.cols, block.x, block.y, block.angle, block.state);
  return Number(result.lastInsertRowid);
}

/**
 * The layout save deliberately CANNOT touch `state` — it is operational, not
 * geometric, and travels its own endpoint. The parameter type enforces it.
 */
export function updateBlock(db: DatabaseSync, block: Omit<BlockConfig, 'state'>): void {
  db.prepare(
    'UPDATE blocks SET name = ?, size = ?, rows = ?, cols = ?, x = ?, y = ?, angle = ? WHERE id = ?',
  ).run(block.name, block.size, block.rows, block.cols, block.x, block.y, block.angle, block.id);
}

export function setBlockState(db: DatabaseSync, id: number, state: LocationState): void {
  db.prepare('UPDATE blocks SET state = ? WHERE id = ? AND deleted_at IS NULL').run(state, id);
}

export function softDeleteBlock(db: DatabaseSync, id: number, at: string): void {
  db.prepare('UPDATE blocks SET deleted_at = ? WHERE id = ?').run(at, id);
}

/** Per-slot states for live blocks, keyed exactly as the rules read them. */
export function listSlotStates(db: DatabaseSync): Record<string, LocationState> {
  const rows = db
    .prepare(
      `SELECT s.block_id, s.row, s.col, s.state FROM slot_states s
       JOIN blocks b ON b.id = s.block_id AND b.deleted_at IS NULL`,
    )
    .all() as unknown as Array<{ block_id: number; row: number; col: number; state: string }>;
  const states: Record<string, LocationState> = {};
  for (const row of rows) {
    states[slotKey({ block: row.block_id, row: row.row, col: row.col })] =
      row.state as LocationState;
  }
  return states;
}

/** NORMAL is the absent row: setting it deletes, anything else upserts. */
export function setSlotState(
  db: DatabaseSync,
  slot: Pick<Position, 'block' | 'row' | 'col'>,
  state: LocationState,
): void {
  if (state === 'NORMAL') {
    db.prepare('DELETE FROM slot_states WHERE block_id = ? AND row = ? AND col = ?').run(
      slot.block,
      slot.row,
      slot.col,
    );
    return;
  }
  db.prepare(
    `INSERT INTO slot_states (block_id, row, col, state) VALUES (?, ?, ?, ?)
     ON CONFLICT (block_id, row, col) DO UPDATE SET state = excluded.state`,
  ).run(slot.block, slot.row, slot.col, state);
}

/** Everyone currently standing in the yard, as the rules see them. */
export function listStanding(db: DatabaseSync): Standing[] {
  const rows = db
    .prepare('SELECT * FROM containers WHERE block_id IS NOT NULL AND deleted_at IS NULL')
    .all() as unknown as ContainerRow[];
  return rows.map((row) => {
    const position = positionOf(row);
    if (position === null) throw new Error(`container ${String(row.id)} standing without a position`);
    return {
      id: row.id,
      number: row.number,
      size: row.size as Size,
      status: row.status as ContainerStatus,
      position,
    };
  });
}

/** Sizes of the standing containers, for layout-change stranding checks. */
export function standingSizes(db: DatabaseSync): Map<number, Size> {
  const rows = db
    .prepare('SELECT id, size FROM containers WHERE block_id IS NOT NULL AND deleted_at IS NULL')
    .all() as unknown as Array<{ id: number; size: number }>;
  return new Map(rows.map((row) => [row.id, row.size as Size]));
}

export function listInYard(db: DatabaseSync): ContainerDto[] {
  const rows = db
    .prepare(
      'SELECT * FROM containers WHERE block_id IS NOT NULL AND deleted_at IS NULL ORDER BY entered_at',
    )
    .all() as unknown as ContainerRow[];
  return rows.map(toDto);
}

export function listCustomers(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT customer FROM containers
       WHERE deleted_at IS NULL AND customer <> '' ORDER BY customer`,
    )
    .all() as unknown as Array<{ customer: string }>;
  return rows.map((row) => row.customer);
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
      'SELECT * FROM containers WHERE number = ? AND block_id IS NOT NULL AND deleted_at IS NULL',
    )
    .get(number) as ContainerRow | undefined;
  return row === undefined ? null : toDto(row);
}

export function searchContainers(db: DatabaseSync, query: string): ContainerDto[] {
  // Escape the two LIKE wildcards so a literal % in a search cannot scan
  // everything; \ is the declared escape character below.
  const escaped = query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const like = `%${escaped}%`;
  const rows = db
    .prepare(
      `SELECT * FROM containers
       WHERE deleted_at IS NULL AND (number LIKE ? ESCAPE '\\' OR customer LIKE ? ESCAPE '\\')
       ORDER BY (block_id IS NULL), entered_at DESC
       LIMIT 50`,
    )
    .all(like, like) as unknown as ContainerRow[];
  return rows.map(toDto);
}

export interface NewContainer {
  number: string;
  numberValid: boolean;
  size: Size;
  customer: string;
  cargo: 'EMPTY' | 'LADEN';
  notes: string;
  position: Position;
  at: string;
  weight: string;
  truckIn: string;
  driverIn: string;
  cardIn: number;
}

export function insertContainer(db: DatabaseSync, container: NewContainer): number {
  const result = db
    .prepare(
      `INSERT INTO containers
         (number, number_valid, size, customer, cargo, notes, entered_at, block_id, row, col, tier,
          weight, truck_in, driver_in, card_in)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      container.number,
      container.numberValid ? 1 : 0,
      container.size,
      container.customer,
      container.cargo,
      container.notes,
      container.at,
      container.position.block,
      container.position.row,
      container.position.col,
      container.position.tier,
      container.weight,
      container.truckIn,
      container.driverIn,
      container.cardIn,
    );
  return Number(result.lastInsertRowid);
}

export function setPosition(db: DatabaseSync, id: number, position: Position | null): void {
  db.prepare('UPDATE containers SET block_id = ?, row = ?, col = ?, tier = ? WHERE id = ?').run(
    position?.block ?? null,
    position?.row ?? null,
    position?.col ?? null,
    position?.tier ?? null,
    id,
  );
}

export interface GateOut {
  truck: string;
  driver: string;
  cardOut: number;
}

export function markExited(db: DatabaseSync, id: number, at: string, gate: GateOut): void {
  db.prepare(
    `UPDATE containers SET exited_at = ?, block_id = NULL, row = NULL, col = NULL, tier = NULL,
       truck_out = ?, driver_out = ?, card_out = ? WHERE id = ?`,
  ).run(at, gate.truck, gate.driver, gate.cardOut, id);
}

export interface ContainerEdit {
  number: string;
  numberValid: boolean;
  customer: string;
  cargo: 'EMPTY' | 'LADEN';
  size: Size;
  notes: string;
}

export function updateContainer(db: DatabaseSync, id: number, edit: ContainerEdit): void {
  db.prepare(
    'UPDATE containers SET number = ?, number_valid = ?, customer = ?, cargo = ?, size = ?, notes = ? WHERE id = ?',
  ).run(edit.number, edit.numberValid ? 1 : 0, edit.customer, edit.cargo, edit.size, edit.notes, id);
}

export function setContainerStatus(db: DatabaseSync, id: number, status: ContainerStatus): void {
  db.prepare('UPDATE containers SET status = ? WHERE id = ?').run(status, id);
}

export function softDelete(db: DatabaseSync, id: number, at: string): void {
  // Deleting also vacates the slot; a deleted record must not keep ground.
  db.prepare(
    'UPDATE containers SET deleted_at = ?, block_id = NULL, row = NULL, col = NULL, tier = NULL WHERE id = ?',
  ).run(at, id);
}

/** The record whether it is deleted or not — the restore path needs both. */
export function getContainerAny(db: DatabaseSync, id: number): (ContainerDto & { deleted: boolean }) | null {
  const row = db.prepare('SELECT * FROM containers WHERE id = ?').get(id) as
    | ContainerRow
    | undefined;
  return row === undefined ? null : { ...toDto(row), deleted: row.deleted_at !== null };
}

/** Where the container stood at the moment it was deleted, if anywhere. */
export function lastDeletePosition(db: DatabaseSync, id: number): Position | null {
  const row = db
    .prepare(
      `SELECT from_block, from_row, from_col, from_tier FROM movements
       WHERE container_id = ? AND type = 'DELETE' ORDER BY at DESC, id DESC LIMIT 1`,
    )
    .get(id) as
    | { from_block: number | null; from_row: number | null; from_col: number | null; from_tier: number | null }
    | undefined;
  if (row === undefined) return null;
  return movementPosition(row.from_block, row.from_row, row.from_col, row.from_tier);
}

/** Undo a soft delete, standing the container back where it was (or out). */
export function restoreContainer(db: DatabaseSync, id: number, position: Position | null): void {
  db.prepare(
    'UPDATE containers SET deleted_at = NULL, block_id = ?, row = ?, col = ?, tier = ? WHERE id = ?',
  ).run(
    position?.block ?? null,
    position?.row ?? null,
    position?.col ?? null,
    position?.tier ?? null,
    id,
  );
}

export function recordMovement(
  db: DatabaseSync,
  containerId: number,
  type: MovementType,
  at: string,
  from: Position | null,
  to: Position | null,
  note: string,
): void {
  db.prepare(
    `INSERT INTO movements
       (container_id, type, at, from_block, from_row, from_col, from_tier,
        to_block, to_row, to_col, to_tier, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    containerId,
    type,
    at,
    from?.block ?? null,
    from?.row ?? null,
    from?.col ?? null,
    from?.tier ?? null,
    to?.block ?? null,
    to?.row ?? null,
    to?.col ?? null,
    to?.tier ?? null,
    note,
  );
}

interface MovementRow {
  id: number;
  type: string;
  at: string;
  from_block: number | null;
  from_row: number | null;
  from_col: number | null;
  from_tier: number | null;
  to_block: number | null;
  to_row: number | null;
  to_col: number | null;
  to_tier: number | null;
  note: string;
}

function movementPosition(
  block: number | null,
  row: number | null,
  col: number | null,
  tier: number | null,
): Position | null {
  if (block === null || row === null || col === null || tier === null) return null;
  return { block, row, col, tier: tier as Tier };
}

export function listMovements(db: DatabaseSync, containerId: number): MovementDto[] {
  const rows = db
    .prepare('SELECT * FROM movements WHERE container_id = ? ORDER BY at, id')
    .all(containerId) as unknown as MovementRow[];
  return rows.map((row) => ({
    id: row.id,
    type: row.type as MovementType,
    at: row.at,
    from: movementPosition(row.from_block, row.from_row, row.from_col, row.from_tier),
    to: movementPosition(row.to_block, row.to_row, row.to_col, row.to_tier),
    note: row.note,
  }));
}

/**
 * The next serial for a printed gate card. One counter per direction, held in
 * settings and bumped inside the caller's transaction.
 */
export function nextCardNumber(db: DatabaseSync, kind: 'in' | 'out'): number {
  const key = kind === 'in' ? 'card_in_next' : 'card_out_next';
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  const current = row === undefined ? 1 : Number(row.value);
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, String(current + 1));
  return current;
}

interface GateRow {
  container_id: number;
  at: string;
  b: number | null;
  r: number | null;
  c: number | null;
  t: number | null;
  number: string;
  size: number;
  customer: string;
  weight: string;
  truck_in: string;
  driver_in: string;
  card_in: number | null;
  truck_out: string;
  driver_out: string;
  card_out: number | null;
  entered_at: string;
}

/** Every IN or OUT movement in [from, to), joined with its container's paperwork. */
export function listGateMovements(
  db: DatabaseSync,
  type: 'IN' | 'OUT',
  fromIso: string,
  toIso: string,
): GateReportRowInternal[] {
  const positionColumns =
    type === 'IN'
      ? 'm.to_block AS b, m.to_row AS r, m.to_col AS c, m.to_tier AS t'
      : 'm.from_block AS b, m.from_row AS r, m.from_col AS c, m.from_tier AS t';
  const rows = db
    .prepare(
      `SELECT m.container_id, m.at, ${positionColumns},
              k.number, k.size, k.customer, k.weight,
              k.truck_in, k.driver_in, k.card_in, k.truck_out, k.driver_out, k.card_out,
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
    truck: type === 'IN' ? row.truck_in : row.truck_out,
    driver: type === 'IN' ? row.driver_in : row.driver_out,
    number: row.number,
    weight: row.weight,
    size: row.size as Size,
    customer: row.customer,
    position: movementPosition(row.b, row.r, row.c, row.t),
    enteredAt: row.entered_at,
  }));
}

export interface GateReportRowInternal {
  containerId: number;
  at: string;
  card: number | null;
  truck: string;
  driver: string;
  number: string;
  weight: string;
  size: Size;
  customer: string;
  position: Position | null;
  enteredAt: string;
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
  const rows = db
    .prepare(
      `SELECT m.container_id, m.type, m.at, m.note,
              m.from_block, m.from_row, m.from_col, m.from_tier,
              m.to_block, m.to_row, m.to_col, m.to_tier,
              k.number, k.customer, k.deleted_at
       FROM movements m
       JOIN containers k ON k.id = m.container_id
       WHERE m.at >= ? AND m.at < ?
       ORDER BY m.at, m.id`,
    )
    .all(fromIso, toIso) as unknown as Array<
    MovementRow & {
      container_id: number;
      number: string;
      customer: string;
      deleted_at: string | null;
    }
  >;
  return rows.map((row) => ({
    containerId: row.container_id,
    at: row.at,
    type: row.type as MovementType,
    number: row.number,
    customer: row.customer,
    from: movementPosition(row.from_block, row.from_row, row.from_col, row.from_tier),
    to: movementPosition(row.to_block, row.to_row, row.to_col, row.to_tier),
    note: row.note,
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
      `SELECT m.type, m.container_id, m.at,
              m.from_block, m.from_row, m.from_col, m.from_tier,
              m.to_block, m.to_row, m.to_col, m.to_tier,
              k.number, k.size, k.customer, k.weight,
              k.truck_in, k.driver_in, k.card_in, k.truck_out, k.driver_out, k.card_out,
              k.entered_at
       FROM movements m
       JOIN containers k ON k.id = m.container_id
       WHERE m.at >= ? AND m.at < ? AND k.deleted_at IS NULL
         AND ((m.type = 'IN' AND k.truck_in = ?) OR (m.type = 'OUT' AND k.truck_out = ?))
       ORDER BY m.at, m.id`,
    )
    .all(fromIso, toIso, truck, truck) as unknown as Array<
    MovementRow & {
      container_id: number;
      number: string;
      size: number;
      customer: string;
      weight: string;
      truck_in: string;
      driver_in: string;
      card_in: number | null;
      truck_out: string;
      driver_out: string;
      card_out: number | null;
      entered_at: string;
    }
  >;
  return rows.map((row) => {
    const type = row.type === 'IN' ? ('IN' as const) : ('OUT' as const);
    return {
      type,
      containerId: row.container_id,
      at: row.at,
      card: type === 'IN' ? row.card_in : row.card_out,
      truck: type === 'IN' ? row.truck_in : row.truck_out,
      driver: type === 'IN' ? row.driver_in : row.driver_out,
      number: row.number,
      weight: row.weight,
      size: row.size as Size,
      customer: row.customer,
      position:
        type === 'IN'
          ? movementPosition(row.to_block, row.to_row, row.to_col, row.to_tier)
          : movementPosition(row.from_block, row.from_row, row.from_col, row.from_tier),
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
