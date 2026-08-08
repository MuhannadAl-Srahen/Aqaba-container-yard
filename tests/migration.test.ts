import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/server/db';

/**
 * A version-1 database (the fixed two-half yard) opened by today's code must
 * come out as blocks with every container and movement re-pointed — the
 * upgrade the real data file goes through on the first restart.
 */

function buildV1(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE yard (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      twenty_rows INTEGER NOT NULL, twenty_cols INTEGER NOT NULL,
      forty_rows INTEGER NOT NULL, forty_cols INTEGER NOT NULL
    );
    CREATE TABLE containers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL, number_valid INTEGER NOT NULL,
      size INTEGER NOT NULL CHECK (size IN (20, 40)),
      customer TEXT NOT NULL, cargo TEXT NOT NULL CHECK (cargo IN ('EMPTY', 'LADEN')),
      notes TEXT NOT NULL DEFAULT '', entered_at TEXT NOT NULL, exited_at TEXT,
      zone INTEGER CHECK (zone IN (20, 40)), row INTEGER, col INTEGER, tier INTEGER,
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX idx_one_per_position ON containers (zone, row, col, tier)
      WHERE zone IS NOT NULL AND deleted_at IS NULL;
    CREATE TABLE movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id INTEGER NOT NULL REFERENCES containers (id),
      type TEXT NOT NULL CHECK (type IN ('IN', 'MOVE', 'OUT', 'EDIT')),
      at TEXT NOT NULL,
      from_zone INTEGER, from_row INTEGER, from_col INTEGER, from_tier INTEGER,
      to_zone INTEGER, to_row INTEGER, to_col INTEGER, to_tier INTEGER,
      note TEXT NOT NULL DEFAULT ''
    );

    INSERT INTO settings VALUES ('password', 'scrypt-blob');
    INSERT INTO yard VALUES (1, 4, 10, 3, 6);
    INSERT INTO containers
      (number, number_valid, size, customer, cargo, entered_at, zone, row, col, tier)
      VALUES ('CSQU3054383', 1, 20, 'شركة النورس', 'LADEN', '2026-08-01T08:00:00Z', 20, 1, 1, 1);
    INSERT INTO containers
      (number, number_valid, size, customer, cargo, entered_at, exited_at)
      VALUES ('TGHU1234560', 1, 40, 'مكتب الحديث', 'EMPTY', '2026-07-01T08:00:00Z', '2026-07-05T08:00:00Z');
    INSERT INTO movements (container_id, type, at, to_zone, to_row, to_col, to_tier)
      VALUES (1, 'IN', '2026-08-01T08:00:00Z', 20, 1, 1, 1);
    INSERT INTO movements (container_id, type, at, from_zone, from_row, from_col, from_tier)
      VALUES (2, 'OUT', '2026-07-05T08:00:00Z', 40, 2, 3, 1);
  `);
  return db;
}

describe('v1 → v2 migration', () => {
  it('turns the two halves into two placed blocks and re-points everything', () => {
    const db = buildV1();
    migrate(db);

    const blocks = db.prepare('SELECT * FROM blocks ORDER BY id').all() as Array<{
      id: number;
      name: string;
      size: number;
      rows: number;
      cols: number;
      angle: number;
    }>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ size: 20, rows: 4, cols: 10, angle: 0 });
    expect(blocks[1]).toMatchObject({ size: 40, rows: 3, cols: 6, angle: 0 });

    const standing = db
      .prepare('SELECT number, block_id, row, col, tier FROM containers WHERE block_id IS NOT NULL')
      .all() as Array<{ number: string; block_id: number; row: number; col: number; tier: number }>;
    expect(standing).toEqual([
      { number: 'CSQU3054383', block_id: blocks[0]?.id ?? 0, row: 1, col: 1, tier: 1 },
    ]);

    const departed = db
      .prepare("SELECT block_id FROM containers WHERE number = 'TGHU1234560'")
      .get() as { block_id: number | null };
    expect(departed.block_id).toBeNull();

    const movements = db
      .prepare('SELECT type, from_block, to_block FROM movements ORDER BY id')
      .all() as Array<{ type: string; from_block: number | null; to_block: number | null }>;
    expect(movements[0]).toMatchObject({ type: 'IN', to_block: blocks[0]?.id });
    expect(movements[1]).toMatchObject({ type: 'OUT', from_block: blocks[1]?.id });

    // The v3 paperwork columns and the v6 status arrived in the same pass.
    const columns = (
      db.prepare('PRAGMA table_info(containers)').all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining(['weight', 'truck_in', 'driver_in', 'card_in', 'card_out', 'status']),
    );

    // The old shape table is gone; the version is stamped; a second migrate
    // is a no-op.
    const yardTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'yard'")
      .get();
    expect(yardTable).toBeUndefined();
    migrate(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM blocks').get()).toMatchObject({ n: 2 });

    // The settings (the password among them) survive untouched.
    expect(db.prepare("SELECT value FROM settings WHERE key = 'password'").get()).toMatchObject({
      value: 'scrypt-blob',
    });
  });

  it('an empty v1 yard (setup never ran) migrates to no blocks', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE yard (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        twenty_rows INTEGER NOT NULL, twenty_cols INTEGER NOT NULL,
        forty_rows INTEGER NOT NULL, forty_cols INTEGER NOT NULL
      );
      CREATE TABLE containers (id INTEGER PRIMARY KEY, zone INTEGER, row INTEGER, col INTEGER, tier INTEGER, number TEXT, number_valid INTEGER, size INTEGER, customer TEXT, cargo TEXT, notes TEXT DEFAULT '', entered_at TEXT, exited_at TEXT, deleted_at TEXT);
      CREATE TABLE movements (id INTEGER PRIMARY KEY, container_id INTEGER, type TEXT, at TEXT, from_zone INTEGER, from_row INTEGER, from_col INTEGER, from_tier INTEGER, to_zone INTEGER, to_row INTEGER, to_col INTEGER, to_tier INTEGER, note TEXT DEFAULT '');
    `);
    migrate(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM blocks').get()).toMatchObject({ n: 0 });
  });
});

/**
 * v6 adds containers.status, blocks.state and the slot_states table. The two
 * ALTERs must run AFTER the v5/v4 rebuilds: those copy `SELECT *`
 * positionally, so a column added first would hand an old file more columns
 * than the rebuilt table expects.
 */
describe('v6 migration', () => {
  /** A pre-v5 file: blocks CHECK without mixed, movements without RESTORE. */
  function buildV4(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size IN (20, 40)),
        rows INTEGER NOT NULL, cols INTEGER NOT NULL,
        x REAL NOT NULL, y REAL NOT NULL, angle REAL NOT NULL DEFAULT 0,
        deleted_at TEXT
      );
      CREATE UNIQUE INDEX idx_blocks_live_name ON blocks (name) WHERE deleted_at IS NULL;
      CREATE TABLE containers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT NOT NULL, number_valid INTEGER NOT NULL,
        size INTEGER NOT NULL CHECK (size IN (20, 40)),
        customer TEXT NOT NULL, cargo TEXT NOT NULL CHECK (cargo IN ('EMPTY', 'LADEN')),
        notes TEXT NOT NULL DEFAULT '', entered_at TEXT NOT NULL, exited_at TEXT,
        block_id INTEGER REFERENCES blocks (id), row INTEGER, col INTEGER, tier INTEGER,
        weight TEXT NOT NULL DEFAULT '', truck_in TEXT NOT NULL DEFAULT '',
        driver_in TEXT NOT NULL DEFAULT '', card_in INTEGER,
        truck_out TEXT NOT NULL DEFAULT '', driver_out TEXT NOT NULL DEFAULT '',
        card_out INTEGER, deleted_at TEXT
      );
      CREATE TABLE movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id INTEGER NOT NULL REFERENCES containers (id),
        type TEXT NOT NULL CHECK (type IN ('IN', 'MOVE', 'OUT', 'EDIT')),
        at TEXT NOT NULL,
        from_block INTEGER, from_row INTEGER, from_col INTEGER, from_tier INTEGER,
        to_block INTEGER, to_row INTEGER, to_col INTEGER, to_tier INTEGER,
        note TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO blocks (name, size, rows, cols, x, y) VALUES ('A', 20, 3, 2, 0, 0);
      INSERT INTO containers (number, number_valid, size, customer, cargo, entered_at, block_id, row, col, tier)
        VALUES ('CSQU3054383', 1, 20, 'شركة النورس', 'LADEN', '2026-08-01T08:00:00Z', 1, 1, 1, 1);
      INSERT INTO movements (container_id, type, at, to_block, to_row, to_col, to_tier)
        VALUES (1, 'IN', '2026-08-01T08:00:00Z', 1, 1, 1, 1);
    `);
    return db;
  }

  it('rebuild-then-alter ordering: a pre-v5 file gains state AFTER its blocks rebuild', () => {
    const db = buildV4();
    migrate(db);

    const blocksSql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'blocks'").get() as { sql: string }
    ).sql;
    expect(blocksSql).toContain('0, 20, 40');
    expect(blocksSql).toContain('state');

    const block = db.prepare('SELECT name, state FROM blocks').get();
    expect(block).toMatchObject({ name: 'A', state: 'NORMAL' });
    const container = db.prepare('SELECT number, status FROM containers').get();
    expect(container).toMatchObject({ number: 'CSQU3054383', status: 'NORMAL' });

    const movementsSql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'movements'").get() as { sql: string }
    ).sql;
    expect(movementsSql).toContain("'RESTORE'");

    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'slot_states'").get(),
    ).toBeDefined();

    // A second migrate is a no-op and everything survives it.
    migrate(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM containers').get()).toMatchObject({ n: 1 });
  });

  it('a current file gains the columns with NORMAL on existing rows', () => {
    // Build a fresh (fully migrated) db, strip nothing — just check shape.
    const db = new DatabaseSync(':memory:');
    migrate(db);
    db.exec(`
      INSERT INTO blocks (name, size, rows, cols, x, y) VALUES ('B', 0, 2, 2, 0, 0);
      INSERT INTO slot_states (block_id, row, col, state) VALUES (1, 1, 1, 'MAINTENANCE');
    `);
    expect(db.prepare('SELECT state FROM blocks').get()).toMatchObject({ state: 'NORMAL' });
    expect(db.prepare('SELECT state FROM slot_states').get()).toMatchObject({
      state: 'MAINTENANCE',
    });
    // The CHECK holds the vocabulary closed.
    expect(() => {
      db.exec("UPDATE blocks SET state = 'NONSENSE'");
    }).toThrow();
    expect(() => {
      db.exec("INSERT INTO slot_states (block_id, row, col, state) VALUES (1, 2, 2, 'NORMAL')");
    }).toThrow();
  });
});
