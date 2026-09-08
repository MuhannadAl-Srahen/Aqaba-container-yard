import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/db';
import { nextCardNumber } from '../src/server/store';

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
    expect(tablesOf(db)).toEqual([
      'batch_rows',
      'batches',
      'carriers',
      'containers',
      'custom_zones',
      'gate_calls',
      'movements',
      'permit_items',
      'permits',
      'photos',
      'settings',
      'tasks',
      'trucks',
      'users',
      'wages',
    ]);
    expect(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(28);
    db.close();
  });

  it('v20: a permit_items table born under v19 gains its snapshot columns, backfilled', () => {
    const dir = scratch();
    const file = path.join(dir, 'yard.db');
    // A yard that issued a permit under v19: the line held only the container
    // id and the truck, and the paper's facts lived in the containers table.
    const first = openDatabase(file);
    first.exec(`
      INSERT INTO containers (number, number_valid, size, bill, entered_at, zone, bay, stack, tier,
                              truck_in, driver_in, seal_in, card_in, card_in_year)
      VALUES ('MIGR0015', 1, 20, '3210', '2026-08-20T09:00:00.000Z', 'B', 1, 1, 'A',
              '60-84785', 'سائق', 'JO1', 7, 2026);
      INSERT INTO permits (serial, serial_year, bill, at) VALUES (1, 2026, '3210', '2026-08-21T09:00:00.000Z');
      INSERT INTO permit_items (permit_id, container_id, truck) VALUES (1, 1, '411');
      ALTER TABLE permit_items DROP COLUMN number;
      ALTER TABLE permit_items DROP COLUMN card_in;
      ALTER TABLE permit_items DROP COLUMN card_in_year;
      ALTER TABLE permit_items DROP COLUMN entered_at;
    `);
    first.close();

    const db = openDatabase(file);
    const line = db
      .prepare('SELECT number, card_in, card_in_year, entered_at, truck FROM permit_items')
      .get() as {
      number: string;
      card_in: number | null;
      card_in_year: number | null;
      entered_at: string;
      truck: string;
    };
    expect(line.number).toBe('MIGR0015');
    expect(line.card_in).toBe(7);
    expect(line.card_in_year).toBe(2026);
    expect(line.entered_at).toBe('2026-08-20T09:00:00.000Z');
    expect(line.truck).toBe('411');
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
      `INSERT INTO containers (number, number_valid, size, entered_at, zone, bay, stack, tier)
       VALUES ('TGHU7777777', 1, 20, '2026-08-10T08:00:00.000Z', 'A', 3, 1, 'A')`,
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
    expect(tablesOf(db)).toEqual([
      'batch_rows',
      'batches',
      'carriers',
      'containers',
      'custom_zones',
      'gate_calls',
      'movements',
      'permit_items',
      'permits',
      'photos',
      'settings',
      'tasks',
      'trucks',
      'users',
      'wages',
    ]);
    expect(columnsOf(db, 'containers')).toContain('tier');
    expect(columnsOf(db, 'containers')).toContain('bill');
    // A fresh file is never given the three struck-out columns to begin with.
    for (const gone of ['customer', 'weight_net', 'hazmat']) {
      expect(columnsOf(db, 'containers'), gone).not.toContain(gone);
    }
    // Tier C is legal on a fresh file — the CHECK admits the reserve floor.
    db.prepare(
      `INSERT INTO containers (number, number_valid, size, entered_at, zone, bay, stack, tier)
       VALUES ('CCCC0001', 1, 20, '2026-08-10T08:00:00.000Z', 'B', 1, 1, 'C')`,
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
        `INSERT INTO containers (number, number_valid, size, entered_at, zone, bay, stack, tier)
         VALUES ('CCCC0002', 1, 20, '2026-08-10T09:00:00.000Z', 'B', 3, 1, 'C')`,
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
    // Every serial is DATED and none is moved. The old file has entry cards 1
    // and 3 in 2026 with nothing at 2, and that hole is carried across
    // untouched: the numbers on this file's printed cards are the numbers the
    // register still reads.
    expect(cards).toEqual([
      { id: 1, card_in: 1, card_in_year: 2025, card_out: 1, card_out_year: 2025 },
      { id: 2, card_in: 2, card_in_year: 2025, card_out: null, card_out_year: null },
      { id: 3, card_in: 1, card_in_year: 2026, card_out: 1, card_out_year: 2026 },
      { id: 4, card_in: 3, card_in_year: 2026, card_out: 2, card_out_year: 2026 },
    ]);

    // v13 in the same breath: the serial is read from the records now, so the
    // counters kept beside them are gone.
    expect(
      upgraded.prepare("SELECT key FROM settings WHERE key LIKE 'card%'").all(),
    ).toHaveLength(0);
    upgraded.close();
  });

  /**
   * v15 → v16: a move inside the yard became a printed card, so the movements
   * table gains a serial and its year. Two nullable columns, so every
   * movement already written rides across and reads as no card — which is
   * what it was: nothing was printed for it.
   */
  it('v15 → v16 gives the movements a card of their own, losing nothing', () => {
    const dir = scratch();
    const file = path.join(dir, 'office-v15.db');
    const db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO settings VALUES ('password', 'scrypt:hash'), ('cookie_secret', 'sekrit');
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, pin_hash TEXT NOT NULL,
        perms TEXT NOT NULL DEFAULT '', deleted_at TEXT
      );
      INSERT INTO users (name, pin_hash, perms) VALUES ('وسام', 'salt:pin', 'MOVE');
      CREATE TABLE containers (
        id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL, number_valid INTEGER NOT NULL,
        size INTEGER NOT NULL CHECK (size IN (20, 40)),
        notes TEXT NOT NULL DEFAULT '', entered_at TEXT NOT NULL, exited_at TEXT,
        bill TEXT NOT NULL DEFAULT '',
        zone TEXT CHECK (zone IN ('A', 'B', 'C', 'D', 'E')), bay INTEGER, stack INTEGER,
        tier TEXT CHECK (tier IN ('A', 'B', 'C')),
        weight TEXT NOT NULL DEFAULT '', handling TEXT NOT NULL DEFAULT '',
        truck_in TEXT NOT NULL DEFAULT '', driver_in TEXT NOT NULL DEFAULT '',
        seal_in TEXT NOT NULL DEFAULT '', card_in INTEGER,
        truck_out TEXT NOT NULL DEFAULT '', driver_out TEXT NOT NULL DEFAULT '',
        seal_out TEXT NOT NULL DEFAULT '', card_out INTEGER,
        card_in_year INTEGER, card_out_year INTEGER, deleted_at TEXT
      );
      INSERT INTO containers (id, number, number_valid, size, entered_at, zone, bay, stack, tier,
                              card_in, card_in_year, seal_in)
        VALUES (1, 'MSCU1234566', 1, 20, '2026-08-10T08:00:00.000Z', 'B', 3, 1, 'A', 1, 2026, 'JO1');
      CREATE TABLE movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT, container_id INTEGER NOT NULL REFERENCES containers (id),
        type TEXT NOT NULL CHECK (type IN ('IN', 'MOVE', 'DROP', 'OUT', 'EDIT', 'DELETE', 'RESTORE')),
        at TEXT NOT NULL,
        from_zone TEXT, from_bay INTEGER, from_stack INTEGER, from_tier TEXT,
        to_zone TEXT, to_bay INTEGER, to_stack INTEGER, to_tier TEXT,
        note TEXT NOT NULL DEFAULT '', user_id INTEGER REFERENCES users (id)
      );
      INSERT INTO movements (container_id, type, at, to_zone, to_bay, to_stack, to_tier)
        VALUES (1, 'IN', '2026-08-10T08:00:00.000Z', 'B', 1, 1, 'A');
      INSERT INTO movements (container_id, type, at, from_zone, from_bay, from_stack, from_tier,
                             to_zone, to_bay, to_stack, to_tier)
        VALUES (1, 'MOVE', '2026-08-11T08:00:00.000Z', 'B', 1, 1, 'A', 'B', 3, 1, 'A');
      PRAGMA user_version = 15;
    `);
    db.close();

    const upgraded = openDatabase(file);
    expect(columnsOf(upgraded, 'movements')).toContain('card');
    expect(columnsOf(upgraded, 'movements')).toContain('card_year');
    // Both movements survive, and the move made before the cards existed
    // carries none — it was never printed.
    const movements = upgraded
      .prepare('SELECT type, card, card_year FROM movements ORDER BY id')
      .all() as Array<{ type: string; card: number | null; card_year: number | null }>;
    expect(movements).toEqual([
      { type: 'IN', card: null, card_year: null },
      { type: 'MOVE', card: null, card_year: null },
    ]);
    // The container and its gate card are untouched by any of it.
    expect(
      upgraded.prepare('SELECT number, card_in FROM containers').get(),
    ).toEqual({ number: 'MSCU1234566', card_in: 1 });
    upgraded.close();
  });

  /**
   * A hole is LEGAL now, and opening the file leaves it exactly where it is.
   * The old repair ran on every open and re-seated the whole year; removing it
   * is the owner's reversal — «ما بدي حدا يوخذ مكانها خلص يضل يكمل» — and
   * this is the test that would catch it coming back.
   */
  it('leaves a hole in the numbering exactly where it is, on every open', () => {
    const dir = scratch();
    const file = path.join(dir, 'holed.db');
    const seed = openDatabase(file);
    // Written straight in, the way an older version of this program left it:
    // entry cards 1, 2 and 4 in 2026 with number 3 struck out and lost.
    for (const [day, serial] of [
      [1, 1],
      [2, 2],
      [4, 4],
    ] as const) {
      seed
        .prepare(
          `INSERT INTO containers (number, number_valid, size, entered_at, zone, bay, stack, tier,
                                   card_in, card_in_year)
           VALUES (?, 1, 20, ?, 'B', 3, ?, 'A', ?, 2026)`,
        )
        .run(
          `HOLE000${String(serial)}`,
          `2026-06-0${String(day)}T09:00:00.000Z`,
          day,
          serial,
        );
    }
    seed.close();

    const backup = `${file}.pre-renumber-backup.db`;
    expect(existsSync(backup)).toBe(false);

    const opened = openDatabase(file);
    const serials = (
      opened
        .prepare('SELECT card_in AS serial FROM containers ORDER BY entered_at')
        .all() as Array<{ serial: number }>
    ).map((row) => row.serial);
    // The hole at 3 is still a hole. Nothing moved.
    expect(serials).toEqual([1, 2, 4]);
    // And the next card carries on past the top rather than into the gap.
    expect(nextCardNumber(opened, 'in', 2026)).toBe(5);
    opened.close();

    // Nothing was rewritten, so no rescue copy was ever needed.
    expect(existsSync(backup)).toBe(false);

    // Opening again is the same answer — it is a rule, not a one-time script.
    const again = openDatabase(file);
    expect(
      (
        again.prepare('SELECT MAX(card_in) AS top FROM containers').get() as { top: number }
      ).top,
    ).toBe(4);
    again.close();
    expect(existsSync(backup)).toBe(false);
  });

  /**
   * «when I install the update, is it going to change the رقم التسلسلي?»
   *
   * Only where it has to. A year that already reads 1 … N is left exactly as
   * it is — which is this file, where the struck-out record is the LAST one
   * and the four live cards run 1, 2, 3, 4. A year with a hole in it is the
   * other test, and closing that hole is what the owner asked for.
   */
  it('imports every serial untouched, and counts on past the struck-out one', () => {
    const dir = scratch();
    const file = path.join(dir, 'office-serials.db');
    const db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      -- The counter had run to 6, because number 5 was issued and then struck.
      INSERT INTO settings VALUES ('password', 'x'), ('card_in_next:2026', '6'),
                                  ('card_out_next:2026', '3');
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
        card_in_year INTEGER, card_out_year INTEGER,
        hazmat INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
      );
      -- Four standing, one gone out, one struck out — a month of real work.
      INSERT INTO containers (id, number, number_valid, size, customer, entered_at, exited_at,
                              zone, bay, stack, tier, card_in, card_in_year,
                              card_out, card_out_year, seal_in, deleted_at)
        VALUES (1, 'AAAA0001', 1, 20, 'ش', '2026-08-01T09:00:00.000Z', NULL, 'B', 1, 1, 'A', 1, 2026, NULL, NULL, 'J1', NULL),
               (2, 'AAAA0002', 1, 20, 'ش', '2026-08-02T09:00:00.000Z', NULL, 'B', 3, 1, 'A', 2, 2026, NULL, NULL, 'J2', NULL),
               (3, 'AAAA0003', 1, 20, 'ش', '2026-08-03T09:00:00.000Z', '2026-08-09T09:00:00.000Z', NULL, NULL, NULL, NULL, 3, 2026, 1, 2026, 'J3', NULL),
               (4, 'AAAA0004', 1, 20, 'ش', '2026-08-04T09:00:00.000Z', '2026-08-10T09:00:00.000Z', NULL, NULL, NULL, NULL, 4, 2026, 2, 2026, 'J4', NULL),
               (5, 'AAAA0005', 1, 20, 'ش', '2026-08-05T09:00:00.000Z', NULL, NULL, NULL, NULL, NULL, 5, 2026, NULL, NULL, 'J5', '2026-08-05T10:00:00.000Z');
      CREATE TABLE movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT, container_id INTEGER NOT NULL REFERENCES containers (id),
        type TEXT NOT NULL CHECK (type IN ('IN', 'MOVE', 'DROP', 'OUT', 'EDIT', 'DELETE', 'RESTORE')),
        at TEXT NOT NULL,
        from_zone TEXT, from_bay INTEGER, from_stack INTEGER, from_tier TEXT,
        to_zone TEXT, to_bay INTEGER, to_stack INTEGER, to_tier TEXT,
        note TEXT NOT NULL DEFAULT '', user_id INTEGER REFERENCES users (id)
      );
      PRAGMA user_version = 12;
    `);
    db.close();

    const upgraded = openDatabase(file);
    // Every serial is exactly what it was, deleted record included.
    const after = upgraded
      .prepare('SELECT id, card_in, card_in_year, card_out, card_out_year FROM containers ORDER BY id')
      .all();
    expect(after).toEqual([
      { id: 1, card_in: 1, card_in_year: 2026, card_out: null, card_out_year: null },
      { id: 2, card_in: 2, card_in_year: 2026, card_out: null, card_out_year: null },
      { id: 3, card_in: 3, card_in_year: 2026, card_out: 1, card_out_year: 2026 },
      { id: 4, card_in: 4, card_in_year: 2026, card_out: 2, card_out_year: 2026 },
      { id: 5, card_in: 5, card_in_year: 2026, card_out: null, card_out_year: null },
    ]);

    // The next entry card takes 6, past the 5 the struck-out record is still
    // holding: a serial printed once is never printed again.
    expect(nextCardNumber(upgraded, 'in', 2026)).toBe(6);
    // And the exits carry on from where they truly are.
    expect(nextCardNumber(upgraded, 'out', 2026)).toBe(3);
    // A year the office has not reached yet starts at one.
    expect(nextCardNumber(upgraded, 'in', 2027)).toBe(1);
    upgraded.close();
  });

  /**
   * v13 on a database that has been WORKING — the office one, carried over by
   * an update rather than created fresh. «تأكد ايضا ان يتم حذفها معلومات اسم
   * المالك والأوزان في حال نقل التحديث الى الجهاز الأخر»: the three struck-out
   * fields must leave the FILE there too, and everything else must survive.
   */
  it('v12 → v13 strikes the three columns from a working office database', () => {
    const dir = scratch();
    const file = path.join(dir, 'office.db');
    const db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO settings VALUES ('password', 'scrypt:hash'), ('cookie_secret', 'sekrit'),
                                  ('card_in_next:2026', '9');
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, pin_hash TEXT NOT NULL,
        perms TEXT NOT NULL DEFAULT '', deleted_at TEXT
      );
      INSERT INTO users (name, pin_hash, perms) VALUES ('وسام', 'salt:pin', 'GATE_IN');
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
        card_in_year INTEGER, card_out_year INTEGER,
        hazmat INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
      );
      INSERT INTO containers (number, number_valid, size, customer, entered_at, bill,
                              zone, bay, stack, tier, weight, weight_net, hazmat,
                              seal_in, card_in, card_in_year, notes)
        VALUES ('MSCU1234566', 1, 20, 'شركة البحر الأحمر', '2026-08-10T08:00:00.000Z', '3210',
                'B', 3, 1, 'A', '28000', '24000', 1, 'JO1', 8, 2026, 'الباب مبعوج');
      CREATE TABLE movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT, container_id INTEGER NOT NULL REFERENCES containers (id),
        type TEXT NOT NULL CHECK (type IN ('IN', 'MOVE', 'DROP', 'OUT', 'EDIT', 'DELETE', 'RESTORE')),
        at TEXT NOT NULL,
        from_zone TEXT, from_bay INTEGER, from_stack INTEGER, from_tier TEXT,
        to_zone TEXT, to_bay INTEGER, to_stack INTEGER, to_tier TEXT,
        note TEXT NOT NULL DEFAULT '', user_id INTEGER REFERENCES users (id)
      );
      INSERT INTO movements (container_id, type, at, to_zone, to_bay, to_stack, to_tier)
        VALUES (1, 'IN', '2026-08-10T08:00:00.000Z', 'B', 3, 1, 'A');
      PRAGMA user_version = 12;
    `);
    db.close();

    const upgraded = openDatabase(file);
    for (const gone of ['customer', 'weight_net', 'hazmat']) {
      expect(columnsOf(upgraded, 'containers'), gone).not.toContain(gone);
    }
    // Everything else rode across: the container, its movement, its staff and
    // the session secret that keeps them signed in — its SERIAL included. The
    // file carries one live record of 2026 holding card 8, with seven numbers
    // missing in front of it, and card 8 is what its printed paper says. The
    // upgrade does not argue with the paper.
    const kept = upgraded
      .prepare('SELECT number, bill, zone, bay, weight, card_in, card_in_year, notes FROM containers')
      .get() as Record<string, unknown>;
    expect(kept).toEqual({
      number: 'MSCU1234566',
      bill: '3210',
      zone: 'B',
      bay: 3,
      weight: '28000',
      card_in: 8,
      card_in_year: 2026,
      notes: 'الباب مبعوج',
    });
    expect((upgraded.prepare('SELECT COUNT(*) AS n FROM movements').get() as { n: number }).n).toBe(
      1,
    );
    expect((upgraded.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(1);
    expect(
      (upgraded.prepare("SELECT value FROM settings WHERE key = 'cookie_secret'").get() as {
        value: string;
      }).value,
    ).toBe('sekrit');
    expect(upgraded.prepare("SELECT key FROM settings WHERE key LIKE 'card%'").all()).toHaveLength(
      0,
    );
    upgraded.close();

    // The columns cannot be brought back, but the file as it stood can: a copy
    // is written beside it before a single one is dropped.
    const backup = `${file}.pre-v13-backup.db`;
    expect(existsSync(backup)).toBe(true);
    const old = new DatabaseSync(backup, { readOnly: true });
    expect(
      (old.prepare('SELECT customer FROM containers').get() as { customer: string }).customer,
    ).toBe('شركة البحر الأحمر');
    old.close();

    // And re-opening does not write a second backup or fail on the missing
    // columns — every machine runs this exactly once.
    const bytes = readFileSync(backup).length;
    openDatabase(file).close();
    expect(readFileSync(backup).length).toBe(bytes);
  });
});
