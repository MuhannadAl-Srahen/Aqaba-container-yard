import type { DatabaseSync } from 'node:sqlite';
import type {
  ContainerDto,
  MovementDto,
  MovementType,
  Position,
  Size,
  Tier,
  YardConfig,
} from '../shared/types';
import type { Standing } from '../shared/rules';

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
  zone: number | null;
  row: number | null;
  col: number | null;
  tier: number | null;
  deleted_at: string | null;
}

function positionOf(row: ContainerRow): Position | null {
  if (row.zone === null || row.row === null || row.col === null || row.tier === null) return null;
  return {
    zone: row.zone as Size,
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
  };
}

export function getYard(db: DatabaseSync): YardConfig | null {
  const row = db.prepare('SELECT * FROM yard WHERE id = 1').get() as
    | { twenty_rows: number; twenty_cols: number; forty_rows: number; forty_cols: number }
    | undefined;
  if (row === undefined) return null;
  return {
    twenty: { rows: row.twenty_rows, cols: row.twenty_cols },
    forty: { rows: row.forty_rows, cols: row.forty_cols },
  };
}

export function saveYard(db: DatabaseSync, yard: YardConfig): void {
  db.prepare(
    `INSERT INTO yard (id, twenty_rows, twenty_cols, forty_rows, forty_cols)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       twenty_rows = excluded.twenty_rows, twenty_cols = excluded.twenty_cols,
       forty_rows = excluded.forty_rows, forty_cols = excluded.forty_cols`,
  ).run(yard.twenty.rows, yard.twenty.cols, yard.forty.rows, yard.forty.cols);
}

/** Everyone currently standing in the yard, as the rules see them. */
export function listStanding(db: DatabaseSync): Standing[] {
  const rows = db
    .prepare('SELECT * FROM containers WHERE zone IS NOT NULL AND deleted_at IS NULL')
    .all() as unknown as ContainerRow[];
  return rows.map((row) => {
    const position = positionOf(row);
    if (position === null) throw new Error(`container ${String(row.id)} standing without a position`);
    return { id: row.id, number: row.number, position };
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
      'SELECT * FROM containers WHERE number = ? AND zone IS NOT NULL AND deleted_at IS NULL',
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
  customer: string;
  cargo: 'EMPTY' | 'LADEN';
  notes: string;
  position: Position;
  at: string;
}

export function insertContainer(db: DatabaseSync, container: NewContainer): number {
  const result = db
    .prepare(
      `INSERT INTO containers
         (number, number_valid, size, customer, cargo, notes, entered_at, zone, row, col, tier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      container.number,
      container.numberValid ? 1 : 0,
      container.size,
      container.customer,
      container.cargo,
      container.notes,
      container.at,
      container.position.zone,
      container.position.row,
      container.position.col,
      container.position.tier,
    );
  return Number(result.lastInsertRowid);
}

export function setPosition(db: DatabaseSync, id: number, position: Position | null): void {
  db.prepare('UPDATE containers SET zone = ?, row = ?, col = ?, tier = ? WHERE id = ?').run(
    position?.zone ?? null,
    position?.row ?? null,
    position?.col ?? null,
    position?.tier ?? null,
    id,
  );
}

export function markExited(db: DatabaseSync, id: number, at: string): void {
  db.prepare(
    'UPDATE containers SET exited_at = ?, zone = NULL, row = NULL, col = NULL, tier = NULL WHERE id = ?',
  ).run(at, id);
}

export interface ContainerEdit {
  number: string;
  numberValid: boolean;
  customer: string;
  cargo: 'EMPTY' | 'LADEN';
  notes: string;
}

export function updateContainer(db: DatabaseSync, id: number, edit: ContainerEdit): void {
  db.prepare(
    'UPDATE containers SET number = ?, number_valid = ?, customer = ?, cargo = ?, notes = ? WHERE id = ?',
  ).run(edit.number, edit.numberValid ? 1 : 0, edit.customer, edit.cargo, edit.notes, id);
}

export function softDelete(db: DatabaseSync, id: number, at: string): void {
  // Deleting also vacates the slot; a deleted record must not keep ground.
  db.prepare(
    'UPDATE containers SET deleted_at = ?, zone = NULL, row = NULL, col = NULL, tier = NULL WHERE id = ?',
  ).run(at, id);
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
       (container_id, type, at, from_zone, from_row, from_col, from_tier,
        to_zone, to_row, to_col, to_tier, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    containerId,
    type,
    at,
    from?.zone ?? null,
    from?.row ?? null,
    from?.col ?? null,
    from?.tier ?? null,
    to?.zone ?? null,
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
  from_zone: number | null;
  from_row: number | null;
  from_col: number | null;
  from_tier: number | null;
  to_zone: number | null;
  to_row: number | null;
  to_col: number | null;
  to_tier: number | null;
  note: string;
}

function movementPosition(
  zone: number | null,
  row: number | null,
  col: number | null,
  tier: number | null,
): Position | null {
  if (zone === null || row === null || col === null || tier === null) return null;
  return { zone: zone as Size, row, col, tier: tier as Tier };
}

export function listMovements(db: DatabaseSync, containerId: number): MovementDto[] {
  const rows = db
    .prepare('SELECT * FROM movements WHERE container_id = ? ORDER BY at, id')
    .all(containerId) as unknown as MovementRow[];
  return rows.map((row) => ({
    id: row.id,
    type: row.type as MovementType,
    at: row.at,
    from: movementPosition(row.from_zone, row.from_row, row.from_col, row.from_tier),
    to: movementPosition(row.to_zone, row.to_row, row.to_col, row.to_tier),
    note: row.note,
  }));
}
