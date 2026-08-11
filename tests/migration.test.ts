import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/db';

/**
 * v9 is a cutover, not a carry-over: the owner ordered the old test-era
 * containers wiped — «شيل كل الحاويات الموجودة واشتغل على النظام الجديد
 * تماما» — while the staff, their PINs and the owner's password survive.
 * The old file is snapshotted beside itself first.
 */

const scratch = (): string => mkdtempSync(path.join(tmpdir(), 'yard-v9-'));

/** A faithful little v8 file: settings, users, blocks, containers, movements. */
function buildV8File(file: string): void {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings VALUES ('password', 'scrypt-salt:hash'), ('cookie_secret', 'sekrit'),
                                ('card_in_next', '61'), ('card_out_next', '17');
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, pin_hash TEXT NOT NULL,
      perms TEXT NOT NULL DEFAULT '', deleted_at TEXT
    );
    CREATE UNIQUE INDEX idx_users_live_name ON users (name) WHERE deleted_at IS NULL;
    INSERT INTO users (name, pin_hash, perms) VALUES
      ('وسام', 'salt:pin', 'GATE_IN,MOVE,GATE_OUT,EDIT,REPORTS');
    CREATE TABLE blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      size INTEGER NOT NULL CHECK (size IN (0, 20, 40)),
      rows INTEGER NOT NULL, places_per_tier INTEGER NOT NULL, tiers INTEGER NOT NULL,
      x REAL NOT NULL, y REAL NOT NULL, angle REAL NOT NULL DEFAULT 0, deleted_at TEXT
    );
    INSERT INTO blocks (name, size, rows, places_per_tier, tiers, x, y) VALUES ('A', 20, 15, 4, 2, 0, 0);
    CREATE TABLE containers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL, number_valid INTEGER NOT NULL,
      size INTEGER NOT NULL CHECK (size IN (20, 40)), customer TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '', entered_at TEXT NOT NULL, exited_at TEXT,
      block_id INTEGER REFERENCES blocks (id), row INTEGER,
      weight TEXT NOT NULL DEFAULT '', truck_in TEXT NOT NULL DEFAULT '',
      driver_in TEXT NOT NULL DEFAULT '', seal_in TEXT NOT NULL DEFAULT '', card_in INTEGER,
      truck_out TEXT NOT NULL DEFAULT '', driver_out TEXT NOT NULL DEFAULT '',
      seal_out TEXT NOT NULL DEFAULT '', card_out INTEGER, deleted_at TEXT
    );
    INSERT INTO containers (number, number_valid, size, customer, entered_at, block_id, row, seal_in, card_in)
      VALUES ('MSCU1234566', 1, 20, 'شركة النورس', '2026-08-01T08:00:00.000Z', 1, 1, 'JO1', 1);
    CREATE TABLE movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, container_id INTEGER NOT NULL REFERENCES containers (id),
      type TEXT NOT NULL, at TEXT NOT NULL,
      from_block INTEGER, from_row INTEGER, to_block INTEGER, to_row INTEGER,
      note TEXT NOT NULL DEFAULT '', user_id INTEGER REFERENCES users (id)
    );
    INSERT INTO movements (container_id, type, at, to_block, to_row, user_id)
      VALUES (1, 'IN', '2026-08-01T08:00:00.000Z', 1, 1, 1);
    PRAGMA user_version = 8;
  `);
  db.close();
}

const columnsOf = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

const tablesOf = (db: DatabaseSync): string[] =>
  (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
  )
    .map((t) => t.name)
    .sort();

describe('schema v9 — the cutover to the official yard', () => {
  it('wipes the invented-yard era but keeps the people and the password', () => {
    const dir = scratch();
    const file = path.join(dir, 'yard.db');
    buildV8File(file);

    const db = openDatabase(file);

    // The staff and the settings crossed over untouched.
    const users = db.prepare('SELECT name, pin_hash, perms FROM users').all() as Array<{
      name: string;
      pin_hash: string;
      perms: string;
    }>;
    expect(users).toEqual([
      { name: 'وسام', pin_hash: 'salt:pin', perms: 'GATE_IN,MOVE,GATE_OUT,EDIT,REPORTS' },
    ]);
    expect(
      (db.prepare("SELECT value FROM settings WHERE key = 'password'").get() as { value: string })
        .value,
    ).toBe('scrypt-salt:hash');

    // The containers and movements did not: the new registry starts empty,
    // on the new position columns, and the card serials start over from 1.
    expect((db.prepare('SELECT COUNT(*) AS n FROM containers').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM movements').get() as { n: number }).n).toBe(0);
    expect(columnsOf(db, 'containers')).toContain('zone');
    expect(columnsOf(db, 'containers')).toContain('stack');
    expect(columnsOf(db, 'containers')).not.toContain('block_id');
    expect(columnsOf(db, 'movements')).toContain('from_stack');
    expect(
      db.prepare("SELECT value FROM settings WHERE key = 'card_in_next'").get(),
    ).toBeUndefined();

    // The yard's shape left the database entirely.
    expect(tablesOf(db)).toEqual(['containers', 'movements', 'settings', 'users']);
    expect(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(12);
    db.close();
  });

  it('snapshots the old file beside itself before touching it', () => {
    const dir = scratch();
    const file = path.join(dir, 'yard.db');
    buildV8File(file);

    openDatabase(file).close();

    const backup = `${file}.pre-v9-backup.db`;
    expect(existsSync(backup)).toBe(true);
    // The snapshot still holds the old world, container and all.
    const old = new DatabaseSync(backup, { readOnly: true });
    expect((old.prepare('SELECT COUNT(*) AS n FROM containers').get() as { n: number }).n).toBe(1);
    expect(columnsOf(old, 'containers')).toContain('block_id');
    old.close();
  });

  it('is idempotent: reopening moves nothing and never re-wipes', () => {
    const dir = scratch();
    const file = path.join(dir, 'yard.db');
    buildV8File(file);

    openDatabase(file).close();
    const backupBytes = readFileSync(`${file}.pre-v9-backup.db`).length;

    // Live again on v9: a container goes in and must SURVIVE reopening.
    const db = openDatabase(file);
    db.prepare(
      `INSERT INTO containers (number, number_valid, size, customer, entered_at, zone, bay, stack, tier)
       VALUES ('TGHU7777777', 1, 20, 'شركة', '2026-08-10T08:00:00.000Z', 'A', 3, 1, 'A')`,
    ).run();
    db.close();

    for (let i = 0; i < 3; i += 1) openDatabase(file).close();

    const again = openDatabase(file);
    expect((again.prepare('SELECT COUNT(*) AS n FROM containers').get() as { n: number }).n).toBe(
      1,
    );
    again.close();
    expect(readFileSync(`${file}.pre-v9-backup.db`).length).toBe(backupBytes);
  });

  it('brings a fresh file straight up with the bill and the third tier', () => {
    const dir = scratch();
    const file = path.join(dir, 'fresh.db');
    const db = openDatabase(file);
    expect(tablesOf(db)).toEqual(['containers', 'movements', 'settings', 'users']);
    expect(columnsOf(db, 'containers')).toContain('tier');
    expect(columnsOf(db, 'containers')).toContain('bill');
    // Tier C is legal on a fresh file — the CHECK admits the reserve floor.
    db.prepare(
      `INSERT INTO containers (number, number_valid, size, customer, entered_at, zone, bay, stack, tier)
       VALUES ('CCCC0001', 1, 20, 'شركة', '2026-08-10T08:00:00.000Z', 'B', 1, 1, 'C')`,
    ).run();
    expect(existsSync(`${file}.pre-v9-backup.db`)).toBe(false);
    db.close();
  });

  it('v9 → v10 carries every container over and adds the bill', () => {
    const dir = scratch();
    const file = path.join(dir, 'v9.db');
    // A faithful v9 file: the new position columns, no bill, two-tier CHECK.
    const db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO settings VALUES ('password', 'x');
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, pin_hash TEXT NOT NULL,
        perms TEXT NOT NULL DEFAULT '', deleted_at TEXT
      );
      CREATE TABLE containers (
        id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL, number_valid INTEGER NOT NULL,
        size INTEGER NOT NULL CHECK (size IN (20, 40)), customer TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '', entered_at TEXT NOT NULL, exited_at TEXT,
        zone TEXT CHECK (zone IN ('A', 'B', 'C', 'D', 'E')), bay INTEGER, stack INTEGER,
        tier TEXT CHECK (tier IN ('A', 'B')),
        weight TEXT NOT NULL DEFAULT '', truck_in TEXT NOT NULL DEFAULT '',
        driver_in TEXT NOT NULL DEFAULT '', seal_in TEXT NOT NULL DEFAULT '', card_in INTEGER,
        truck_out TEXT NOT NULL DEFAULT '', driver_out TEXT NOT NULL DEFAULT '',
        seal_out TEXT NOT NULL DEFAULT '', card_out INTEGER, deleted_at TEXT
      );
      INSERT INTO containers (number, number_valid, size, customer, entered_at, zone, bay, stack, tier, seal_in)
        VALUES ('MSCU1234566', 1, 20, 'شركة النورس', '2026-08-10T08:00:00.000Z', 'B', 3, 1, 'A', 'JO1');
      CREATE TABLE movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT, container_id INTEGER NOT NULL REFERENCES containers (id),
        type TEXT NOT NULL, at TEXT NOT NULL,
        from_zone TEXT, from_bay INTEGER, from_stack INTEGER, from_tier TEXT,
        to_zone TEXT, to_bay INTEGER, to_stack INTEGER, to_tier TEXT,
        note TEXT NOT NULL DEFAULT '', user_id INTEGER REFERENCES users (id)
      );
      INSERT INTO movements (container_id, type, at, to_zone, to_bay, to_stack, to_tier)
        VALUES (1, 'IN', '2026-08-10T08:00:00.000Z', 'B', 3, 1, 'A');
      PRAGMA user_version = 9;
    `);
    db.close();

    const upgraded = openDatabase(file);
    // NON-destructive this time: the standing container is still standing.
    const row = upgraded
      .prepare('SELECT number, zone, bay, stack, tier, bill FROM containers')
      .get() as { number: string; zone: string; bill: string };
    expect(row).toMatchObject({ number: 'MSCU1234566', zone: 'B', bill: '' });
    expect(
      (upgraded.prepare('SELECT COUNT(*) AS n FROM movements').get() as { n: number }).n,
    ).toBe(1);
    // And tier C is now legal where the v9 CHECK refused it.
    upgraded
      .prepare(
        `INSERT INTO containers (number, number_valid, size, customer, entered_at, zone, bay, stack, tier)
         VALUES ('CCCC0002', 1, 20, 'شركة', '2026-08-10T09:00:00.000Z', 'B', 3, 1, 'C')`,
      )
      .run();
    upgraded.close();
  });

  /**
   * v11 → v12: the gate cards start counting again every January. Nothing
   * already printed is renumbered — a card in somebody's hand keeps the number
   * on it — and each year's counter resumes above the highest serial that year
   * actually issued, so no two cards of one year can ever share a number.
   */
  it('v11 → v12 dates every card already printed and splits the counter by year', () => {
    const dir = scratch();
    const file = path.join(dir, 'v11.db');
    const db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO settings VALUES ('password', 'x'), ('card_in_next', '4'), ('card_out_next', '3');
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, pin_hash TEXT NOT NULL,
        perms TEXT NOT NULL DEFAULT '', deleted_at TEXT
      );
      CREATE TABLE containers (
        id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL, number_valid INTEGER NOT NULL,
        size INTEGER NOT NULL CHECK (size IN (20, 40)), customer TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '', entered_at TEXT NOT NULL, exited_at TEXT,
        bill TEXT NOT NULL DEFAULT '',
        zone TEXT CHECK (zone IN ('A', 'B', 'C', 'D', 'E')), bay INTEGER, stack INTEGER,
        tier TEXT CHECK (tier IN ('A', 'B', 'C')),
        weight TEXT NOT NULL DEFAULT '', weight_net TEXT NOT NULL DEFAULT '',
        truck_in TEXT NOT NULL DEFAULT '',
        driver_in TEXT NOT NULL DEFAULT '', seal_in TEXT NOT NULL DEFAULT '', card_in INTEGER,
        truck_out TEXT NOT NULL DEFAULT '', driver_out TEXT NOT NULL DEFAULT '',
        seal_out TEXT NOT NULL DEFAULT '', card_out INTEGER,
        hazmat INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
      );
      -- Two years of cards: 2025 got as far as 2 in and 1 out, 2026 to 3 and 2.
      INSERT INTO containers (id, number, number_valid, size, customer, entered_at, exited_at,
                              card_in, card_out, seal_in)
        VALUES (1, 'AAAA0001', 1, 20, 'شركة', '2025-03-04T09:00:00.000Z', '2025-03-09T09:00:00.000Z', 1, 1, 'JO1'),
               (2, 'AAAA0002', 1, 20, 'شركة', '2025-11-20T09:00:00.000Z', NULL, 2, NULL, 'JO2'),
               (3, 'AAAA0003', 1, 20, 'شركة', '2026-01-06T09:00:00.000Z', '2026-02-01T09:00:00.000Z', 1, 1, 'JO3'),
               (4, 'AAAA0004', 1, 20, 'شركة', '2026-05-11T09:00:00.000Z', '2026-06-01T09:00:00.000Z', 3, 2, 'JO4');
      CREATE TABLE movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT, container_id INTEGER NOT NULL REFERENCES containers (id),
        type TEXT NOT NULL CHECK (type IN ('IN', 'MOVE', 'DROP', 'OUT', 'EDIT', 'DELETE', 'RESTORE')),
        at TEXT NOT NULL,
        from_zone TEXT, from_bay INTEGER, from_stack INTEGER, from_tier TEXT,
        to_zone TEXT, to_bay INTEGER, to_stack INTEGER, to_tier TEXT,
        note TEXT NOT NULL DEFAULT '', user_id INTEGER REFERENCES users (id)
      );
      PRAGMA user_version = 11;
    `);
    db.close();

    const upgraded = openDatabase(file);
    const cards = upgraded
      .prepare('SELECT id, card_in, card_in_year, card_out, card_out_year FROM containers ORDER BY id')
      .all() as Array<Record<string, number | null>>;
    // Every serial survives untouched, now dated.
    expect(cards).toEqual([
      { id: 1, card_in: 1, card_in_year: 2025, card_out: 1, card_out_year: 2025 },
      { id: 2, card_in: 2, card_in_year: 2025, card_out: null, card_out_year: null },
      { id: 3, card_in: 1, card_in_year: 2026, card_out: 1, card_out_year: 2026 },
      { id: 4, card_in: 3, card_in_year: 2026, card_out: 2, card_out_year: 2026 },
    ]);

    const counters = Object.fromEntries(
      (
        upgraded
          .prepare("SELECT key, value FROM settings WHERE key LIKE 'card%' ORDER BY key")
          .all() as Array<{ key: string; value: string }>
      ).map((row) => [row.key, row.value]),
    );
    expect(counters).toEqual({
      'card_in_next:2025': '3',
      'card_in_next:2026': '4',
      'card_out_next:2025': '2',
      'card_out_next:2026': '3',
    });
    upgraded.close();
  });
});
