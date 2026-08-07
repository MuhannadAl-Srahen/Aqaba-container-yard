import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { defaultLayout } from '../shared/geometry';

/**
 * SQLite through Node's own driver: one file, no native build step, and a
 * synchronous single-writer model that makes every request handler a natural
 * transaction — two operators racing for one slot are serialized by
 * construction rather than by an isolation level.
 */

export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') {
    mkdirSync(path.dirname(file), { recursive: true });
  }

  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function migrate(db: DatabaseSync): void {
  // Version 1 (the fixed two-half yard) predates user_version stamping, so it
  // is recognised by its `yard` table rather than by number.
  const hasV1Yard =
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'yard'")
      .get() !== undefined;
  if (hasV1Yard) upgradeV1toV2(db);

  // v3: the gate paperwork columns. Purely additive, so a plain ALTER run —
  // detected by the column itself, which also covers a v1 file that just
  // went through the rebuild above.
  const hasContainers =
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'containers'")
      .get() !== undefined;
  if (hasContainers) {
    const columns = db.prepare('PRAGMA table_info(containers)').all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === 'weight')) {
      db.exec(`
        ALTER TABLE containers ADD COLUMN weight     TEXT NOT NULL DEFAULT '';
        ALTER TABLE containers ADD COLUMN truck_in   TEXT NOT NULL DEFAULT '';
        ALTER TABLE containers ADD COLUMN driver_in  TEXT NOT NULL DEFAULT '';
        ALTER TABLE containers ADD COLUMN card_in    INTEGER;
        ALTER TABLE containers ADD COLUMN truck_out  TEXT NOT NULL DEFAULT '';
        ALTER TABLE containers ADD COLUMN driver_out TEXT NOT NULL DEFAULT '';
        ALTER TABLE containers ADD COLUMN card_out   INTEGER;
      `);
    }
  }

  // v5: mixed blocks (size 0) need room in the blocks CHECK — a rebuild,
  // since SQLite cannot edit a CHECK in place. Detected from the table's own
  // SQL, never a version stamp: a mid-edit dev restart once stamped ahead of
  // the rebuild and stranded the live file.
  const blocksSql = (
    db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'blocks'")
      .get() as { sql: string } | undefined
  )?.sql;
  if (blocksSql !== undefined && !blocksSql.includes('0, 20, 40')) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE blocks_v5 (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT    NOT NULL,
          size        INTEGER NOT NULL CHECK (size IN (0, 20, 40)),
          rows        INTEGER NOT NULL,
          cols        INTEGER NOT NULL,
          x           REAL    NOT NULL,
          y           REAL    NOT NULL,
          angle       REAL    NOT NULL DEFAULT 0,
          deleted_at  TEXT
        );
        INSERT INTO blocks_v5 SELECT * FROM blocks;
        DROP TABLE blocks;
        ALTER TABLE blocks_v5 RENAME TO blocks;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_blocks_live_name
          ON blocks (name) WHERE deleted_at IS NULL;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  // v4: the operations log records deletions too, and the old movements
  // CHECK would refuse the new type — a rebuild, detected from the table's
  // own SQL for the same reason as above.
  const movementsSql = (
    db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'movements'")
      .get() as { sql: string } | undefined
  )?.sql;
  if (movementsSql !== undefined && !movementsSql.includes("'DELETE'")) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE movements_v4 (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          container_id INTEGER NOT NULL REFERENCES containers (id),
          type         TEXT    NOT NULL CHECK (type IN ('IN', 'MOVE', 'OUT', 'EDIT', 'DELETE')),
          at           TEXT    NOT NULL,
          from_block   INTEGER, from_row INTEGER, from_col INTEGER, from_tier INTEGER,
          to_block     INTEGER, to_row   INTEGER, to_col   INTEGER, to_tier   INTEGER,
          note         TEXT    NOT NULL DEFAULT ''
        );
        INSERT INTO movements_v4 SELECT * FROM movements;
        DROP TABLE movements;
        ALTER TABLE movements_v4 RENAME TO movements;
        COMMIT;
      `);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- The yard's areas: rectangles of slots, placed and rotated freely.
    -- size 0 = mixed (each slot takes either container size). Soft delete
    -- keeps names resolvable for old history.
    CREATE TABLE IF NOT EXISTS blocks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      size        INTEGER NOT NULL CHECK (size IN (0, 20, 40)),
      rows        INTEGER NOT NULL,
      cols        INTEGER NOT NULL,
      x           REAL    NOT NULL,
      y           REAL    NOT NULL,
      angle       REAL    NOT NULL DEFAULT 0,
      deleted_at  TEXT
    );

    -- Live blocks keep distinct names; a deleted block frees its name.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_blocks_live_name
      ON blocks (name) WHERE deleted_at IS NULL;

    -- One row per container VISIT. The same physical box returning months
    -- later is a new row with its own history.
    CREATE TABLE IF NOT EXISTS containers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      number        TEXT    NOT NULL,
      number_valid  INTEGER NOT NULL,
      size          INTEGER NOT NULL CHECK (size IN (20, 40)),
      customer      TEXT    NOT NULL,
      cargo         TEXT    NOT NULL CHECK (cargo IN ('EMPTY', 'LADEN')),
      notes         TEXT    NOT NULL DEFAULT '',
      entered_at    TEXT    NOT NULL,
      exited_at     TEXT,
      -- Present exactly while the container stands in the yard.
      block_id      INTEGER REFERENCES blocks (id),
      row           INTEGER,
      col           INTEGER,
      tier          INTEGER,
      -- The gate paperwork: weights, trucks, drivers and card serials.
      weight        TEXT    NOT NULL DEFAULT '',
      truck_in      TEXT    NOT NULL DEFAULT '',
      driver_in     TEXT    NOT NULL DEFAULT '',
      card_in       INTEGER,
      truck_out     TEXT    NOT NULL DEFAULT '',
      driver_out    TEXT    NOT NULL DEFAULT '',
      card_out      INTEGER,
      -- Soft delete for a record that was a mistake. Never removed.
      deleted_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_containers_number ON containers (number);
    CREATE INDEX IF NOT EXISTS idx_containers_standing
      ON containers (block_id, row, col, tier) WHERE block_id IS NOT NULL;

    -- One container per physical position, enforced by the database itself so
    -- no code path — present or future — can double-book a slot.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_per_position
      ON containers (block_id, row, col, tier)
      WHERE block_id IS NOT NULL AND deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS movements (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id INTEGER NOT NULL REFERENCES containers (id),
      type         TEXT    NOT NULL CHECK (type IN ('IN', 'MOVE', 'OUT', 'EDIT', 'DELETE')),
      at           TEXT    NOT NULL,
      from_block   INTEGER, from_row INTEGER, from_col INTEGER, from_tier INTEGER,
      to_block     INTEGER, to_row   INTEGER, to_col   INTEGER, to_tier   INTEGER,
      note         TEXT    NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_movements_container ON movements (container_id);
    CREATE INDEX IF NOT EXISTS idx_movements_at ON movements (at);

    PRAGMA user_version = 5;
  `);
}

/**
 * The two fixed halves become two named blocks laid out exactly as the old
 * map drew them, and every position — standing or historical — is re-pointed
 * at its block. Old tables are rebuilt, not altered: their zone columns sit
 * inside CHECKs and indexes SQLite cannot drop a column out of.
 */
function upgradeV1toV2(db: DatabaseSync): void {
  const yard = db.prepare('SELECT * FROM yard WHERE id = 1').get() as
    | { twenty_rows: number; twenty_cols: number; forty_rows: number; forty_cols: number }
    | undefined;

  // The rebuild drops tables the new ones reference; enforcement returns the
  // moment the upgrade is over. (Must be set outside the transaction.)
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE blocks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        size        INTEGER NOT NULL CHECK (size IN (20, 40)),
        rows        INTEGER NOT NULL,
        cols        INTEGER NOT NULL,
        x           REAL    NOT NULL,
        y           REAL    NOT NULL,
        angle       REAL    NOT NULL DEFAULT 0,
        deleted_at  TEXT
      );
    `);

    let id20: number | null = null;
    let id40: number | null = null;
    if (yard !== undefined) {
      const layout = defaultLayout(
        { rows: yard.twenty_rows, cols: yard.twenty_cols },
        { rows: yard.forty_rows, cols: yard.forty_cols },
      );
      const insert = db.prepare(
        'INSERT INTO blocks (name, size, rows, cols, x, y, angle) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const block of layout) {
        const result = insert.run(
          block.name,
          block.size,
          block.rows,
          block.cols,
          block.x,
          block.y,
          block.angle,
        );
        if (block.size === 20) id20 = Number(result.lastInsertRowid);
        else id40 = Number(result.lastInsertRowid);
      }
    }

    db.exec(`
      CREATE TABLE containers_v2 (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        number        TEXT    NOT NULL,
        number_valid  INTEGER NOT NULL,
        size          INTEGER NOT NULL CHECK (size IN (20, 40)),
        customer      TEXT    NOT NULL,
        cargo         TEXT    NOT NULL CHECK (cargo IN ('EMPTY', 'LADEN')),
        notes         TEXT    NOT NULL DEFAULT '',
        entered_at    TEXT    NOT NULL,
        exited_at     TEXT,
        block_id      INTEGER REFERENCES blocks (id),
        row           INTEGER,
        col           INTEGER,
        tier          INTEGER,
        deleted_at    TEXT
      );
    `);
    db.prepare(
      `INSERT INTO containers_v2
         (id, number, number_valid, size, customer, cargo, notes, entered_at, exited_at,
          block_id, row, col, tier, deleted_at)
       SELECT id, number, number_valid, size, customer, cargo, notes, entered_at, exited_at,
              CASE zone WHEN 20 THEN ? WHEN 40 THEN ? END, row, col, tier, deleted_at
       FROM containers`,
    ).run(id20, id40);

    db.exec(`
      CREATE TABLE movements_v2 (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id INTEGER NOT NULL REFERENCES containers (id),
        type         TEXT    NOT NULL CHECK (type IN ('IN', 'MOVE', 'OUT', 'EDIT')),
        at           TEXT    NOT NULL,
        from_block   INTEGER, from_row INTEGER, from_col INTEGER, from_tier INTEGER,
        to_block     INTEGER, to_row   INTEGER, to_col   INTEGER, to_tier   INTEGER,
        note         TEXT    NOT NULL DEFAULT ''
      );
    `);
    db.prepare(
      `INSERT INTO movements_v2
         (id, container_id, type, at, from_block, from_row, from_col, from_tier,
          to_block, to_row, to_col, to_tier, note)
       SELECT id, container_id, type, at,
              CASE from_zone WHEN 20 THEN ? WHEN 40 THEN ? END, from_row, from_col, from_tier,
              CASE to_zone WHEN 20 THEN ? WHEN 40 THEN ? END, to_row, to_col, to_tier, note
       FROM movements`,
    ).run(id20, id40, id20, id40);

    db.exec(`
      DROP TABLE movements;
      DROP TABLE containers;
      DROP TABLE yard;
      ALTER TABLE containers_v2 RENAME TO containers;
      ALTER TABLE movements_v2 RENAME TO movements;
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * Runs work atomically. node:sqlite has no built-in transaction helper, so
 * this is the one place BEGIN/COMMIT/ROLLBACK are ever written (the schema
 * upgrade above aside — it runs before any request exists).
 */
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getSetting(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
