import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
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
  migrate(db, file);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
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
      customer      TEXT    NOT NULL,
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
      -- The gate paperwork: weights, trucks, drivers, seals and card serials.
      -- A different seal on the way out means the door was opened inside.
      -- Two weights ride on the storage card: weight is the gross (القائم)
      -- and weight_net the net (الصافي). Free text — the scale ticket's own.
      weight        TEXT    NOT NULL DEFAULT '',
      weight_net    TEXT    NOT NULL DEFAULT '',
      truck_in      TEXT    NOT NULL DEFAULT '',
      driver_in     TEXT    NOT NULL DEFAULT '',
      seal_in       TEXT    NOT NULL DEFAULT '',
      card_in       INTEGER,
      truck_out     TEXT    NOT NULL DEFAULT '',
      driver_out    TEXT    NOT NULL DEFAULT '',
      seal_out      TEXT    NOT NULL DEFAULT '',
      card_out      INTEGER,
      -- مواد خطرة: this box carries dangerous goods. Drawn red everywhere and
      -- printed on both gate cards, so nobody has to remember which one it is.
      hazmat        INTEGER NOT NULL DEFAULT 0,
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

    PRAGMA user_version = 11;
  `);
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
