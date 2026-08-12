import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ammanYear } from '../shared/dates';
import { applyCardFixes, renumberPlan } from './store';

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
  migrate(db, file);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/**
 * The file this handle is actually writing to. A `:memory:` database answers
 * with a blank, which is how the routes that need a real file on disk know to
 * refuse instead of pretending.
 */
export function databaseFile(db: DatabaseSync): string {
  const rows = db.prepare('PRAGMA database_list').all() as Array<{ name: string; file: string }>;
  return rows.find((row) => row.name === 'main')?.file ?? '';
}

/**
 * A complete single-file copy beside the live one, WAL folded in, named for
 * the moment it was taken. Every destructive operation takes one first — a
 * wipe or a restore should never be the last word on anything.
 */
export function snapshot(db: DatabaseSync, label: string): string {
  const live = databaseFile(db);
  if (live === '') throw new Error('no file to snapshot');
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-').replace('T', '-');
  const dir = path.join(path.dirname(live), 'backups');
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${label}-${stamp}.db`);
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  return target;
}

/**
 * Schema v9: the yard became the official ASEZA yard, and a position became
 * the exact five-part slot (zone, bay, stack, tier). The yard's SHAPE left
 * the database entirely — it is the authority's own drawing, decoded into
 * `src/shared/asezaLayout.ts` and locked by tests to the printed totals.
 *
 * Everything before v9 is one wipe step, on the owner's explicit call for the
 * cutover: «شيل كل الحاويات الموجودة واشتغل على النظام الجديد تماما». The
 * containers, movements and blocks of the invented-yard era go; the staff,
 * their PINs and permissions, and the owner's password stay. The old file is
 * snapshotted beside itself first, so nothing is ever truly unrecoverable.
 */
/** Does this table still carry that column? Asked of the file, not of a version. */
function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

export function migrate(db: DatabaseSync, file: string): void {
  const tableSql = (name: string): string | undefined =>
    (
      db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as
        | { sql: string }
        | undefined
    )?.sql;

  const containersSql = tableSql('containers');
  // `stack` never existed before v9 — every earlier era lacks it. (v1 had a
  // `tier` column too, so `tier` alone would misread an ancient file.)
  const preV9 =
    (containersSql !== undefined && !containersSql.includes('stack')) ||
    tableSql('blocks') !== undefined ||
    tableSql('yard') !== undefined;

  if (preV9) {
    if (file !== ':memory:') {
      const backup = `${file}.pre-v9-backup.db`;
      if (!existsSync(backup)) {
        // A clean single-file snapshot, WAL folded in.
        db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
      }
    }
    db.exec(`
      DROP TABLE IF EXISTS movements;
      DROP TABLE IF EXISTS containers;
      DROP TABLE IF EXISTS blocks;
      DROP TABLE IF EXISTS slot_states;
      DROP TABLE IF EXISTS yard;
    `);
    // A new registry starts its card serials from 1.
    if (tableSql('settings') !== undefined) {
      db.exec("DELETE FROM settings WHERE key IN ('card_in_next', 'card_out_next')");
    }
  }

  // v10: رقم البوليصة joins the container, and the reserve third tier (C)
  // must pass the tier CHECK — SQLite cannot edit a CHECK in place, so a v9
  // file gets its containers rebuilt, every row carried over. Detected from
  // the table's own SQL, never a version stamp.
  const v9ContainersSql = tableSql('containers');
  if (v9ContainersSql !== undefined && !v9ContainersSql.includes('bill')) {
    upgradeV9toV10(db);
  }

  // v11: مواد خطرة on the container, and gravity on the grid. The hazmat flag
  // is a plain defaulted column, so it goes in place; the DROP movement type
  // widens a CHECK, so movements are rebuilt the same way v10 rebuilt
  // containers. Both non-destructive, both read from the file's own SQL.
  const v10ContainersSql = tableSql('containers');
  if (v10ContainersSql !== undefined) {
    if (!v10ContainersSql.includes('hazmat')) {
      db.exec('ALTER TABLE containers ADD COLUMN hazmat INTEGER NOT NULL DEFAULT 0');
    }
    // The gate card names two weights; `weight` keeps its rows and becomes
    // the gross one, so nothing already recorded has to be re-entered.
    if (!v10ContainersSql.includes('weight_net')) {
      db.exec("ALTER TABLE containers ADD COLUMN weight_net TEXT NOT NULL DEFAULT ''");
    }
  }
  const v10MovementsSql = tableSql('movements');
  if (v10MovementsSql !== undefined && !v10MovementsSql.includes("'DROP'")) {
    upgradeMovementsV11(db);
  }

  // v12: the gate cards are numbered per YEAR and start again at 1 each
  // January, on the owner's call. A serial alone stops identifying a card, so
  // the year it counts within is stored beside it — derived rather than
  // re-derived from the gate date later, which the owner is free to correct.
  const v11ContainersSql = tableSql('containers');
  if (v11ContainersSql !== undefined && !v11ContainersSql.includes('card_in_year')) {
    db.exec('ALTER TABLE containers ADD COLUMN card_in_year INTEGER');
    db.exec('ALTER TABLE containers ADD COLUMN card_out_year INTEGER');
    backfillCardYears(db);
  }

  // v13: three fields the owner struck out — «رح يتم ازالة اسم المالك تماما»,
  // the net weight, and the dangerous-goods flag, «لان جميع الحاويات عادية».
  // They go from the FILE, not merely from the screens, and they go on every
  // machine the update reaches, because this runs when the database is opened.
  // A copy of the file is written beside itself first: the columns cannot be
  // brought back, but the yard as it stood this morning can.
  const v12ContainersSql = tableSql('containers');
  const struck = ['customer', 'weight_net', 'hazmat'].filter(
    (column) => v12ContainersSql !== undefined && columnExists(db, 'containers', column),
  );
  if (struck.length > 0) {
    if (file !== ':memory:') {
      const backup = `${file}.pre-v13-backup.db`;
      if (!existsSync(backup)) db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    }
    for (const column of struck) db.exec(`ALTER TABLE containers DROP COLUMN ${column}`);
    // The card counters moved into the records themselves in the same round;
    // the keys they used to live under are dead weight now.
    if (tableSql('settings') !== undefined) {
      db.exec("DELETE FROM settings WHERE key LIKE 'card\\_in\\_next%' ESCAPE '\\'");
      db.exec("DELETE FROM settings WHERE key LIKE 'card\\_out\\_next%' ESCAPE '\\'");
    }
  }

  // v14: what lifted the container off the truck — a crane or a straddle
  // carrier. A plain defaulted column, so it goes in place; records from
  // before it read blank, which the wire sends as null.
  const v13ContainersSql = tableSql('containers');
  if (v13ContainersSql !== undefined && !columnExists(db, 'containers', 'handling')) {
    db.exec("ALTER TABLE containers ADD COLUMN handling TEXT NOT NULL DEFAULT ''");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- The gate staff. The owner is NOT a row here — the owner is the site
    -- password in settings, and carries every permission by definition.
    -- Soft delete: last year's register still names whoever signed it, long
    -- after they stopped working here.
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      -- scrypt salt:hash of the PIN, the same routine as the owner's password.
      pin_hash   TEXT    NOT NULL,
      -- Comma-separated permission codes; the empty string is "may sign in
      -- and look, nothing more".
      perms      TEXT    NOT NULL DEFAULT '',
      deleted_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_live_name
      ON users (name) WHERE deleted_at IS NULL;

    -- One row per container VISIT. The same physical box returning months
    -- later is a new row with its own history.
    CREATE TABLE IF NOT EXISTS containers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      number        TEXT    NOT NULL,
      number_valid  INTEGER NOT NULL,
      size          INTEGER NOT NULL CHECK (size IN (20, 40)),
      -- Free text: the condition it arrived in, a customs hold, anything the
      -- crew needs the next person to read.
      notes         TEXT    NOT NULL DEFAULT '',
      entered_at    TEXT    NOT NULL,
      exited_at     TEXT,
      -- رقم البوليصة: the bill of lading that gathers a group of containers.
      bill          TEXT    NOT NULL DEFAULT '',
      -- The exact official slot (1-A-03-01-A), present exactly while it
      -- stands in the yard. The bay's parity repeats the size on purpose:
      -- odd bay = 20, even bay = a 40 across the two odd bays around it.
      zone          TEXT    CHECK (zone IN ('A', 'B', 'C', 'D', 'E')),
      bay           INTEGER,
      stack         INTEGER,
      tier          TEXT    CHECK (tier IN ('A', 'B', 'C')),
      -- The gate paperwork: the weight, trucks, drivers, seals and card
      -- serials. A different seal on the way out means the door was opened
      -- inside. One weight only, free text, as the scale ticket reads it.
      weight        TEXT    NOT NULL DEFAULT '',
      -- CRANE or STRADDLE: what lifted it off the truck. Printed on the entry
      -- card alone, and deliberately on no register.
      handling      TEXT    NOT NULL DEFAULT '',
      truck_in      TEXT    NOT NULL DEFAULT '',
      driver_in     TEXT    NOT NULL DEFAULT '',
      seal_in       TEXT    NOT NULL DEFAULT '',
      card_in       INTEGER,
      truck_out     TEXT    NOT NULL DEFAULT '',
      driver_out    TEXT    NOT NULL DEFAULT '',
      seal_out      TEXT    NOT NULL DEFAULT '',
      card_out      INTEGER,
      -- The year each card serial counts within: the count restarts at 1 every
      -- January, so «0091» means nothing on its own. Stored rather than read
      -- back off the gate date, which the owner may correct afterwards.
      card_in_year  INTEGER,
      card_out_year INTEGER,
      -- Soft delete for a record that was a mistake. Never removed.
      deleted_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_containers_number ON containers (number);
    CREATE INDEX IF NOT EXISTS idx_containers_bill ON containers (bill) WHERE bill <> '';
    CREATE INDEX IF NOT EXISTS idx_containers_standing
      ON containers (zone, bay, stack, tier) WHERE zone IS NOT NULL;

    -- No unique index guards a slot: a 40 stored at its even bay covers two
    -- odd bays a 20 could also claim, and no index can see that overlap. The
    -- rules in src/shared/rules.ts stay the single authority — they run
    -- inside the write transaction of a single-process node:sqlite handle,
    -- so the read-then-write is atomic.

    CREATE TABLE IF NOT EXISTS movements (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id INTEGER NOT NULL REFERENCES containers (id),
      -- DROP is gravity, not a person: the descent of a container whose floor
      -- was lifted out from under it. Its note names the container that left.
      type         TEXT    NOT NULL CHECK (type IN ('IN', 'MOVE', 'DROP', 'OUT', 'EDIT', 'DELETE', 'RESTORE')),
      at           TEXT    NOT NULL,
      from_zone    TEXT, from_bay INTEGER, from_stack INTEGER, from_tier TEXT,
      to_zone      TEXT, to_bay   INTEGER, to_stack   INTEGER, to_tier   TEXT,
      note         TEXT    NOT NULL DEFAULT '',
      -- Who did it. NULL is the owner, who is not a row in users.
      user_id      INTEGER REFERENCES users (id)
    );

    CREATE INDEX IF NOT EXISTS idx_movements_container ON movements (container_id);
    CREATE INDEX IF NOT EXISTS idx_movements_at ON movements (at);

    PRAGMA user_version = 15;
  `);

  // v15: the register is rebuilt to run 1, 2, 3 … N with no hole in it. A
  // deletion under an older version of this program left the numbers after it
  // standing where they were, and the owner found that on the office machine:
  // «صار خطأ ب التسلسل … بسبب الحذف». The repair is not a one-time script but
  // the rule itself — it runs every time the file is opened, so a database
  // arriving from anywhere (an older machine, a restored backup, a copy) is
  // held to it. When the register is already whole this plans nothing and
  // writes nothing, which is the normal case on every start after the first.
  const repair = renumberPlan(db);
  if (repair.length > 0) {
    if (file !== ':memory:') {
      const backup = `${file}.pre-renumber-backup.db`;
      if (!existsSync(backup)) db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    }
    applyCardFixes(db, repair);
    console.log(`[db] card serials rebuilt: ${String(repair.length)} corrected`);
  }
}

/**
 * v11 → v12: give every card already printed the year its serial counted in,
 * and re-seat the two running counters as one counter per year.
 *
 * The year is computed in JavaScript, not in SQL: `strftime` would need the
 * Amman offset hard-coded, and this file is not the place to decide what
 * Jordan's clock was doing on a given night. Nothing is renumbered — a card
 * already in somebody's hands keeps the number printed on it.
 */
function backfillCardYears(db: DatabaseSync): void {
  const rows = db
    .prepare(
      `SELECT id, entered_at, exited_at, card_in, card_out FROM containers
        WHERE card_in IS NOT NULL OR card_out IS NOT NULL`,
    )
    .all() as Array<{
    id: number;
    entered_at: string;
    exited_at: string | null;
    card_in: number | null;
    card_out: number | null;
  }>;

  const stamp = db.prepare('UPDATE containers SET card_in_year = ?, card_out_year = ? WHERE id = ?');
  // The highest serial seen in each year, per direction — where that year's
  // counter has to resume so the office never issues the same card twice.
  const highest = new Map<string, number>();
  const note = (kind: 'in' | 'out', year: number, serial: number): void => {
    const key = `card_${kind}_next:${String(year)}`;
    highest.set(key, Math.max(highest.get(key) ?? 0, serial));
  };

  for (const row of rows) {
    const inYear = row.card_in === null ? null : ammanYear(row.entered_at);
    const outYear =
      row.card_out === null || row.exited_at === null ? null : ammanYear(row.exited_at);
    stamp.run(inYear, outYear, row.id);
    if (row.card_in !== null && inYear !== null) note('in', inYear, row.card_in);
    if (row.card_out !== null && outYear !== null) note('out', outYear, row.card_out);
  }

  // The settings table has ridden along since v1, but a file that somehow
  // lacks it must not take the whole upgrade down with it.
  const hasSettings =
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get() !==
    undefined;
  if (!hasSettings) return;

  db.exec("DELETE FROM settings WHERE key IN ('card_in_next', 'card_out_next')");
  const seed = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  );
  for (const [key, top] of highest) seed.run(key, String(top + 1));
}

/**
 * v9 → v10: the bill of lading column, and the tier CHECK widened for the
 * reserve third tier. A rebuild because a CHECK cannot be edited in place —
 * and NON-destructive: every row rides across, `bill` starting blank.
 */
function upgradeV9toV10(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE containers_v10 (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        number        TEXT    NOT NULL,
        number_valid  INTEGER NOT NULL,
        size          INTEGER NOT NULL CHECK (size IN (20, 40)),
        customer      TEXT    NOT NULL,
        notes         TEXT    NOT NULL DEFAULT '',
        entered_at    TEXT    NOT NULL,
        exited_at     TEXT,
        bill          TEXT    NOT NULL DEFAULT '',
        zone          TEXT    CHECK (zone IN ('A', 'B', 'C', 'D', 'E')),
        bay           INTEGER,
        stack         INTEGER,
        tier          TEXT    CHECK (tier IN ('A', 'B', 'C')),
        weight        TEXT    NOT NULL DEFAULT '',
        truck_in      TEXT    NOT NULL DEFAULT '',
        driver_in     TEXT    NOT NULL DEFAULT '',
        seal_in       TEXT    NOT NULL DEFAULT '',
        card_in       INTEGER,
        truck_out     TEXT    NOT NULL DEFAULT '',
        driver_out    TEXT    NOT NULL DEFAULT '',
        seal_out      TEXT    NOT NULL DEFAULT '',
        card_out      INTEGER,
        deleted_at    TEXT
      );
      INSERT INTO containers_v10
        (id, number, number_valid, size, customer, notes, entered_at, exited_at,
         zone, bay, stack, tier, weight, truck_in, driver_in, seal_in, card_in,
         truck_out, driver_out, seal_out, card_out, deleted_at)
      SELECT id, number, number_valid, size, customer, notes, entered_at, exited_at,
             zone, bay, stack, tier, weight, truck_in, driver_in, seal_in, card_in,
             truck_out, driver_out, seal_out, card_out, deleted_at
      FROM containers;
      DROP TABLE containers;
      ALTER TABLE containers_v10 RENAME TO containers;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * v10 → v11: the movements CHECK gains `DROP`, the descent a container makes
 * when the box under it is lifted away. Same rebuild dance as v10, same
 * promise — every recorded movement rides across untouched.
 */
function upgradeMovementsV11(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE movements_v11 (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id INTEGER NOT NULL REFERENCES containers (id),
        type         TEXT    NOT NULL CHECK (type IN ('IN', 'MOVE', 'DROP', 'OUT', 'EDIT', 'DELETE', 'RESTORE')),
        at           TEXT    NOT NULL,
        from_zone    TEXT, from_bay INTEGER, from_stack INTEGER, from_tier TEXT,
        to_zone      TEXT, to_bay   INTEGER, to_stack   INTEGER, to_tier   TEXT,
        note         TEXT    NOT NULL DEFAULT '',
        user_id      INTEGER REFERENCES users (id)
      );
      INSERT INTO movements_v11
        (id, container_id, type, at, from_zone, from_bay, from_stack, from_tier,
         to_zone, to_bay, to_stack, to_tier, note, user_id)
      SELECT id, container_id, type, at, from_zone, from_bay, from_stack, from_tier,
             to_zone, to_bay, to_stack, to_tier, note, user_id
      FROM movements;
      DROP TABLE movements;
      ALTER TABLE movements_v11 RENAME TO movements;
    `);
    db.exec('COMMIT');
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
