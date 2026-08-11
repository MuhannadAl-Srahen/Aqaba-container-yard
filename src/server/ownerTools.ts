import { DatabaseSync } from 'node:sqlite';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ErrorCode, Position, Size } from '../shared/types';
import { TIERS } from '../shared/types';
import { ASEZA } from '../shared/asezaLayout';
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
    transaction(db, () => {
      db.exec('DELETE FROM movements');
      db.exec('DELETE FROM containers');
      db.exec("DELETE FROM settings WHERE key IN ('card_in_next', 'card_out_next')");
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('containers', 'movements')");
    });
    return { ok: true, backup: path.basename(kept) };
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
    (request): { ok: boolean; containers: number; users: number; backup: string } => {
      requireOwner(request);
      const file = liveFile();
      const bytes: unknown = request.body;
      if (!Buffer.isBuffer(bytes) || bytes.length < 512) refuse(400, 'BAD_BACKUP');
      if (!Buffer.isBuffer(bytes)) throw new Error('unreachable');
      // Every SQLite file on earth starts with the same sixteen bytes.
      if (bytes.subarray(0, 15).toString('utf8') !== 'SQLite format 3') refuse(400, 'BAD_BACKUP');

      const scratch = path.join(path.dirname(file), 'backups', `.restore-${String(Date.now())}.db`);
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

/** Copy every table from a restored database into the live one. */
function copyAcross(
  db: DatabaseSync,
  source: DatabaseSync,
): { containers: number; users: number } {
  const rowsOf = (table: string): Array<Record<string, unknown>> =>
    source.prepare(`SELECT * FROM ${table}`).all() as unknown as Array<Record<string, unknown>>;

  const users = rowsOf('users');
  const containers = rowsOf('containers');
  const movements = rowsOf('movements');
  const settings = rowsOf('settings');

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

      db.exec('DELETE FROM movements');
      db.exec('DELETE FROM containers');
      db.exec('DELETE FROM users');
      db.exec('DELETE FROM settings');

      insertAll(db, 'users', users);
      insertAll(db, 'containers', containers);
      insertAll(db, 'movements', movements);
      insertAll(db, 'settings', settings);
      if (cookieSecret !== null) setSetting(db, 'cookie_secret', cookieSecret);

      // AUTOINCREMENT reads its next id from here, not from the table, so
      // without this the first new container would collide with a restored one.
      for (const table of ['users', 'containers', 'movements']) {
        const max = (
          db.prepare(`SELECT MAX(id) AS top FROM ${table}`).get() as { top: number | null }
        ).top;
        db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(table);
        if (max !== null) {
          db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(table, max);
        }
      }
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return { containers: containers.length, users: users.length };
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

const OWNERS = [
  'شركة البحر الأحمر للتجارة',
  'مؤسسة الشرق للاستيراد',
  'شركة وادي رم للنقل',
  'الشركة الأردنية للحاويات',
  'مؤسسة العقبة التجارية',
  'شركة النورس للشحن',
  'مجموعة الفيصل التجارية',
];
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
export function seedDemoYard(db: DatabaseSync): { added: number; departed: number } {
  const rnd = generator(20_260_811);
  const standing: Standing[] = store.listStanding(db);
  const bills = ['3210', '4187', '5502', '6741', '7130'];
  const day = 86_400_000;
  const now = Date.now();

  let added = 0;
  let departed = 0;
  for (let index = 0; index < 45; index += 1) {
    const size: Size = rnd() < 0.35 ? 40 : 20;
    const slot = pickSlot(standing, size, rnd);
    if (slot === null) continue;

    // Spread over the last three weeks, at working hours rather than midnight.
    const enteredAt = new Date(
      now - Math.floor(rnd() * 21) * day - Math.floor(rnd() * 11 + 6) * 3_600_000,
    ).toISOString();
    const leaves = rnd() < 0.27;
    const number = demoNumber(rnd, index);
    const seal = `JO${String(10_000 + Math.floor(rnd() * 89_999))}`;
    const gross = 20_000 + Math.floor(rnd() * 12_000);

    const id = store.insertContainer(db, {
      number,
      numberValid: checkNumber(number).valid,
      size,
      customer: OWNERS[Math.floor(rnd() * OWNERS.length)] ?? OWNERS[0] ?? '',
      bill: rnd() < 0.6 ? (bills[Math.floor(rnd() * bills.length)] ?? '') : '',
      notes: NOTES[Math.floor(rnd() * NOTES.length)] ?? '',
      position: slot,
      at: enteredAt,
      weight: String(gross),
      weightNet: String(gross - 2_200 - Math.floor(rnd() * 600)),
      hazmat: rnd() < 0.1,
      truckIn: String(100 + Math.floor(rnd() * 899)),
      driverIn: DRIVERS[Math.floor(rnd() * DRIVERS.length)] ?? '',
      sealIn: seal,
      cardIn: store.nextCardNumber(db, 'in'),
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
        driver: DRIVERS[Math.floor(rnd() * DRIVERS.length)] ?? '',
        sealOut: seal,
        cardOut: store.nextCardNumber(db, 'out'),
      });
      store.recordMovement(db, id, 'OUT', exitedAt, slot, null, '', null);
      departed += 1;
      continue;
    }
    // Only what is still standing can hold ground for the next one.
    standing.push({ id, number, size, position: slot });
  }
  return { added, departed };
}
