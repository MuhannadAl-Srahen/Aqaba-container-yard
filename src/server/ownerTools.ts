import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ErrorCode, Position, Size, Zone } from '../shared/types';
import { TIERS } from '../shared/types';
import { ASEZA } from '../shared/asezaLayout';
import { ammanYear } from '../shared/dates';
import { bayLabel, baySpan } from '../shared/address';
import { canPlace, type Standing } from '../shared/rules';
import { checkNumber } from '../shared/iso6346';
import { databaseFile, getSetting, openDatabase, setSetting, snapshot, transaction } from './db';
import { hashSecret, verifySecret } from './auth';
import * as store from './store';

/**
 * The owner's training tools, all in one file on purpose.
 *
 * The staff are learning the system on the live server, so the owner needs to
 * be able to fill the yard with believable practice data, clear what they did
 * with it, and put a real backup back if he clears the wrong thing. These are
 * for the training period — «حاليا بس حاليا» — and deleting this file plus its
 * one registration line in app.ts removes every one of them.
 *
 * Everything here is owner-only, and everything destructive takes a snapshot
 * of the live database before it touches anything.
 */

/** The dedicated word the owner sets for the wipe — never his login password. */
const WIPE_KEY = 'wipe_password';
/** A restore upload is a whole database; the global 1 MiB body cap will not do. */
const UPLOAD_LIMIT = 256 * 1024 * 1024;

export interface OwnerToolsDeps {
  readonly requireOwner: (request: FastifyRequest) => void;
  readonly refuse: (
    status: number,
    code: ErrorCode,
    details?: Record<string, string | number>,
  ) => never;
}

const passwordSchema = z.object({ password: z.string().min(4).max(200) });

export function registerOwnerTools(
  app: FastifyInstance,
  db: DatabaseSync,
  deps: OwnerToolsDeps,
): void {
  const { requireOwner, refuse } = deps;

  /** These tools rewrite the file itself, so an in-memory yard has no business here. */
  const liveFile = (): string => {
    const file = databaseFile(db);
    if (file === '') refuse(409, 'NOT_SETUP');
    return file;
  };

  const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const result = schema.safeParse(body);
    if (!result.success) refuse(400, 'VALIDATION');
    if (!result.success) throw new Error('unreachable');
    return result.data;
  };

  app.get('/api/owner/tools', (request) => {
    requireOwner(request);
    return { wipePasswordSet: getSetting(db, WIPE_KEY) !== null };
  });

  /**
   * Set or change the wipe word. Owner-only is the whole guard: he is already
   * signed in as himself, and the word exists to stop a slip of the hand, not
   * to stop him.
   */
  app.post('/api/owner/wipe-password', (request) => {
    requireOwner(request);
    const body = parse(passwordSchema, request.body);
    setSetting(db, WIPE_KEY, hashSecret(body.password));
    return { ok: true };
  });

  /**
   * Clear the practice data. The containers, their movements and the card
   * serials go; the staff, their PINs and the owner's password stay, because
   * the point is to reset the exercise, not the office.
   */
  app.post('/api/owner/wipe', (request) => {
    requireOwner(request);
    const body = parse(passwordSchema, request.body);
    liveFile();

    const stored = getSetting(db, WIPE_KEY);
    if (stored === null) refuse(409, 'NOT_SETUP');
    if (!verifySecret(stored, body.password)) refuse(403, 'BAD_PASSWORD');

    const kept = snapshot(db, 'before-wipe');
    const count = (table: string): number =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

    const cleared = transaction(db, () => {
      const containers = count('containers');
      const movements = count('movements');
      // The permits list containers, so the practice permits go with the
      // practice containers — a permit book naming vanished boxes is noise.
      db.exec('DELETE FROM permit_items');
      db.exec('DELETE FROM permits');
      db.exec('DELETE FROM movements');
      db.exec('DELETE FROM containers');
      // One counter per year now, so the wipe clears the whole family.
      db.exec("DELETE FROM settings WHERE key LIKE 'card\\_in\\_next%' ESCAPE '\\'");
      db.exec("DELETE FROM settings WHERE key LIKE 'card\\_out\\_next%' ESCAPE '\\'");
      db.exec(
        "DELETE FROM sqlite_sequence WHERE name IN ('containers', 'movements', 'permits', 'permit_items')",
      );
      // Counted back AFTER the delete, from the table itself. The screen says
      // what actually went, so «it did not delete anything» is a claim either
      // the number confirms or contradicts, rather than an impression.
      return { containers, movements, left: count('containers') };
    });
    return { ok: true, ...cleared, backup: path.basename(kept) };
  });

  /** Fill the yard with believable practice data. */
  app.post('/api/owner/seed', (request) => {
    requireOwner(request);
    return transaction(db, () => seedDemoYard(db));
  });

  /**
   * Put a backup back. The app holds ONE database handle for its whole life
   * and nothing can hand it another, so the file on disk is never swapped —
   * the uploaded database is opened alongside and its rows are copied across
   * into the live one, inside a single transaction.
   */
  app.post(
    '/api/owner/restore',
    { bodyLimit: UPLOAD_LIMIT },
    (request): { ok: boolean; backup: string } & RestoreCounts => {
      requireOwner(request);
      const file = liveFile();
      const bytes: unknown = request.body;
      if (!Buffer.isBuffer(bytes) || bytes.length < 512) refuse(400, 'BAD_BACKUP');
      if (!Buffer.isBuffer(bytes)) throw new Error('unreachable');
      // Every SQLite file on earth starts with the same sixteen bytes.
      if (bytes.subarray(0, 15).toString('utf8') !== 'SQLite format 3') refuse(400, 'BAD_BACKUP');

      const scratch = path.join(path.dirname(file), 'backups', `.restore-${String(Date.now())}.db`);
      // A fresh install has never taken a snapshot, so backups/ may not
      // exist yet — the very first thing the owner does may be a restore.
      mkdirSync(path.dirname(scratch), { recursive: true });
      writeFileSync(scratch, bytes);
      let source: DatabaseSync | null = null;
      try {
        // Look before migrating. The ladder WIPES anything older than v9 by
        // design, so running it on the upload would hand back an empty yard
        // and call it a success.
        const peek = new DatabaseSync(scratch);
        const containersSql = (
          peek
            .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'containers'")
            .get() as { sql: string } | undefined
        )?.sql;
        peek.close();
        if (containersSql === undefined || !containersSql.includes('stack')) {
          refuse(409, 'BAD_BACKUP');
        }

        // Now it is safe to bring the copy up to today's schema, so a backup
        // taken before an update still restores into the current one.
        source = openDatabase(scratch);
        const kept = snapshot(db, 'before-restore');
        const counts = copyAcross(db, source);
        return { ok: true, ...counts, backup: path.basename(kept) };
      } finally {
        source?.close();
        rmSync(scratch, { force: true });
        rmSync(`${scratch}-wal`, { force: true });
        rmSync(`${scratch}-shm`, { force: true });
      }
    },
  );
}

/** What the restore answers with, so the screen can prove nothing was lost. */
interface RestoreCounts {
  containers: number;
  movements: number;
  users: number;
  carriers: number;
  trucks: number;
  permits: number;
  zones: number;
}

/**
 * Copy EVERY table from a restored database into the live one — the tables
 * enumerated from the two files themselves, never from a list written by
 * hand. A hand-written list is a promise that rots: it named four tables the
 * year it was written, so when the carriers and their trucks arrived, a
 * restore silently dropped the whole fleet while claiming success — «تأكد من
 * موضوع النسخ الاحتياطي لانه لا ينسخ كل شي». The uploaded copy has already
 * been brought up to today's schema, so both sides hold the same tables; the
 * intersection is taken anyway, and only sanely-named tables pass, because
 * this file arrived over the wire.
 */
function copyAcross(db: DatabaseSync, source: DatabaseSync): RestoreCounts {
  const tablesOf = (handle: DatabaseSync): Array<{ name: string; sql: string }> =>
    handle
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as unknown as Array<{ name: string; sql: string }>;

  const liveTables = new Set(tablesOf(db).map((table) => table.name));
  const tables = tablesOf(source)
    .filter(({ name }) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && liveTables.has(name))
    .sort((a, b) => (a.name < b.name ? -1 : 1));

  const copied = new Map<string, number>();

  // Foreign keys are switched off around the swap: for a moment the movements
  // are gone while their containers are not, and neither table can be emptied
  // first without the other complaining. PRAGMA is a no-op inside a
  // transaction, hence outside.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    transaction(db, () => {
      // The owner asked for the whole snapshot back, staff and passwords
      // included — with ONE exception. The cookie secret stays as it is: an
      // old one would invalidate every signed-in session the instant it
      // landed, including the owner's own, mid-request.
      const cookieSecret = getSetting(db, 'cookie_secret');

      for (const { name } of tables) db.exec(`DELETE FROM ${name}`);
      for (const { name } of tables) {
        const rows = source
          .prepare(`SELECT * FROM ${name}`)
          .all() as unknown as Array<Record<string, unknown>>;
        insertAll(db, name, rows);
        copied.set(name, rows.length);
      }
      if (cookieSecret !== null) setSetting(db, 'cookie_secret', cookieSecret);

      // A snapshot comes back exactly as it was written. Holes in a year's
      // card numbers are LEGAL now — «ما بدي حدا يوخذ مكانها خلص يضل يكمل» —
      // and repairing them here would move numbers already printed on paper
      // that is filed beside this very backup.

      // AUTOINCREMENT reads its next id from here, not from the table, so
      // without this the first new row would collide with a restored one —
      // for every AUTOINCREMENT table that came across, not a chosen few.
      db.exec('DELETE FROM sqlite_sequence');
      for (const { name, sql } of tables) {
        if (!sql.includes('AUTOINCREMENT')) continue;
        const max = (
          db.prepare(`SELECT MAX(id) AS top FROM ${name}`).get() as { top: number | null }
        ).top;
        if (max !== null) {
          db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(name, max);
        }
      }
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return {
    containers: copied.get('containers') ?? 0,
    movements: copied.get('movements') ?? 0,
    users: copied.get('users') ?? 0,
    carriers: copied.get('carriers') ?? 0,
    trucks: copied.get('trucks') ?? 0,
    permits: copied.get('permits') ?? 0,
    zones: copied.get('custom_zones') ?? 0,
  };
}

function insertAll(
  db: DatabaseSync,
  table: string,
  rows: ReadonlyArray<Record<string, unknown>>,
): void {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0] ?? {});
  if (columns.length === 0) return;
  const statement = db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  );
  for (const row of rows) {
    statement.run(...columns.map((column) => (row[column] ?? null) as null));
  }
}

/* ── demo data ─────────────────────────────────────────────────────────── */

/** A seeded generator, so a demo yard is reproducible and testable. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const DRIVERS = ['أبو أحمد', 'محمد العلي', 'خالد الرشيد', 'أبو يوسف', 'سامي الحاج'];
const NOTES = ['', '', '', 'الباب مبعوج قليلاً', 'عليها حجز جمركي', 'القفل بحاجة إلى تبديل'];

/** A container number with a correct ISO 6346 check digit. */
function demoNumber(rnd: () => number, index: number): string {
  const owners = ['TGHU', 'MSCU', 'CMAU', 'HLXU', 'TCLU', 'ARKU'];
  const prefix = owners[Math.floor(rnd() * owners.length)] ?? 'TGHU';
  const serial = String(100_000 + ((index * 7919 + Math.floor(rnd() * 90_000)) % 899_999));
  const probe = checkNumber(`${prefix}${serial}0`);
  return `${prefix}${serial}${String(probe.expectedDigit ?? 0)}`;
}

/** A free, legal slot for this size, or null if the search gives up. */
function pickSlot(standing: readonly Standing[], size: Size, rnd: () => number): Position | null {
  const zones = ASEZA.zones;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const zone = zones[Math.floor(rnd() * zones.length)];
    if (zone === undefined) continue;
    const bay = zone.bays[Math.floor(rnd() * zone.bays.length)];
    if (bay === undefined) continue;
    const stacks = zone.stacks[String(bay)] ?? [];
    const stack = stacks[Math.floor(rnd() * stacks.length)];
    if (stack === undefined) continue;
    // Ground first: a demo yard that stands three high everywhere looks wrong.
    const tier = TIERS[rnd() < 0.75 ? 0 : 1] ?? 'A';

    if (size === 20) {
      const spot = { zone: zone.zone, bay, stack, tier };
      if (canPlace(ASEZA, standing, 20, spot) === null) return spot;
      continue;
    }
    // A 40 is addressed by the even bay between two odd ones.
    if (!zone.bays.includes(bay + 2)) continue;
    const spot = { zone: zone.zone, bay: bay + 1, stack, tier };
    if (canPlace(ASEZA, standing, 40, spot) === null) return spot;
  }
  return null;
}

/**
 * A yard that looks like a working month: containers spread over the zones,
 * some stacked, a handful of bills gathering groups, a few loads of dangerous
 * goods, and a dozen that have already come and gone so the exit register and
 * the dwell columns have something to say. Entry and exit movements carry the
 * SAME timestamps as the containers, so the daily report and the operations
 * log agree with the cards.
 */
export function seedDemoYard(db: DatabaseSync): {
  added: number;
  departed: number;
  fullBay: string | null;
} {
  const rnd = generator(20_260_811);
  const standing: Standing[] = store.listStanding(db);
  const bills = ['3210', '4187', '5502', '6741', '7130'];
  const day = 86_400_000;
  const now = Date.now();

  // One bay is filled to the brim on purpose, so the owner can see what a
  // full bay looks like on the map and in the sheet without waiting for the
  // yard to fill up on its own. All three tiers of it, ground to top.
  const target = fillableBay(standing);
  const packed: Position[] = [];
  if (target !== null) {
    for (const tier of TIERS) {
      for (const stack of target.stacks) {
        packed.push({ zone: target.zone, bay: target.bay, stack, tier });
      }
    }
  }

  let added = 0;
  let departed = 0;
  for (let index = 0; index < 45 + packed.length; index += 1) {
    // The packed bay goes in first, ground tier before second, so each one
    // lands on the box below it.
    const forced = packed[index];
    const size: Size = forced !== undefined ? 20 : rnd() < 0.35 ? 40 : 20;
    const slot = forced ?? pickSlot(standing, size, rnd);
    if (slot === null) continue;

    // Spread over the last three weeks, at working hours rather than midnight.
    const enteredAt = new Date(
      now - Math.floor(rnd() * 21) * day - Math.floor(rnd() * 11 + 6) * 3_600_000,
    ).toISOString();
    // Nothing leaves the packed bay — it has to still be full when he looks.
    const leaves = forced === undefined && rnd() < 0.27;
    const number = demoNumber(rnd, index);
    const seal = `JO${String(10_000 + Math.floor(rnd() * 89_999))}`;
    const gross = 20_000 + Math.floor(rnd() * 12_000);

    const id = store.insertContainer(db, {
      number,
      numberValid: checkNumber(number).valid,
      billKind: null,
      size,
      // The mandatory fields are all filled: a half-filled example teaches the
      // wrong habit at the gate.
      bill: bills[Math.floor(rnd() * bills.length)] ?? '3210',
      notes: NOTES[Math.floor(rnd() * NOTES.length)] ?? '',
      position: slot,
      at: enteredAt,
      weight: String(gross),
      handling: rnd() < 0.5 ? 'CRANE' : 'STRADDLE',
      truckIn: String(100 + Math.floor(rnd() * 899)),
      driverIn: DRIVERS[Math.floor(rnd() * DRIVERS.length)] ?? DRIVERS[0] ?? '',
      sealIn: seal,
      cardIn: store.nextCardNumber(db, 'in', ammanYear(enteredAt)),
      cardInYear: ammanYear(enteredAt),
    });
    store.recordMovement(db, id, 'IN', enteredAt, null, slot, '', null);
    added += 1;

    if (leaves) {
      // Out again after a day or two — long enough for the dwell to read.
      const exitedAt = new Date(
        Math.min(Date.parse(enteredAt) + (1 + Math.floor(rnd() * 9)) * day, now - 3_600_000),
      ).toISOString();
      store.markExited(db, id, exitedAt, {
        truck: String(100 + Math.floor(rnd() * 899)),
        driver: DRIVERS[Math.floor(rnd() * DRIVERS.length)] ?? DRIVERS[0] ?? '',
        cardOut: store.nextCardNumber(db, 'out', ammanYear(exitedAt)),
        cardOutYear: ammanYear(exitedAt),
      });
      store.recordMovement(db, id, 'OUT', exitedAt, slot, null, '', null);
      departed += 1;
      continue;
    }
    // Only what is still standing can hold ground for the next one.
    standing.push({ id, number, size, position: slot });
  }
  // The examples are written in a scattered order over three weeks, so their
  // serials read in the order they were ISSUED rather than by date — which is
  // exactly how the real registers read, now that a serial is never re-seated.
  return {
    added,
    departed,
    fullBay: target === null ? null : bayLabel(target.zone, target.bay),
  };
}

/**
 * A bay with nothing in it at all, small enough to fill without swallowing
 * the whole demo. Empty matters: a half-used bay would leave the packed one
 * looking like an accident rather than a full bay.
 */
function fillableBay(
  standing: readonly Standing[],
): { zone: Zone; bay: number; stacks: readonly number[] } | null {
  const busy = new Set<string>();
  for (const container of standing) {
    for (const oddBay of baySpan(container.position.bay)) {
      busy.add(`${container.position.zone}|${String(oddBay)}`);
    }
  }
  for (const zone of ASEZA.zones) {
    for (const bay of zone.bays) {
      const stacks = zone.stacks[String(bay)] ?? [];
      if (stacks.length < 3 || stacks.length > 6) continue;
      if (busy.has(`${zone.zone}|${String(bay)}`)) continue;
      return { zone: zone.zone, bay, stacks };
    }
  }
  return null;
}
