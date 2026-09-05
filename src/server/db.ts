import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ammanYear } from '../shared/dates';


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

  // v16: a move inside the yard is a printed card of its own now, so it needs
  // a serial — and one container is moved many times, which is why the number
  // lives on the MOVEMENT and not on the container. Two nullable columns, so
  // they go in place; every movement written before this reads as no card.
  if (tableSql('movements') !== undefined && !columnExists(db, 'movements', 'card')) {
    db.exec('ALTER TABLE movements ADD COLUMN card INTEGER');
    db.exec('ALTER TABLE movements ADD COLUMN card_year INTEGER');
  }

  // v17: an exit can be taken back. A gate is worked by a person at night
  // under a truck engine, so «قد يكون الخطأ وارد» — a container marked out by
  // mistake returns to its slot and its exit card is voided, and the log says
  // RETURN rather than pretending the departure never happened. A new
  // movement type means a wider CHECK, which SQLite cannot edit in place.
  const v16MovementsSql = tableSql('movements');
  if (v16MovementsSql !== undefined && !v16MovementsSql.includes("'RETURN'")) {
    upgradeMovementsV17(db);
  }

  // v21: the owner defines zones of his own, so the ground stops being a
  // closed list — the zone column loses its A…E CHECK and the LAYOUT (the
  // official plan plus his zones) becomes the one judge of what exists.
  // SQLite cannot edit a CHECK in place: the table is rebuilt, per the
  // house pattern above. The tier CHECK stays — three tiers, always.
  const v20ContainersSql = tableSql('containers');
  if (v20ContainersSql !== undefined && v20ContainersSql.includes("zone IN (")) {
    upgradeContainersV21(db);
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
      -- v26: '' | CRANE | STRADDLE. A non-empty machine marks a DRIVER
      -- account: the tablet lands on that machine's task queue and holds a
      -- shift-long session. No CHECK, like containers.handling — zod guards
      -- the wire.
      machine    TEXT    NOT NULL DEFAULT '',
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
      -- v25: «أسأل الموظف عند الإدخال» — is this bill a lone container or a
      -- manifest with more coming? The gate asks; the first container of a
      -- big bill would otherwise be indistinguishable from a single. NULL on
      -- records from before the question existed.
      bill_kind     TEXT    CHECK (bill_kind IN ('SINGLE', 'MANIFEST')),
      -- The exact official slot (1-A-03-01-A), present exactly while it
      -- stands in the yard. The bay's parity repeats the size on purpose:
      -- odd bay = 20, even bay = a 40 across the two odd bays around it.
      zone          TEXT,
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
      -- RETURN is an exit taken back: the container never left, so it stands
      -- again where it stood and its exit card is voided.
      type         TEXT    NOT NULL CHECK (type IN ('IN', 'MOVE', 'DROP', 'OUT', 'EDIT', 'DELETE', 'RESTORE', 'RETURN')),
      at           TEXT    NOT NULL,
      from_zone    TEXT, from_bay INTEGER, from_stack INTEGER, from_tier TEXT,
      to_zone      TEXT, to_bay   INTEGER, to_stack   INTEGER, to_tier   TEXT,
      note         TEXT    NOT NULL DEFAULT '',
      -- Who did it. NULL is the owner, who is not a row in users.
      user_id      INTEGER REFERENCES users (id),
      -- A MOVE is handed to the crane on paper, so it carries a serial of its
      -- own, counted per year like the two gate ledgers. Null on every other
      -- kind of movement — nothing else is printed.
      card         INTEGER,
      card_year    INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_movements_container ON movements (container_id);
    CREATE INDEX IF NOT EXISTS idx_movements_at ON movements (at);

    -- «هل لحرف هذا الزون تاريخ؟» — a question asked while composing the
    -- effective layout, which happens inside EVERY yard-write transaction
    -- (دخول، نقل، خروج، إلغاء خروج، تصريح). Unindexed it SCANS the whole
    -- movement history each time and a struck letter with no history never
    -- short-circuits: 200k movements measured 229ms per call — a third of a
    -- second added to every gate press. Partial (the columns are NULL on
    -- gate rows) and one per column, because an OR over two columns cannot
    -- use either index.
    CREATE INDEX IF NOT EXISTS idx_movements_from_zone
      ON movements (from_zone) WHERE from_zone IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_movements_to_zone
      ON movements (to_zone) WHERE to_zone IS NOT NULL;

    -- الناقلون: the trucking companies whose fleets serve the yard. The gate
    -- keeps typing the plate as free text — these tables sit BESIDE the gate
    -- records, matched by normalized plate, so nothing already written moves.
    CREATE TABLE IF NOT EXISTS carriers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      deleted_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_carriers_live_name
      ON carriers (name) WHERE deleted_at IS NULL;

    -- One registered truck of one carrier: the plate's ترميز (category
    -- prefix), its number, and the driver usually behind its wheel.
    CREATE TABLE IF NOT EXISTS trucks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier_id INTEGER NOT NULL REFERENCES carriers (id),
      code       TEXT    NOT NULL DEFAULT '',
      number     TEXT    NOT NULL,
      driver     TEXT    NOT NULL DEFAULT '',
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_trucks_carrier ON trucks (carrier_id);

    -- v19: تصريح تحميل وخروج داخلي — a numbered permit for one bill's
    -- containers, going out to موقع المقص. A ledger of its own, counted per
    -- year like the gate cards; its items pin the containers it listed and
    -- the truck assigned to each. Issuing one moves nothing on the ground.
    -- v21 pinned the yard the paper names, computed at issue time.
    CREATE TABLE IF NOT EXISTS permits (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      serial      INTEGER NOT NULL,
      serial_year INTEGER NOT NULL,
      bill        TEXT    NOT NULL,
      at          TEXT    NOT NULL,
      user_id     INTEGER REFERENCES users (id),
      yard        INTEGER NOT NULL DEFAULT 2,
      deleted_at  TEXT
    );

    -- v20: each line keeps the container's facts AS THE PAPER WAS ISSUED —
    -- number, entry-card serial, entry date. The stamped original in the
    -- drawer never changes, so its reprint must not either: a later renumber
    -- or correction of the container record leaves issued permits alone.
    CREATE TABLE IF NOT EXISTS permit_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      permit_id    INTEGER NOT NULL REFERENCES permits (id),
      container_id INTEGER NOT NULL REFERENCES containers (id),
      truck        TEXT    NOT NULL DEFAULT '',
      number       TEXT    NOT NULL DEFAULT '',
      card_in      INTEGER,
      card_in_year INTEGER,
      entered_at   TEXT    NOT NULL DEFAULT '',
      -- v23: «اريد وضع خانة للوزن ايضا» — الوزن كما كُتب لحظة الإصدار.
      weight       TEXT    NOT NULL DEFAULT '',
      -- v24: الفئة كانت تُقرأ حيّة من سجل الحاوية لأنها كانت لا تتغير أبداً.
      -- وقد صارت تُصحَّح («تصحيح الفئة»)، فلو بقيت حيّة لتغيّر سطر «عشرين /
      -- أربعين» في تصريح مختوم ومحفوظ. تُثبَّت هنا كأخواتها.
      size         INTEGER NOT NULL DEFAULT 20
    );

    CREATE INDEX IF NOT EXISTS idx_permit_items_permit ON permit_items (permit_id);

    -- v21: الزونات التي يعرّفها المالك بنفسه — في ساحاته 1 و3 أو بجانب
    -- المخطط الرسمي، الذي يبقى بيانات مثبّتة لا تُمسّ. شبكة بايات فردية
    -- وستاكات وثلاثة طوابق دائماً؛ والخانات المغلقة (closed، أزواج
    -- [باي، ستاك] بصيغة JSON) تمنع الوضع كما تفعل حوائط الساحة 2.
    CREATE TABLE IF NOT EXISTS custom_zones (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      yard       INTEGER NOT NULL,
      name       TEXT    NOT NULL,
      bays       INTEGER NOT NULL,
      stacks     INTEGER NOT NULL,
      closed     TEXT    NOT NULL DEFAULT '[]',
      -- Where the owner parked the zone on its yard's drawing — «بدي اقدر
      -- احرك الزون». Null = the composer lines it up by itself.
      x          REAL,
      y          REAL,
      deleted_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_zones_live_name
      ON custom_zones (name) WHERE deleted_at IS NULL;

    -- v22: صور الحاوية — «صور الحاوية من الواتساب بجانب الملاحظات». The
    -- bytes live HERE, in the database, so the backup and the restore carry
    -- the photos with everything else and no second machinery exists.
    CREATE TABLE IF NOT EXISTS photos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id INTEGER NOT NULL REFERENCES containers (id),
      mime         TEXT    NOT NULL,
      bytes        BLOB    NOT NULL,
      size         INTEGER NOT NULL,
      at           TEXT    NOT NULL,
      user_id      INTEGER REFERENCES users (id),
      deleted_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_photos_container ON photos (container_id);

    -- v22: محاسبة السائقين — «يكتب يدويا … نكتفي بالرقم». One row per haul
    -- (a container's IN or OUT with a named driver): the figure the owner
    -- writes, and the receipt stamp — who confirmed, and when.
    CREATE TABLE IF NOT EXISTS wages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      container_id INTEGER NOT NULL REFERENCES containers (id),
      direction    TEXT    NOT NULL CHECK (direction IN ('IN', 'OUT')),
      amount       REAL    NOT NULL CHECK (amount >= 0),
      paid_at      TEXT,
      paid_by      INTEGER REFERENCES users (id),
      at           TEXT    NOT NULL,
      user_id      INTEGER REFERENCES users (id),
      deleted_at   TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wages_live
      ON wages (container_id, direction) WHERE deleted_at IS NULL;

    -- v26: مهام الآليات — the WhatsApp photo group, replaced. A task is born
    -- the instant the gate acts (an IN on entry; an OUT on a تجهيز request
    -- or at the exit itself) and appears on the machine's tablet. Tasks are
    -- CLOSED, never deleted — no deleted_at on purpose: the queue is a work
    -- ledger, and history is the point.
    CREATE TABLE IF NOT EXISTS tasks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      kind         TEXT    NOT NULL CHECK (kind IN ('IN', 'OUT')),
      container_id INTEGER NOT NULL REFERENCES containers (id),
      machine      TEXT    NOT NULL CHECK (machine IN ('CRANE', 'STRADDLE')),
      urgent       INTEGER NOT NULL DEFAULT 0,
      status       TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DONE')),
      created_at   TEXT    NOT NULL,
      created_by   INTEGER REFERENCES users (id),
      done_at      TEXT,
      done_by      INTEGER REFERENCES users (id),
      -- '' for a driver's own «تم»; otherwise a close CODE (AUTO_EXIT,
      -- AUTO_RETURN, AUTO_DELETE) — the client owns the Arabic sentence.
      closed_note  TEXT    NOT NULL DEFAULT '',
      -- The slot at task birth: an exited container keeps no live position,
      -- and the driver must still be told which slot the box stood in.
      pos_zone     TEXT,
      pos_bay      INTEGER,
      pos_stack    INTEGER,
      pos_tier     TEXT,
      truck        TEXT    NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_queue ON tasks (machine, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_container ON tasks (container_id);

    -- v27: دفعات كشف الجمارك — the transfer sheet the directorate sends,
    -- read literally (deterministic file formats only, never OCR) and kept
    -- as the paper's own mirror. Rows carry NO arrival mark on purpose:
    -- whether a listed container has arrived is computed at read time by
    -- joining its normalized number against the yard book, so the statuses
    -- heal themselves through delete/restore/unexit and the gate's own
    -- transactions are never touched.
    CREATE TABLE IF NOT EXISTS batches (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      filename   TEXT    NOT NULL DEFAULT '',
      created_at TEXT    NOT NULL,
      created_by INTEGER REFERENCES users (id),
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS batch_rows (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES batches (id),
      seq      INTEGER,
      -- Normalized as the gate normalizes (iso6346), so equality joins hold.
      number   TEXT    NOT NULL,
      -- NULL passes the CHECK by SQL rule: a sheet size outside the yard's
      -- vocabulary (a real «45») keeps size NULL and lives in size_raw.
      size     INTEGER CHECK (size IN (20, 40)),
      size_raw TEXT    NOT NULL DEFAULT '',
      bill     TEXT    NOT NULL DEFAULT '',
      line_op  TEXT    NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_batch_rows_batch ON batch_rows (batch_id);
    CREATE INDEX IF NOT EXISTS idx_batch_rows_number ON batch_rows (number);

    PRAGMA user_version = 27;
  `);

  // v26 upgrade: drivers joined the staff. A users table from before the
  // machines gets the column in place; every existing account reads '' — an
  // office account, honestly. Purely additive: no row is rewritten.
  const userColumns = db
    .prepare('SELECT name FROM pragma_table_info(?)')
    .all('users') as unknown as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === 'machine')) {
    db.exec(`ALTER TABLE users ADD COLUMN machine TEXT NOT NULL DEFAULT ''`);
  }

  // v25 upgrade: the gate now asks whether a bill is a lone container or a
  // manifest. Old records keep NULL — unknown then, unknown honestly.
  const containerColumns = db
    .prepare('SELECT name FROM pragma_table_info(?)')
    .all('containers') as unknown as Array<{ name: string }>;
  if (!containerColumns.some((column) => column.name === 'bill_kind')) {
    db.exec(
      `ALTER TABLE containers ADD COLUMN bill_kind TEXT CHECK (bill_kind IN ('SINGLE', 'MANIFEST'))`,
    );
  }

  // v24 upgrade: a permit_items born before الفئة could be corrected reads it
  // live off the container. Pin what each stamped paper actually said, taken
  // from the container as it stands — which is still the truth for every
  // permit issued before the first correction.
  const permitSizeColumns = db
    .prepare('SELECT name FROM pragma_table_info(?)')
    .all('permit_items') as unknown as Array<{ name: string }>;
  if (!permitSizeColumns.some((column) => column.name === 'size')) {
    db.exec(`
      ALTER TABLE permit_items ADD COLUMN size INTEGER NOT NULL DEFAULT 20;
      UPDATE permit_items
         SET size = COALESCE(
           (SELECT k.size FROM containers k WHERE k.id = permit_items.container_id), 20);
    `);
  }

  // v21 upgrade: a permits table born before the owner's yards existed does
  // not name the yard on the paper — every permit it issued was yard 2.
  const permitColumns = db
    .prepare('SELECT name FROM pragma_table_info(?)')
    .all('permits') as unknown as Array<{ name: string }>;
  if (!permitColumns.some((column) => column.name === 'yard')) {
    db.exec('ALTER TABLE permits ADD COLUMN yard INTEGER NOT NULL DEFAULT 2');
  }

  // A custom_zones table born minutes before the position columns arrived
  // (a dev server reloading mid-edit does exactly this) is topped up.
  const zoneColumns = db
    .prepare('SELECT name FROM pragma_table_info(?)')
    .all('custom_zones') as unknown as Array<{ name: string }>;
  if (zoneColumns.length > 0 && !zoneColumns.some((column) => column.name === 'x')) {
    db.exec('ALTER TABLE custom_zones ADD COLUMN x REAL; ALTER TABLE custom_zones ADD COLUMN y REAL;');
  }

  // v20 upgrade: a permit_items table born under v19 lacks the snapshot
  // columns. Sniffing the table beats trusting the version stamp — and the
  // backfill reads the containers as they stand now, the closest thing to
  // «as issued» an old line still has.
  const permitItemColumns = db
    .prepare('SELECT name FROM pragma_table_info(?)')
    .all('permit_items') as unknown as Array<{ name: string }>;
  if (!permitItemColumns.some((column) => column.name === 'number')) {
    // One transaction: exec() commits statement by statement, so a process
    // dying between the ALTER and the backfill would leave the column
    // present, the sniff satisfied, and the backfill skipped forever.
    db.exec(`
      BEGIN;
      ALTER TABLE permit_items ADD COLUMN number TEXT NOT NULL DEFAULT '';
      ALTER TABLE permit_items ADD COLUMN card_in INTEGER;
      ALTER TABLE permit_items ADD COLUMN card_in_year INTEGER;
      ALTER TABLE permit_items ADD COLUMN entered_at TEXT NOT NULL DEFAULT '';
      UPDATE permit_items SET
        number       = COALESCE((SELECT k.number FROM containers k WHERE k.id = container_id), ''),
        card_in      = (SELECT k.card_in FROM containers k WHERE k.id = container_id),
        card_in_year = (SELECT k.card_in_year FROM containers k WHERE k.id = container_id),
        entered_at   = COALESCE((SELECT k.entered_at FROM containers k WHERE k.id = container_id), '');
      COMMIT;
    `);
  }

  // v23: the weight joined the snapshot — «اريد وضع خانة للوزن ايضا
  // واظهارها بالطباعة». Old lines backfill from the container as it stands
  // now, the closest thing to «as issued» they still have.
  if (!permitItemColumns.some((column) => column.name === 'weight')) {
    // ALTER and backfill in ONE transaction — see the v20 note above.
    db.exec(`
      BEGIN;
      ALTER TABLE permit_items ADD COLUMN weight TEXT NOT NULL DEFAULT '';
      UPDATE permit_items SET
        weight = COALESCE((SELECT k.weight FROM containers k WHERE k.id = container_id), '');
      COMMIT;
    `);
  }

  // v18: the fleet the owner dictated, planted exactly once — into a carriers
  // table that has never held a row. Counting rows rather than asking whether
  // the table existed makes the step self-healing: a process that died between
  // creating the tables and seeding them (a dev server reloading mid-edit did
  // precisely this) leaves empty tables, and the next open finishes the job.
  // Soft-deleted rows still count, so a fleet the owner later strikes out or
  // rearranges is never re-planted behind his back.
  const carriersEver = (
    db.prepare('SELECT COUNT(*) AS n FROM carriers').get() as { n: number }
  ).n;
  if (carriersEver === 0) seedFleet(db);

  // v15 rebuilt every register on every open to run 1, 2, 3 … N with no hole.
  // That repair is GONE, and its absence is the rule now: «ما بدي حدا يوخذ
  // مكانها خلص يضل يكمل». A hole is what a deletion leaves and what it should
  // leave — closing one moved the numbers of records that had nothing to do
  // with the mistake, so a card already printed and in a driver's hand stopped
  // matching the register it came from.
  //
  // Nothing replaces it. A serial is written once, at the gate, and no code
  // path rewrites one again — except a restore whose old number a live record
  // has since been given by the OLD rule, which is settled in the restore
  // route by moving that one record and nobody else.
}

/**
 * The two carriers the owner named and the fleet he dictated, list in hand:
 * «هذه السيارات لناقل بهاء ابو الربع … جميعها ترميزها 60»، والناقل الآخر
 * عادل أبو غليون تُوزَّع سياراته عليه من الشاشة. Data, not schema — but data
 * the owner spelled out row by row, so it ships inside the update and lands
 * on the office machine by itself. Runs once, on the open that creates the
 * tables; after that the screen is the only author.
 */
function seedFleet(db: DatabaseSync): void {
  const BAHAA: ReadonlyArray<readonly [string, string]> = [
    ['84785', 'عطالله علي'],
    ['93896', 'علي جميعان'],
    ['89096', 'ابراهيم عبدالله'],
    // 82463, not 82462: the owner first dictated 82462, the gate had carried
    // 82463 twenty-one times under the same driver's name, and asked which
    // was true he answered «82463 وهذه هو رقم السيارة».
    ['82463', 'محمد جمعه'],
    ['60233', 'محمد عبدالله'],
    ['80943', 'يزن ماهر'],
    ['59452', 'صالح ابو زايد'],
    ['75165', 'حمزة محمد'],
    ['45165', 'جمال عطالله'],
    ['61475', 'انور سالم'],
    ['81344', 'ايمن محمد'],
    ['64121', 'يحيى جمعة'],
    ['83493', 'غانم احمد'],
    ['71544', 'معاذ'],
    ['88893', 'محمد عيد'],
    ['61199', 'عبد ربه سليمان'],
    ['72415', 'شادي عطا الله'],
    ['84006', 'محمد احمد'],
    ['77765', 'جمعة سلامه'],
    ['97460', 'علاء ابراهيم'],
    ['75209', 'بشار فايز'],
    ['79556', 'خالد دهيبش'],
    ['75540', 'رائد حجاج'],
    ['83072', 'عدنان عبد الكريم'],
    ['55272', 'رثاد فواز'],
    ['73067', 'عدي فواز'],
    ['79463', 'عبد الله عيسى'],
  ];

  const addCarrier = db.prepare('INSERT INTO carriers (name) VALUES (?)');
  const addTruck = db.prepare(
    'INSERT INTO trucks (carrier_id, code, number, driver) VALUES (?, ?, ?, ?)',
  );
  const bahaa = Number(addCarrier.run('بهاء أبو الربع').lastInsertRowid);
  for (const [number, driver] of BAHAA) addTruck.run(bahaa, '60', number, driver);
  addCarrier.run('عادل أبو غليون');
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
/**
 * v16 → v17: the movements table gains the RETURN type. Same shape as the
 * v11 rebuild, and it must carry the card columns v16 added — a rebuild that
 * forgets a column silently drops every move card the yard has printed.
 */
function upgradeMovementsV17(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE movements_v17 (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id INTEGER NOT NULL REFERENCES containers (id),
        type         TEXT    NOT NULL CHECK (type IN ('IN', 'MOVE', 'DROP', 'OUT', 'EDIT', 'DELETE', 'RESTORE', 'RETURN')),
        at           TEXT    NOT NULL,
        from_zone    TEXT, from_bay INTEGER, from_stack INTEGER, from_tier TEXT,
        to_zone      TEXT, to_bay   INTEGER, to_stack   INTEGER, to_tier   TEXT,
        note         TEXT    NOT NULL DEFAULT '',
        user_id      INTEGER REFERENCES users (id),
        card         INTEGER,
        card_year    INTEGER
      );
      INSERT INTO movements_v17
        (id, container_id, type, at, from_zone, from_bay, from_stack, from_tier,
         to_zone, to_bay, to_stack, to_tier, note, user_id, card, card_year)
      SELECT id, container_id, type, at, from_zone, from_bay, from_stack, from_tier,
             to_zone, to_bay, to_stack, to_tier, note, user_id, card, card_year
      FROM movements;
      DROP TABLE movements;
      ALTER TABLE movements_v17 RENAME TO movements;
      CREATE INDEX IF NOT EXISTS idx_movements_container ON movements (container_id);
      CREATE INDEX IF NOT EXISTS idx_movements_at ON movements (at);
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
 * v21: rebuild `containers` without the zone CHECK. The owner's zones carry
 * letters the old list never heard of, and the layout — not the schema — is
 * the judge of the ground. Columns are named on both sides because an old
 * file's column ORDER differs from a fresh one's (upgrades append).
 */
function upgradeContainersV21(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE containers_v21 (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        number        TEXT    NOT NULL,
        number_valid  INTEGER NOT NULL,
        size          INTEGER NOT NULL CHECK (size IN (20, 40)),
        notes         TEXT    NOT NULL DEFAULT '',
        entered_at    TEXT    NOT NULL,
        exited_at     TEXT,
        bill          TEXT    NOT NULL DEFAULT '',
        zone          TEXT,
        bay           INTEGER,
        stack         INTEGER,
        tier          TEXT    CHECK (tier IN ('A', 'B', 'C')),
        weight        TEXT    NOT NULL DEFAULT '',
        handling      TEXT    NOT NULL DEFAULT '',
        truck_in      TEXT    NOT NULL DEFAULT '',
        driver_in     TEXT    NOT NULL DEFAULT '',
        seal_in       TEXT    NOT NULL DEFAULT '',
        card_in       INTEGER,
        truck_out     TEXT    NOT NULL DEFAULT '',
        driver_out    TEXT    NOT NULL DEFAULT '',
        seal_out      TEXT    NOT NULL DEFAULT '',
        card_out      INTEGER,
        card_in_year  INTEGER,
        card_out_year INTEGER,
        deleted_at    TEXT
      );
      INSERT INTO containers_v21
        (id, number, number_valid, size, notes, entered_at, exited_at, bill,
         zone, bay, stack, tier, weight, handling, truck_in, driver_in,
         seal_in, card_in, truck_out, driver_out, seal_out, card_out,
         card_in_year, card_out_year, deleted_at)
      SELECT id, number, number_valid, size, notes, entered_at, exited_at, bill,
             zone, bay, stack, tier, weight, handling, truck_in, driver_in,
             seal_in, card_in, truck_out, driver_out, seal_out, card_out,
             card_in_year, card_out_year, deleted_at
      FROM containers;
      DROP TABLE containers;
      ALTER TABLE containers_v21 RENAME TO containers;
      CREATE INDEX IF NOT EXISTS idx_containers_number ON containers (number);
      CREATE INDEX IF NOT EXISTS idx_containers_bill ON containers (bill) WHERE bill <> '';
      CREATE INDEX IF NOT EXISTS idx_containers_standing
        ON containers (zone, bay, stack, tier) WHERE zone IS NOT NULL;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

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
