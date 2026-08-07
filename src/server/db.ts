import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

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
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- The yard's shape, one row. Written by first-run setup, edited later only
    -- through the resize guard.
    CREATE TABLE IF NOT EXISTS yard (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      twenty_rows  INTEGER NOT NULL,
      twenty_cols  INTEGER NOT NULL,
      forty_rows   INTEGER NOT NULL,
      forty_cols   INTEGER NOT NULL
    );

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
      zone          INTEGER CHECK (zone IN (20, 40)),
      row           INTEGER,
      col           INTEGER,
      tier          INTEGER,
      -- Soft delete for a record that was a mistake. Never removed.
      deleted_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_containers_number ON containers (number);
    CREATE INDEX IF NOT EXISTS idx_containers_standing
      ON containers (zone, row, col, tier) WHERE zone IS NOT NULL;

    -- One container per physical position, enforced by the database itself so
    -- no code path — present or future — can double-book a slot.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_per_position
      ON containers (zone, row, col, tier)
      WHERE zone IS NOT NULL AND deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS movements (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id INTEGER NOT NULL REFERENCES containers (id),
      type         TEXT    NOT NULL CHECK (type IN ('IN', 'MOVE', 'OUT', 'EDIT')),
      at           TEXT    NOT NULL,
      from_zone    INTEGER, from_row INTEGER, from_col INTEGER, from_tier INTEGER,
      to_zone      INTEGER, to_row   INTEGER, to_col   INTEGER, to_tier   INTEGER,
      note         TEXT    NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_movements_container ON movements (container_id);
  `);
}

/**
 * Runs work atomically. node:sqlite has no built-in transaction helper, so
 * this is the one place BEGIN/COMMIT/ROLLBACK are ever written.
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
