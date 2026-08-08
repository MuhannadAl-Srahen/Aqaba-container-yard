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
  /**
   * The containers table AS THE FILE ARRIVED, read once. Later steps rebuild
   * it, so a fresh read would answer about their own work rather than about
   * the version the file was at when it was opened.
   */
  const containersSql = (
    db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'containers'")
      .get() as { sql: string } | undefined
  )?.sql;
  /** Was this file already past v8 when it was opened? */
  const wasV8 = containersSql?.includes('seal_in') ?? false;

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
  if (movementsSql !== undefined && !movementsSql.includes("'RESTORE'")) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE movements_v4 (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          container_id INTEGER NOT NULL REFERENCES containers (id),
          type         TEXT    NOT NULL CHECK (type IN ('IN', 'MOVE', 'OUT', 'EDIT', 'DELETE', 'RESTORE')),
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

  // v6: a container's status and a block's state. Purely additive ALTERs
  // detected from the columns themselves — and they must run AFTER the v5/v4
  // rebuilds above, which copy `SELECT *` positionally: a column added first
  // would hand an old file more columns than the rebuilt table expects.
  //
  // "The column is missing" stopped meaning "this file is old" the day v7 and
  // v8 deliberately REMOVED these two columns: an up-to-date file was failing
  // the same test an ancient one fails, so every restart grew the phantom
  // column back. Both steps are now also gated on the file being old enough
  // to want them. (A live yard file had collected both before this was found.)
  if (hasContainers && !wasV8) {
    const columns = db.prepare('PRAGMA table_info(containers)').all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === 'status')) {
      db.exec(`
        ALTER TABLE containers ADD COLUMN status TEXT NOT NULL DEFAULT 'NORMAL'
          CHECK (status IN ('NORMAL', 'DAMAGED', 'HOLD', 'REPAIR', 'INSPECT'))
      `);
    }
  }
  if (blocksSql !== undefined && !blocksSql.includes('places_per_tier')) {
    const columns = db.prepare('PRAGMA table_info(blocks)').all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === 'state')) {
      db.exec(`
        ALTER TABLE blocks ADD COLUMN state TEXT NOT NULL DEFAULT 'NORMAL'
          CHECK (state IN ('NORMAL', 'MAINTENANCE', 'RESERVED', 'CLOSED'))
      `);
    }
  }

  // v7: a location became a basket. The exact (col, tier) inside a slot is
  // gone — the yard never tracked it and never will — and a location now
  // holds `places_per_tier × tiers` twenty-foot places instead of exactly one
  // container. Location states go with it: the ground does not break.
  //
  // Three rebuilds keyed on a NEW token, after the ALTERs above for the
  // reason spelled out there.
  if (blocksSql !== undefined && !blocksSql.includes('places_per_tier')) {
    upgradeV6toV7(db);
  }

  // v8: the yard got employees. Every movement now names who did it, the
  // gate records the seal both ways, and two columns leave for good — cargo
  // (every container here is laden) and status (conditions live in the notes
  // now, the administrative hold included). The containers rebuild must come
  // AFTER v7's, and the additive ALTER on movements after v7 rebuilt it.
  if (containersSql !== undefined && !wasV8) upgradeV7toV8(db);

  // Sweep up after the bug above: a file that restarted between v8 and this
  // fix carries a status and a state column nothing writes. Dropping them is
  // safe (neither is indexed) and the check costs one PRAGMA on startup.
  dropPhantomColumns(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- The gate staff. The owner is NOT a row here — the owner is the site
    -- password in settings, and carries every permission by definition.
    -- Soft delete, like blocks: last year's register still names whoever
    -- signed it, long after they stopped working here.
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

    -- The yard's columns: one letter each, a run of locations down the
    -- column, placed and rotated freely. size 0 = mixed (a location takes
    -- either container size). A location holds places_per_tier × tiers
    -- twenty-foot places. Soft delete keeps names resolvable for old history.
    CREATE TABLE IF NOT EXISTS blocks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      size            INTEGER NOT NULL CHECK (size IN (0, 20, 40)),
      rows            INTEGER NOT NULL,
      places_per_tier INTEGER NOT NULL CHECK (places_per_tier >= 1),
      tiers           INTEGER NOT NULL CHECK (tiers >= 1),
      x               REAL    NOT NULL,
      y               REAL    NOT NULL,
      angle           REAL    NOT NULL DEFAULT 0,
      deleted_at      TEXT
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
      -- Free text: the condition it arrived in, a customs hold, anything the
      -- crew needs the next person to read. It replaced the fixed states.
      notes         TEXT    NOT NULL DEFAULT '',
      entered_at    TEXT    NOT NULL,
      exited_at     TEXT,
      -- The location it stands in — present exactly while it is in the yard.
      block_id      INTEGER REFERENCES blocks (id),
      row           INTEGER,
      -- The gate paperwork: weights, trucks, drivers, seals and card serials.
      -- A different seal on the way out means the door was opened inside.
      weight        TEXT    NOT NULL DEFAULT '',
      truck_in      TEXT    NOT NULL DEFAULT '',
      driver_in     TEXT    NOT NULL DEFAULT '',
      seal_in       TEXT    NOT NULL DEFAULT '',
      card_in       INTEGER,
      truck_out     TEXT    NOT NULL DEFAULT '',
      driver_out    TEXT    NOT NULL DEFAULT '',
      seal_out      TEXT    NOT NULL DEFAULT '',
      card_out      INTEGER,
      -- Soft delete for a record that was a mistake. Never removed.
      deleted_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_containers_number ON containers (number);
    CREATE INDEX IF NOT EXISTS idx_containers_standing
      ON containers (block_id, row) WHERE block_id IS NOT NULL;

    -- No unique index guards a location any more: its limit is a SUM of
    -- places, not a key, and no index can express that. The rule in
    -- src/shared/rules.ts stays the single authority — it runs inside the
    -- write transaction of a single-process node:sqlite handle, so the
    -- read-then-write is atomic. Duplicating it into a trigger would give
    -- the yard two rules that could drift apart.

    CREATE TABLE IF NOT EXISTS movements (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id INTEGER NOT NULL REFERENCES containers (id),
      type         TEXT    NOT NULL CHECK (type IN ('IN', 'MOVE', 'OUT', 'EDIT', 'DELETE', 'RESTORE')),
      at           TEXT    NOT NULL,
      from_block   INTEGER, from_row INTEGER,
      to_block     INTEGER, to_row   INTEGER,
      note         TEXT    NOT NULL DEFAULT '',
      -- Who did it. NULL is the owner, who is not a row in users.
      user_id      INTEGER REFERENCES users (id)
    );

    CREATE INDEX IF NOT EXISTS idx_movements_container ON movements (container_id);
    CREATE INDEX IF NOT EXISTS idx_movements_at ON movements (at);

    PRAGMA user_version = 8;
  `);
}

/**
 * The two columns v7 and v8 removed, grown back by a migration step whose
 * "is this file old?" test they had quietly invalidated. Nothing reads them,
 * but a schema that drifts is a schema nobody can reason about — and the next
 * `INSERT ... SELECT *` rebuild would copy the drift into the new table.
 */
function dropPhantomColumns(db: DatabaseSync): void {
  const has = (table: string, column: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
      (c) => c.name === column,
    );

  if (has('containers', 'seal_in') && has('containers', 'status')) {
    db.exec('ALTER TABLE containers DROP COLUMN status');
  }
  if (has('blocks', 'places_per_tier') && has('blocks', 'state')) {
    db.exec('ALTER TABLE blocks DROP COLUMN state');
  }
}

/**
 * Employees arrive, and two columns leave. `cargo` goes because every
 * container this yard receives is laden, and `status` because the owner moved
 * every condition — dents, an opened lock, a customs hold — into the notes,
 * where the staff write what they actually see.
 */
function upgradeV7toV8(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      -- The shared DDL below creates this too, but the ALTER at the end of
      -- this upgrade points at it, so it has to exist first.
      CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        pin_hash   TEXT    NOT NULL,
        perms      TEXT    NOT NULL DEFAULT '',
        deleted_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_live_name
        ON users (name) WHERE deleted_at IS NULL;

      CREATE TABLE containers_v8 (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        number        TEXT    NOT NULL,
        number_valid  INTEGER NOT NULL,
        size          INTEGER NOT NULL CHECK (size IN (20, 40)),
        customer      TEXT    NOT NULL,
        notes         TEXT    NOT NULL DEFAULT '',
        entered_at    TEXT    NOT NULL,
        exited_at     TEXT,
        block_id      INTEGER REFERENCES blocks (id),
        row           INTEGER,
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
      INSERT INTO containers_v8
        (id, number, number_valid, size, customer, notes, entered_at, exited_at,
         block_id, row, weight, truck_in, driver_in, card_in, truck_out, driver_out,
         card_out, deleted_at)
      SELECT id, number, number_valid, size, customer, notes, entered_at, exited_at,
             block_id, row, weight, truck_in, driver_in, card_in, truck_out, driver_out,
             card_out, deleted_at
      FROM containers;
      DROP TABLE containers;
      ALTER TABLE containers_v8 RENAME TO containers;

      CREATE INDEX IF NOT EXISTS idx_containers_number ON containers (number);
      CREATE INDEX IF NOT EXISTS idx_containers_standing
        ON containers (block_id, row) WHERE block_id IS NOT NULL;

      ALTER TABLE movements ADD COLUMN user_id INTEGER REFERENCES users (id);
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
 * Locations become baskets. Every old slot `(row, col)` of a column collapses
 * onto its row: the two lines merge, and what used to be one container per
 * `(row, col, tier)` becomes a count of places in `(block, row)`.
 *
 * The capacity that cannot overflow is the old worst case — every one of the
 * `cols` lines holding a 40 on each of the two tiers — so `places_per_tier`
 * is `cols * 2` and `tiers` is 2. Nothing standing is ever pushed out.
 *
 * The panel geometry changed shape completely (a column is now narrow and
 * tall), so the old x/y would leave the yard overlapping itself. Live columns
 * are re-laid left to right; the owner drags them into place once.
 */
function upgradeV6toV7(db: DatabaseSync): void {
  /** Frozen at v7: BLOCK_PAD * 2 + CELL_W, plus a margin. */
  const columnPitch = 168;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE blocks_v7 (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        size            INTEGER NOT NULL CHECK (size IN (0, 20, 40)),
        rows            INTEGER NOT NULL,
        places_per_tier INTEGER NOT NULL CHECK (places_per_tier >= 1),
        tiers           INTEGER NOT NULL CHECK (tiers >= 1),
        x               REAL    NOT NULL,
        y               REAL    NOT NULL,
        angle           REAL    NOT NULL DEFAULT 0,
        deleted_at      TEXT
      );
      INSERT INTO blocks_v7
        (id, name, size, rows, places_per_tier, tiers, x, y, angle, deleted_at)
      SELECT id, name, size, rows, MAX(cols, 1) * 2, 2, x, y, 0, deleted_at
      FROM blocks;
      DROP TABLE blocks;
      ALTER TABLE blocks_v7 RENAME TO blocks;

      CREATE TABLE containers_v7 (
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
        weight        TEXT    NOT NULL DEFAULT '',
        truck_in      TEXT    NOT NULL DEFAULT '',
        driver_in     TEXT    NOT NULL DEFAULT '',
        card_in       INTEGER,
        truck_out     TEXT    NOT NULL DEFAULT '',
        driver_out    TEXT    NOT NULL DEFAULT '',
        card_out      INTEGER,
        status        TEXT    NOT NULL DEFAULT 'NORMAL'
          CHECK (status IN ('NORMAL', 'DAMAGED', 'HOLD', 'REPAIR', 'INSPECT')),
        deleted_at    TEXT
      );
      INSERT INTO containers_v7
        (id, number, number_valid, size, customer, cargo, notes, entered_at, exited_at,
         block_id, row, weight, truck_in, driver_in, card_in, truck_out, driver_out,
         card_out, status, deleted_at)
      SELECT id, number, number_valid, size, customer, cargo, notes, entered_at, exited_at,
             block_id, row, weight, truck_in, driver_in, card_in, truck_out, driver_out,
             card_out, status, deleted_at
      FROM containers;
      DROP TABLE containers;
      ALTER TABLE containers_v7 RENAME TO containers;

      CREATE TABLE movements_v7 (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id INTEGER NOT NULL REFERENCES containers (id),
        type         TEXT    NOT NULL CHECK (type IN ('IN', 'MOVE', 'OUT', 'EDIT', 'DELETE', 'RESTORE')),
        at           TEXT    NOT NULL,
        from_block   INTEGER, from_row INTEGER,
        to_block     INTEGER, to_row   INTEGER,
        note         TEXT    NOT NULL DEFAULT ''
      );
      INSERT INTO movements_v7
        (id, container_id, type, at, from_block, from_row, to_block, to_row, note)
      SELECT id, container_id, type, at, from_block, from_row, to_block, to_row, note
      FROM movements;
      DROP TABLE movements;
      ALTER TABLE movements_v7 RENAME TO movements;

      DROP TABLE IF EXISTS slot_states;
    `);

    const live = db
      .prepare('SELECT id FROM blocks WHERE deleted_at IS NULL ORDER BY id')
      .all() as Array<{ id: number }>;
    const place = db.prepare('UPDATE blocks SET x = ?, y = 0 WHERE id = ?');
    live.forEach((block, index) => {
      place.run(index * columnPitch, block.id);
    });

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
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
      // The v2 panel metrics, frozen here on purpose: a migration must lay
      // the old yard out the way the old map drew it, whatever the shared
      // geometry has become since. v7 re-lays these columns anyway.
      const frameWidth = (cols: number): number => 14 * 2 + cols * (60 + 7) - 7 + 26;
      const frameHeight = (rows: number, cellH: number): number =>
        40 + 20 + rows * (cellH + 7) - 7 + 14;
      const width20 = frameWidth(yard.twenty_cols);
      const width40 = frameWidth(yard.forty_cols);
      const width = Math.max(width20, width40);
      const layout = [
        {
          name: 'منطقة 20',
          size: 20,
          rows: yard.twenty_rows,
          cols: yard.twenty_cols,
          x: width - width20,
          y: 0,
        },
        {
          name: 'منطقة 40',
          size: 40,
          rows: yard.forty_rows,
          cols: yard.forty_cols,
          x: width - width40,
          y: frameHeight(yard.twenty_rows, 34) + 30,
        },
      ];
      const insert = db.prepare(
        'INSERT INTO blocks (name, size, rows, cols, x, y, angle) VALUES (?, ?, ?, ?, ?, ?, 0)',
      );
      for (const block of layout) {
        const result = insert.run(
          block.name,
          block.size,
          block.rows,
          block.cols,
          block.x,
          block.y,
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
