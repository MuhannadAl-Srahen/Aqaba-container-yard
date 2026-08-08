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

    // The two halves arrive as v7 columns: the old `cols` lines fold into
    // the location's places, two tiers each.
    const blocks = db.prepare('SELECT * FROM blocks ORDER BY id').all() as Array<{
      id: number;
      name: string;
      size: number;
      rows: number;
      places_per_tier: number;
      tiers: number;
      angle: number;
    }>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ size: 20, rows: 4, places_per_tier: 20, tiers: 2, angle: 0 });
    expect(blocks[1]).toMatchObject({ size: 40, rows: 3, places_per_tier: 12, tiers: 2, angle: 0 });

    const standing = db
      .prepare('SELECT number, block_id, row FROM containers WHERE block_id IS NOT NULL')
      .all() as Array<{ number: string; block_id: number; row: number }>;
    expect(standing).toEqual([
      { number: 'CSQU3054383', block_id: blocks[0]?.id ?? 0, row: 1 },
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

    // The v3 paperwork and the v8 seals arrived in the same pass; cargo and
    // status left in it.
    const columns = (
      db.prepare('PRAGMA table_info(containers)').all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining([
        'weight',
        'truck_in',
        'driver_in',
        'card_in',
        'card_out',
        'seal_in',
        'seal_out',
      ]),
    );
    expect(columns).not.toContain('cargo');
    expect(columns).not.toContain('status');

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
 * v6 added containers.status, blocks.state and slot_states; v7 then turned
 * every slot into a location with a capacity and dropped the states again.
 * The v6 ALTERs must still run AFTER the v5/v4 rebuilds and BEFORE the v7
 * ones: the rebuilds copy `SELECT *` positionally, so a column added out of
 * turn would hand an old file more columns than the rebuilt table expects.
 */
describe('v6 → v7 → v8 migration', () => {
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
      INSERT INTO blocks (name, size, rows, cols, x, y) VALUES ('A', 20, 3, 2, 500, 700);
      INSERT INTO blocks (name, size, rows, cols, x, y) VALUES ('B', 40, 2, 3, 900, 700);
      INSERT INTO containers (number, number_valid, size, customer, cargo, entered_at, block_id, row, col, tier)
        VALUES ('CSQU3054383', 1, 20, 'شركة النورس', 'LADEN', '2026-08-01T08:00:00Z', 1, 2, 1, 1);
      INSERT INTO containers (number, number_valid, size, customer, cargo, entered_at, block_id, row, col, tier)
        VALUES ('MSCU1234566', 1, 20, 'شركة النورس', 'LADEN', '2026-08-01T09:00:00Z', 1, 2, 2, 2);
      INSERT INTO movements (container_id, type, at, to_block, to_row, to_col, to_tier)
        VALUES (1, 'IN', '2026-08-01T08:00:00Z', 1, 2, 1, 1);
    `);
    return db;
  }

  it('every slot of a column folds onto its location, capacity that cannot overflow', () => {
    const db = buildV4();
    migrate(db);

    const blocks = db.prepare('SELECT * FROM blocks ORDER BY id').all() as Array<{
      id: number;
      name: string;
      rows: number;
      places_per_tier: number;
      tiers: number;
      x: number;
      y: number;
    }>;
    // places = old cols × 2, tiers = 2: the old worst case was a 40 on each
    // of the `cols` lines on both tiers, which is exactly that many places.
    expect(blocks[0]).toMatchObject({ name: 'A', rows: 3, places_per_tier: 4, tiers: 2 });
    expect(blocks[1]).toMatchObject({ name: 'B', rows: 2, places_per_tier: 6, tiers: 2 });
    // The panel shape changed completely, so the columns are re-laid out.
    expect(blocks[0]?.y).toBe(0);
    expect((blocks[0]?.x ?? 0) < (blocks[1]?.x ?? 0)).toBe(true);

    // Both containers keep their column and row; the col and tier are gone.
    const columns = (
      db.prepare('PRAGMA table_info(containers)').all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(columns).toContain('row');
    expect(columns).not.toContain('col');
    expect(columns).not.toContain('tier');
    expect(db.prepare('SELECT number, block_id, row FROM containers ORDER BY id').all()).toEqual([
      { number: 'CSQU3054383', block_id: 1, row: 2 },
      { number: 'MSCU1234566', block_id: 1, row: 2 },
    ]);

    // History keeps its from/to columns, minus the two that no longer exist.
    expect(db.prepare('SELECT type, to_block, to_row FROM movements').get()).toMatchObject({
      type: 'IN',
      to_block: 1,
      to_row: 2,
    });
    const movementsSql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'movements'").get() as { sql: string }
    ).sql;
    expect(movementsSql).toContain("'RESTORE'");
    expect(movementsSql).not.toContain('to_tier');

    // Location states are gone with the ground they described.
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'slot_states'").get(),
    ).toBeUndefined();
    const blocksSql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'blocks'").get() as { sql: string }
    ).sql;
    expect(blocksSql).toContain('places_per_tier');
    expect(blocksSql).not.toContain('state');
    // A live column still keeps its name to itself.
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_blocks_live_name'").get(),
    ).toBeDefined();

    // A second migrate is a no-op and everything survives it.
    migrate(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM containers').get()).toMatchObject({ n: 2 });
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 8 });
  });

  it('v8 brings the staff and the seals, and takes cargo and status away', () => {
    const db = buildV4();
    // A pre-v8 file carries a cargo and a status on every container.
    db.exec("UPDATE containers SET cargo = 'LADEN'");
    migrate(db);

    const columns = (
      db.prepare('PRAGMA table_info(containers)').all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(columns).toContain('seal_in');
    expect(columns).toContain('seal_out');
    expect(columns).not.toContain('cargo');
    expect(columns).not.toContain('status');
    // Nothing was lost on the way: both containers and the movement survive.
    expect(db.prepare('SELECT COUNT(*) AS n FROM containers').get()).toMatchObject({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM movements').get()).toMatchObject({ n: 1 });
    // Old history has no author, which reads as the owner.
    expect(db.prepare('SELECT user_id FROM movements').get()).toMatchObject({ user_id: null });

    // The staff table arrived, keyed so two live employees cannot share a name.
    db.exec("INSERT INTO users (name, pin_hash, perms) VALUES ('وسام', 'salt:hash', 'GATE_IN')");
    expect(db.prepare('SELECT name, perms FROM users').get()).toMatchObject({
      name: 'وسام',
      perms: 'GATE_IN',
    });
    expect(() => {
      db.exec("INSERT INTO users (name, pin_hash) VALUES ('وسام', 'salt:hash')");
    }).toThrow();
  });

  /**
   * The bug this pins: v6 adds `containers.status` and `blocks.state` when
   * they are missing, and v7/v8 deliberately remove them — so an up-to-date
   * file failed the same "is this old?" test an ancient one fails, and every
   * restart grew the columns back. A live yard file had collected both.
   */
  it('opening the same file again changes nothing about its shape', () => {
    const columnsOf = (db: DatabaseSync, table: string): string[] =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (c) => c.name,
      );

    for (const build of [buildV4, (): DatabaseSync => new DatabaseSync(':memory:')]) {
      const db = build();
      migrate(db);
      const after = {
        containers: columnsOf(db, 'containers'),
        blocks: columnsOf(db, 'blocks'),
        movements: columnsOf(db, 'movements'),
      };
      expect(after.containers).not.toContain('status');
      expect(after.blocks).not.toContain('state');

      // Three more restarts must be perfectly boring.
      migrate(db);
      migrate(db);
      migrate(db);
      expect(columnsOf(db, 'containers')).toEqual(after.containers);
      expect(columnsOf(db, 'blocks')).toEqual(after.blocks);
      expect(columnsOf(db, 'movements')).toEqual(after.movements);
      db.close();
    }
  });

  it('a file that already grew the phantom columns is cleaned on the next open', () => {
    const db = buildV4();
    migrate(db);
    // Exactly what the live file looked like: past v8, yet carrying both.
    db.exec("ALTER TABLE containers ADD COLUMN status TEXT NOT NULL DEFAULT 'NORMAL'");
    db.exec("ALTER TABLE blocks ADD COLUMN state TEXT NOT NULL DEFAULT 'NORMAL'");

    migrate(db);
    const containers = (
      db.prepare('PRAGMA table_info(containers)').all() as Array<{ name: string }>
    ).map((c) => c.name);
    const blocks = (db.prepare('PRAGMA table_info(blocks)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(containers).not.toContain('status');
    expect(blocks).not.toContain('state');
    // And nothing was lost in the sweep.
    expect(db.prepare('SELECT COUNT(*) AS n FROM containers').get()).toMatchObject({ n: 2 });
  });

  it('a fresh file starts at v8 and holds the capacity vocabulary closed', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 8 });
    db.exec(
      "INSERT INTO blocks (name, size, rows, places_per_tier, tiers, x, y) VALUES ('B', 0, 2, 4, 2, 0, 0)",
    );
    expect(db.prepare('SELECT places_per_tier, tiers FROM blocks').get()).toMatchObject({
      places_per_tier: 4,
      tiers: 2,
    });
    // A location that holds nothing is not a location.
    expect(() => {
      db.exec('UPDATE blocks SET places_per_tier = 0');
    }).toThrow();
    expect(() => {
      db.exec('UPDATE blocks SET tiers = 0');
    }).toThrow();
    // Two containers may now share one location — no unique index stops them.
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_one_per_position'").get(),
    ).toBeUndefined();
  });
});
