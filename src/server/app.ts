import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import type { DatabaseSync } from 'node:sqlite';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import type { Browser, BrowserType } from 'playwright-core';
import type {
  ApiError,
  BatchDto,
  BatchMatch,
  BatchSummaryDto,
  CardSheetRow,
  ContainerDto,
  DailyReportRow,
  ErrorCode,
  FleetDto,
  MachineReportRow,
  GateReportRow,
  LogReportRow,
  MeDto,
  Permission,
  PermitDto,
  PermitKind,
  PermitReportRow,
  Position,
  StandingReportRow,
  StorageReportRow,
  TaskDto,
  UnassignedPlateRow,
  YardStateDto,
} from '../shared/types';
import {
  HANDLING,
  OWNER_ID,
  PERMISSIONS,
  PERMIT_KINDS,
  TIERS,
  ZONES,
  sizeOfBay,
} from '../shared/types';
import type { DriverHaulRow, OrphanWageRow } from '../shared/types';
import type { PlateDriver } from '../shared/fleet';
import { normalizePlate, plateMatches } from '../shared/fleet';
import { plainCode } from '../shared/bidi';
import { ammanDay, ammanYear, daysBetween, toLocalStamp } from '../shared/dates';
import { checkNumber, normalizeNumber } from '../shared/iso6346';
import type { SheetRow } from '../shared/customsSheet';
import { interpretGrids } from '../shared/customsSheet';
import { readSheetGrids } from './sheetFiles';
import { baySpan, positionLabel, samePosition, yardOf } from '../shared/address';
import type { Descent, Refusal as RuleRefusal, Standing } from '../shared/rules';
import { canMove, canPlace, planGroupMove, planRemoval, restingOn, slotUsable } from '../shared/rules';
import { composeLayout, zoneDefOf } from '../shared/layout';
import type { YardLayout, Zone } from '../shared/types';
import {
  DRIVER_SESSION_MS,
  SESSION_COOKIE,
  SESSION_MS,
  hasPassword,
  issueSession,
  setPassword,
  verifyPassword,
  verifySecret,
  verifySession,
} from './auth';
import { databaseFile, snapshot, transaction } from './db';
import { registerOwnerTools } from './ownerTools';
import * as store from './store';

/**
 * The whole API. Every write runs inside a transaction and re-checks the yard
 * rules against the rows as they are at that moment — the client's own checks
 * are a courtesy, never the authority.
 */

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * «بانتظار التحميل» — the 24-hour clock: every box whose exit card is at
     * least a day old and that nobody confirmed loaded is loaded now. Each box
     * in its own transaction; answers how many left the ground. `nowIso`
     * stands in for the clock in tests.
     */
    sweepLoading: (nowIso?: string) => number;
  }
}

/**
 * The owner's word: a box nobody confirms loaded «تختفي الحاوية وحدها بعد 24
 * ساعة» — counted from its exit card.
 */
export const LOADING_GRACE_MS = 24 * 60 * 60 * 1000;

class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.code);
  }
}

const refuse = (status: number, code: ErrorCode, details?: ApiError['details']): never => {
  throw new Refusal(status, details === undefined ? { code } : { code, details });
};

/** A rule refusal, carrying the other container's number when one is involved. */
const refuseRule = (refusal: RuleRefusal): never =>
  refuse(409, refusal.code, refusal.other === undefined ? undefined : { other: refusal.other });

/**
 * The five-part slot. The zone may be an official letter or one the owner
 * defined; the shape here only gates nonsense — the LAYOUT is the judge of
 * what exists, and it answers BAD_SLOT with the address in hand.
 */
const positionSchema = z.object({
  zone: z.string().regex(/^[A-Z]{1,2}$/),
  bay: z.number().int().min(1).max(99),
  stack: z.number().int().min(1).max(99),
  tier: z.enum(TIERS),
});

/**
 * A gate record with holes in it is a gate record somebody has to chase down
 * later, so nearly everything here is mandatory — the owner's rule, «كل
 * الخانات اجبارية كلهم كلهم عدا الملاحظات اختيارية».
 *
 * Four exceptions, all of them the owner's later correction: the notes, the
 * driver's NAME, and the two weights. A truck can arrive before its scale
 * ticket does, and the man at the wheel is often not the man on any paper —
 * the plate identifies the vehicle, and refusing the whole record over a name
 * only teaches the gate to invent one.
 */
const gateInSchema = z.object({
  number: z.string().trim().min(1).max(20),
  size: z.union([z.literal(20), z.literal(40)]),
  /** رقم البوليصة. */
  bill: z.string().trim().min(1).max(40),
  notes: z.string().trim().max(2000),
  position: positionSchema,
  truck: z.string().trim().min(1).max(30),
  seal: z.string().trim().min(1).max(30),
  driver: z.string().trim().max(60).default(''),
  /** الوزن, as the scale ticket reads it. */
  weight: z.string().trim().max(20).default(''),
  /**
   * Crane or straddle — mandatory, because it is a choice between two things
   * the crew always knows, and the entry card is meant to carry the answer.
   */
  handling: z.enum(HANDLING),
  /**
   * «أسأل الموظف عند الإدخال»: فردية أم على كشف. The FORM insists on an
   * answer; the wire stays lenient so nothing older than the question
   * breaks against it.
   */
  billKind: z.enum(['SINGLE', 'MANIFEST']).nullable().default(null),
});

/**
 * The exit no longer asks for a seal, on the owner's instruction. A container
 * carries ONE seal — the one recorded at the gate it came in through — and
 * that is the one every card and every register names from here on.
 */
/** أي آلية تناول الحاوية — الونش أو العقرب. */
const machineSchema = z.enum(HANDLING);

const gateOutSchema = z.object({
  truck: z.string().trim().min(1).max(30),
  driver: z.string().trim().max(60).default(''),
  /**
   * «ليس دائما التي ادخلتها هي نفسها التي سوف تخرجها»: the clerk names
   * the machine that will load this truck, because the office has no
   * other way to tell it. Left unsaid, the work falls to whatever
   * unloaded the box at entry — the behaviour that stood before.
   */
  machine: machineSchema.optional(),
});

/**
 * Everything a person typed can be corrected, because a person typed it —
 * «ممكن يخطئ». What is NOT here is deliberate: the card serials are minted by
 * the yard rather than entered, the position belongs to a move (which has its
 * own movement record), and `number_valid` is derived from the number itself.
 */
const editSchema = z.object({
  number: z.string().trim().min(1).max(20),
  bill: z.string().trim().min(1).max(40),
  size: z.union([z.literal(20), z.literal(40)]),
  /** Optional here for the same reasons they are optional at the gate. */
  notes: z.string().trim().max(2000),
  weight: z.string().trim().max(20).default(''),
  /** Nullable here, and only here: records from before the field existed. */
  handling: z.enum(HANDLING).nullable().default(null),
  /**
   * Correctable like the rest — the gate may have answered wrong. OPTIONAL,
   * not defaulted: a payload that never mentions it must keep what the
   * record already says, not wipe it to null.
   */
  billKind: z.enum(['SINGLE', 'MANIFEST']).nullable().optional(),
  truckIn: z.string().trim().min(1).max(30),
  driverIn: z.string().trim().max(60).default(''),
  sealIn: z.string().trim().min(1).max(30),
  truckOut: z.string().trim().max(30).default(''),
  driverOut: z.string().trim().max(60).default(''),
  /** The gate instants themselves — a wrong date puts a box in the wrong register. */
  enteredAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  exitedAt: z
    .string()
    .datetime({ offset: true })
    .or(z.string().datetime())
    .nullable()
    .default(null),
});

const permissionSchema = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);
const pinSchema = z.string().trim().regex(/^\d{4,6}$/);
/** أي آلية يقود الحساب: '' = مكتب. */
const userMachineSchema = z.enum(HANDLING).or(z.literal(''));

const userSchema = z.object({
  name: z.string().trim().min(1).max(40),
  pin: pinSchema,
  permissions: permissionSchema,
  machine: userMachineSchema.default(''),
});

/** An edit may leave the PIN alone; sending one replaces it. */
const userPatchSchema = z.object({
  name: z.string().trim().min(1).max(40),
  permissions: permissionSchema,
  machine: userMachineSchema.optional(),
  pin: pinSchema.optional(),
});

/** مهام الآليات: a تجهيز request, and the queue's own small verbs. */
const prepareSchema = z.object({
  containerId: z.number().int().min(1),
  machine: machineSchema.optional(),
});
const prepareBillSchema = z.object({
  bill: z.string().trim().min(1).max(40),
  machine: machineSchema.optional(),
});

const carrierSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

/**
 * A numbered permit. EXIT — تصريح تحميل وخروج داخلي: one bill and the
 * containers it lets out, so the bill is required (checked in the route).
 * STORAGE — تصريح نقل حاويات إلى مديرية التخزين: many bills on one paper,
 * so none is named. A body without `kind` is an exit permit, as every body
 * was before the storage paper existed.
 */
const permitSchema = z.object({
  kind: z.enum(PERMIT_KINDS).default('EXIT'),
  bill: z.string().trim().max(40).default(''),
  items: z
    .array(
      z.object({
        containerId: z.number().int().positive(),
        /**
         * «ليه بدخل رقم سيارة ؟؟؟ مهو ما ببين اساسا بالتصريح عند الطباعة»:
         * the plate left the screen, and the column stays only so papers
         * already stamped keep what they were issued with. Optional, so a
         * tab left open from before the change still issues its permit.
         */
        truck: z.string().trim().max(30).default(''),
        /** الوزن كما تُصدره الورقة — prefilled from the record, editable. */
        weight: z.string().trim().max(20).default(''),
      }),
    )
    .min(1)
    .max(200),
});

/** A registered truck: its carrier, the plate's ترميز, its number, its usual driver. */
const truckSchema = z.object({
  carrierId: z.number().int().positive(),
  code: z.string().trim().max(10),
  number: z.string().trim().min(1).max(20),
  driver: z.string().trim().max(60),
});

/**
 * A rejected payload now says WHICH field it tripped on. Without it every
 * schema failure in the whole app reached the user as one sentence about
 * «بيانات ناقصة أو غير صحيحة» with nothing to act on, and the only way to
 * find the offending field was to guess.
 */
function parseOrRefuse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first === undefined ? '' : first.path.join('.');
    throw new Refusal(400, field === '' ? { code: 'VALIDATION' } : { code: 'VALIDATION', details: { field } });
  }
  return result.data as z.output<S>;
}

/**
 * Which build is actually running, as the moment its client was compiled.
 * After an update the first question is always «نزلت التعديلات؟», and until
 * this existed the only honest answer was to go looking. Read from the
 * shipped file itself, so it cannot claim a version that was not deployed.
 */
function buildStamp(): string {
  try {
    const index = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/index.html');
    return statSync(index).mtime.toISOString();
  } catch {
    // Development, where Vite serves the page and there is no build to stamp.
    return '';
  }
}

/** In-memory login throttle: enough to blunt a guessing loop on a public URL. */
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 20;

/** The machine's own browser engine, for printing PDFs server-side. */
/** The sheet's title lands inside a footer template — it must not be markup. */
function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function launchSystemBrowser(chromium: BrowserType): Promise<Browser> {
  for (const channel of ['msedge', 'chrome'] as const) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      // Not installed here; try the next engine.
    }
  }
  return chromium.launch({ headless: true });
}

export function buildApp(db: DatabaseSync): FastifyInstance {
  // trustProxy: in production the app sits behind a local tunnel/proxy, so
  // the real client address arrives in X-Forwarded-For — without this, every
  // visitor shares 127.0.0.1 and one stranger's failed logins would throttle
  // the whole yard.
  const app = Fastify({ logger: false, trustProxy: true });

  /**
   * The yard as it stands right now: the official ASEZA drawing plus the
   * zones the owner has defined. Composed per request — a handful of rows —
   * so every placement check judges against the layout of this moment, and
   * the address registry learns each zone's yard on the way.
   */
  const layoutNow = (): YardLayout =>
    composeLayout(store.listCustomZones(db), store.listRetiredZones(db));
  void app.register(cookie);
  // A restored backup arrives as raw database bytes. Fastify only knows JSON
  // out of the box; the route that receives this sets its own body limit.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body);
    },
  );

  // A container photo arrives as its own raw bytes — WhatsApp images are
  // JPEG/PNG/WebP — capped at 8MB apiece.
  app.addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp'],
    { parseAs: 'buffer', bodyLimit: 8 * 1024 * 1024 },
    (_request, body, done) => {
      done(null, body);
    },
  );

  const attempts = new Map<string, { count: number; windowStart: number }>();

  const now = (): string => new Date().toISOString();

  /** Who the cookie says is working: the owner, an employee, or nobody. */
  const actorOf = (request: FastifyRequest): MeDto | null => {
    const token = request.cookies[SESSION_COOKIE];
    if (token === undefined) return null;
    const id = verifySession(db, token, Date.now());
    if (id === null) return null;
    if (id === OWNER_ID) {
      return {
        id: OWNER_ID,
        name: store.OWNER_NAME,
        owner: true,
        permissions: PERMISSIONS,
        machine: '',
      };
    }
    // An employee removed mid-session loses the session with the account.
    const user = store.getUser(db, id);
    if (user === null) return null;
    return {
      id: user.id,
      name: user.name,
      owner: false,
      permissions: user.permissions,
      machine: user.machine,
    };
  };

  const requireAuth = (request: FastifyRequest): MeDto => {
    const actor = actorOf(request);
    if (actor === null) refuse(401, 'UNAUTHORIZED');
    if (actor === null) throw new Error('unreachable');
    return actor;
  };

  /** Signed in AND allowed to do this particular thing. */
  const requirePerm = (request: FastifyRequest, permission: Permission): MeDto => {
    const actor = requireAuth(request);
    if (!actor.owner && !actor.permissions.includes(permission)) refuse(403, 'FORBIDDEN');
    return actor;
  };

  /** The yard's shape, the staff and the dev tools are the owner's alone. */
  const requireOwner = (request: FastifyRequest): MeDto => {
    const actor = requireAuth(request);
    if (!actor.owner) refuse(403, 'FORBIDDEN');
    return actor;
  };

  /** The id a movement records: null for the owner. */
  const actorId = (actor: MeDto): number | null => (actor.owner ? null : actor.id);

  /** The people who run the machine queue: the owner and the two gate desks. */
  const canRunTasks = (actor: MeDto): boolean =>
    actor.owner ||
    actor.permissions.includes('GATE_IN') ||
    actor.permissions.includes('GATE_OUT');

  const idParam = (request: FastifyRequest): number => {
    const params = request.params as { id?: string };
    const id = Number(params.id);
    if (!Number.isInteger(id) || id < 1) refuse(400, 'VALIDATION');
    return id;
  };

  const sendSession = (reply: FastifyReply, userId: number): void => {
    // A driver's tablet holds the whole shift; the office keeps its hour.
    const machine = userId === OWNER_ID ? '' : (store.getUser(db, userId)?.machine ?? '');
    const ttl = machine === '' ? SESSION_MS : DRIVER_SESSION_MS;
    // No maxAge ON PURPOSE — «واحد يدخل ع الموقع يطلب منه كل مره كلمة سر»:
    // a cookie with no age dies with the browser, so opening the site anew
    // starts at the password. The signed window inside the token stands
    // behind it for browsers that never truly close.
    reply.setCookie(SESSION_COOKIE, issueSession(db, userId, Date.now(), ttl), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
    });
  };

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof Refusal) {
      void reply.status(error.status).send(error.body);
      return;
    }
    // Anything that reaches here is a fault, not a refusal, and the client is
    // told nothing but «حدث خطأ». Without a line in the log there is no way
    // to find out what it was on a machine at the office — the wipe/restore
    // tools in particular fail in ways only their stack explains.
    console.error(`[${request.method} ${request.url}]`, error);
    // A constraint violation surfacing here means a rule check missed a race —
    // the database held the line; report it as the conflict it is.
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      void reply.status(409).send({ code: 'NAME_TAKEN' } satisfies ApiError);
      return;
    }
    // A fault is not a refusal. Reporting one as VALIDATION told the office
    // its data was wrong when the server was — the stack is in the log above.
    void reply.status(500).send({ code: 'SERVER_FAULT' } satisfies ApiError);
  });

  /**
   * What the client needs before it can draw anything — including the staff
   * names, so the sign-in screen can offer them as buttons. Names are all it
   * gives away, and the whole site sits behind the sign-in either way.
   */
  const build = buildStamp();

  app.get('/api/boot', (request) => {
    const actor = actorOf(request);
    return {
      firstRun: !hasPassword(db),
      authorized: actor !== null,
      // {id, name} and nothing more: which machine an account drives is not
      // the anonymous sign-in screen's business.
      staff: store.listUsers(db).map((user) => ({ id: user.id, name: user.name })),
      build,
      /** Is the CALLER's own session a driver's — the idle lock reads this. */
      driver: actor !== null && actor.machine !== '',
    };
  });

  /** Who is signed in and what the screen may offer them. */
  app.get('/api/me', (request): MeDto => requireAuth(request));

  /**
   * First run: the owner's password and nothing else. The yard itself needs
   * no setting up — it is the official ASEZA layout, compiled in.
   */
  app.post('/api/setup', (request, reply) => {
    if (hasPassword(db)) refuse(409, 'ALREADY_SETUP');
    const body = parseOrRefuse(
      z.object({ password: z.string().min(6).max(200) }),
      request.body,
    );

    transaction(db, () => {
      setPassword(db, body.password);
    });
    sendSession(reply, OWNER_ID);
    return { ok: true };
  });

  /**
   * تجديد الجلسة بلمسة إنسان: the client pings this on real interaction, a
   * few minutes apart at most — the automatic screen refreshes never touch
   * it, so a device someone walked away from goes quiet and signs out.
   */
  app.post('/api/session/refresh', (request, reply) => {
    const actor = requireAuth(request);
    sendSession(reply, actor.owner ? OWNER_ID : actor.id);
    return { ok: true };
  });

  /**
   * تغيير كلمة سر المالك — the owner's own hand, and his current word first:
   * a session left open on an office machine must not be enough to take the
   * master key. The new word keeps first-run's own floor of six.
   */
  app.post('/api/owner-password', (request) => {
    requireOwner(request);
    const body = parseOrRefuse(
      z.object({ current: z.string().min(1).max(200), password: z.string().min(6).max(200) }),
      request.body,
    );
    if (!verifyPassword(db, body.current)) refuse(403, 'BAD_PASSWORD');
    transaction(db, () => {
      setPassword(db, body.password);
    });
    return { ok: true };
  });

  /**
   * Two doors, one throttle: the owner's password, or an employee's id and
   * PIN. Both refuse with the same code so a wrong PIN never tells an
   * outsider which half of the pair was wrong.
   */
  app.post('/api/login', (request, reply) => {
    const body = parseOrRefuse(
      z.union([
        z.object({ password: z.string().max(200) }),
        z.object({ userId: z.number().int().min(1), pin: z.string().max(20) }),
      ]),
      request.body,
    );

    const key = request.ip;
    const entry = attempts.get(key);
    const nowMs = Date.now();
    if (entry !== undefined && nowMs - entry.windowStart < ATTEMPT_WINDOW_MS) {
      if (entry.count >= ATTEMPT_LIMIT) refuse(429, 'BAD_PASSWORD');
    } else {
      attempts.set(key, { count: 0, windowStart: nowMs });
    }

    const ok =
      'password' in body
        ? verifyPassword(db, body.password)
        : verifySecret(store.userPinHash(db, body.userId), body.pin);
    if (!ok) {
      const current = attempts.get(key) ?? { count: 0, windowStart: nowMs };
      attempts.set(key, { count: current.count + 1, windowStart: current.windowStart });
      refuse(401, 'BAD_PASSWORD');
    }

    attempts.delete(key);
    sendSession(reply, 'password' in body ? OWNER_ID : body.userId);
    return { ok: true };
  });

  /** The staff, with their permissions. The owner's screen alone. */
  app.get('/api/users', (request) => {
    requireOwner(request);
    return { users: store.listUsers(db) };
  });

  app.post('/api/users', (request, reply) => {
    requireOwner(request);
    const body = parseOrRefuse(userSchema, request.body);
    return transaction(db, () => {
      if (store.userNameTaken(db, body.name)) refuse(409, 'USER_EXISTS', { name: body.name });
      const id = store.insertUser(db, body);
      void reply.status(201);
      return store.getUser(db, id);
    });
  });

  /** Rename, re-permission, and — only when one is sent — a fresh PIN. */
  app.patch('/api/users/:id', (request) => {
    requireOwner(request);
    const id = idParam(request);
    const body = parseOrRefuse(userPatchSchema, request.body);
    return transaction(db, () => {
      if (store.getUser(db, id) === null) refuse(404, 'NOT_FOUND');
      if (store.userNameTaken(db, body.name, id)) refuse(409, 'USER_EXISTS', { name: body.name });
      store.updateUser(db, id, body);
      return store.getUser(db, id);
    });
  });

  /** Soft: their name must still resolve on every register they ever signed. */
  app.delete('/api/users/:id', (request) => {
    requireOwner(request);
    const id = idParam(request);
    return transaction(db, () => {
      if (store.getUser(db, id) === null) refuse(404, 'NOT_FOUND');
      store.softDeleteUser(db, id, now());
      return { ok: true };
    });
  });

  /**
   * الأسطول: الناقلون وسياراتهم في جواب واحد. Anyone signed in may read it —
   * the gate needs it to recognise a plate as it is typed and offer the
   * registered driver; writing it is the owner's alone, below.
   */
  app.get('/api/fleet', (request): FleetDto => {
    requireAuth(request);
    return { carriers: store.listCarriers(db), trucks: store.listTrucks(db) };
  });

  /**
   * دفتر اللوحات: every plate the gate has written with the last driver name
   * beside it, so a returning truck writes its own driver's name — «بدي مجرد
   * ما كتبت رقم سيارته خلص يكتب اسمه تلقائي». Open to the hands that type a
   * plate, which is where the suggestion is used and nowhere else.
   */
  app.get('/api/plates', (request): { plates: PlateDriver[] } => {
    const actor = requireAuth(request);
    const mayType =
      actor.owner ||
      actor.permissions.includes('GATE_IN') ||
      actor.permissions.includes('GATE_OUT') ||
      actor.permissions.includes('EDIT');
    if (!mayType) refuse(403, 'FORBIDDEN');
    return { plates: store.listPlateDrivers(db) };
  });

  /**
   * السيارات التي مرّت على البوابة ولم تُسجَّل بعد عند أي ناقل — what the
   * owner distributes: each row is one plate as the gate spelled it, with its
   * trips and the driver most recently written beside it.
   */
  app.get('/api/fleet/unassigned', (request): { rows: UnassignedPlateRow[] } => {
    requireOwner(request);
    const trucks = store.listTrucks(db);
    // Newest usage first, so the display spelling and the driver name are the
    // latest word the gate had for that plate.
    const seen = new Map<string, { plate: string; trips: number; driver: string }>();
    for (const usage of store.listPlateUsage(db)) {
      const key = normalizePlate(usage.plate);
      if (key === '') continue;
      const entry = seen.get(key);
      if (entry === undefined) {
        seen.set(key, { plate: usage.plate, trips: 1, driver: usage.driver });
      } else {
        entry.trips += 1;
        if (entry.driver === '' && usage.driver !== '') entry.driver = usage.driver;
      }
    }
    const rows = [...seen.values()]
      .filter((row) => !trucks.some((truck) => plateMatches(truck, row.plate)))
      .sort((a, b) => b.trips - a.trips);
    return { rows };
  });

  app.post('/api/carriers', (request, reply) => {
    requireOwner(request);
    const body = parseOrRefuse(carrierSchema, request.body);
    return transaction(db, () => {
      if (store.carrierNameTaken(db, body.name)) refuse(409, 'NAME_TAKEN');
      const id = store.insertCarrier(db, body.name);
      void reply.status(201);
      return store.getCarrier(db, id);
    });
  });

  app.patch('/api/carriers/:id', (request) => {
    requireOwner(request);
    const id = idParam(request);
    const body = parseOrRefuse(carrierSchema, request.body);
    return transaction(db, () => {
      if (store.getCarrier(db, id) === null) refuse(404, 'NOT_FOUND');
      if (store.carrierNameTaken(db, body.name, id)) refuse(409, 'NAME_TAKEN');
      store.renameCarrier(db, id, body.name);
      return store.getCarrier(db, id);
    });
  });

  /**
   * Soft, and only once his trucks have been moved or struck out themselves:
   * silently orphaning a fleet — or worse, cascading it away — would erase
   * the very distribution the owner just made.
   */
  app.delete('/api/carriers/:id', (request) => {
    requireOwner(request);
    const id = idParam(request);
    return transaction(db, () => {
      if (store.getCarrier(db, id) === null) refuse(404, 'NOT_FOUND');
      const holding = store.carrierTruckCount(db, id);
      if (holding > 0) refuse(409, 'CARRIER_HAS_TRUCKS', { count: holding });
      store.softDeleteCarrier(db, id, now());
      return { ok: true };
    });
  });

  app.post('/api/trucks', (request, reply) => {
    requireOwner(request);
    const body = parseOrRefuse(truckSchema, request.body);
    return transaction(db, () => {
      if (store.getCarrier(db, body.carrierId) === null) refuse(404, 'NOT_FOUND');
      // One plate, one truck: the same normalized code+number under any
      // carrier is the same physical vehicle registered twice.
      const plate = normalizePlate(body.code + body.number);
      const twin = store
        .listTrucks(db)
        .find((truck) => normalizePlate(truck.code + truck.number) === plate);
      if (twin !== undefined) refuse(409, 'TRUCK_EXISTS');
      const id = store.insertTruck(db, body);
      void reply.status(201);
      return store.getTruck(db, id);
    });
  });

  /** Correct a plate or driver, or hand the truck to another carrier — «توزيع». */
  app.patch('/api/trucks/:id', (request) => {
    requireOwner(request);
    const id = idParam(request);
    const body = parseOrRefuse(truckSchema, request.body);
    return transaction(db, () => {
      if (store.getTruck(db, id) === null) refuse(404, 'NOT_FOUND');
      if (store.getCarrier(db, body.carrierId) === null) refuse(404, 'NOT_FOUND');
      const plate = normalizePlate(body.code + body.number);
      const twin = store
        .listTrucks(db)
        .find((truck) => truck.id !== id && normalizePlate(truck.code + truck.number) === plate);
      if (twin !== undefined) refuse(409, 'TRUCK_EXISTS');
      store.updateTruck(db, id, body);
      return store.getTruck(db, id);
    });
  });

  app.delete('/api/trucks/:id', (request) => {
    requireOwner(request);
    const id = idParam(request);
    return transaction(db, () => {
      if (store.getTruck(db, id) === null) refuse(404, 'NOT_FOUND');
      store.softDeleteTruck(db, id, now());
      return { ok: true };
    });
  });

  /**
   * الزونات التي يعرّفها المالك — his own yards (1، 3 …) or zones added
   * beside the official plan, which stays committed data and is never
   * edited. A grid of odd bays and stacks, three tiers always (the owner's
   * explicit call), and the slots he closes refuse placement exactly the
   * way the plan's walls do. Reading needs a session — every screen draws
   * the map — while shaping the ground is the owner's alone.
   */
  // Every field optional: a nudge sends the position alone and the grid
  // save sends the closed slots alone, so neither can overwrite the other
  // with a stale copy of what it never meant to touch.
  const zoneShapeSchema = z.object({
    bays: z.number().int().min(1).max(40).optional(),
    stacks: z.number().int().min(1).max(20).optional(),
    closed: z
      .array(z.tuple([z.number().int().min(1), z.number().int().min(1)]))
      .max(800)
      .optional(),
    // Where the owner parked the zone on the drawing; null = automatic.
    x: z.number().min(0).max(5000).nullable().optional(),
    y: z.number().min(0).max(5000).nullable().optional(),
  });

  app.get(
    '/api/zones',
    (
      request,
    ): {
      zones: ReturnType<typeof store.listCustomZones>;
      retired: ReturnType<typeof store.listRetiredZones>;
    } => {
      requireAuth(request);
      // The retired letters ride along so the client's registry keeps
      // labelling history: a struck zone's addresses hold their yard digit.
      return { zones: store.listCustomZones(db), retired: store.listRetiredZones(db) };
    },
  );

  app.post('/api/zones', (request, reply) => {
    requireOwner(request);
    const body = parseOrRefuse(
      z.object({
        yard: z.number().int().min(1).max(9),
        name: z.string().regex(/^[A-Z]{1,2}$/),
        bays: z.number().int().min(1).max(40),
        stacks: z.number().int().min(1).max(20),
      }),
      request.body,
    );
    return transaction(db, () => {
      // One letter, one zone, across every yard: the zone alone decides the
      // address's leading digit, so a twin letter would fork the ground. A
      // STRUCK zone keeps its letter only while history needs it — papers
      // print the old yard digit, and a new zone under the letter would
      // re-home them all. A zone deleted before any box stood in it left
      // no paper: listRetiredZones drops it, and the letter is free again.
      const taken =
        (ZONES as readonly string[]).includes(body.name) ||
        store.listCustomZones(db).some((zone) => zone.zone === body.name) ||
        store.listRetiredZones(db).some((zone) => zone.zone === body.name);
      if (taken) refuse(409, 'NAME_TAKEN');
      const id = store.insertCustomZone(db, body);
      void reply.status(201);
      return store.getCustomZone(db, id);
    });
  });

  /**
   * Reshape a zone: grow or shrink the grid, open or close slots. Refused
   * whenever a standing container would be left without ground under it —
   * the ground under a stored box never vanishes by edit.
   */
  app.patch('/api/zones/:id', (request) => {
    requireOwner(request);
    const id = idParam(request);
    const body = parseOrRefuse(zoneShapeSchema, request.body);
    return transaction(db, () => {
      const zone = store.getCustomZone(db, id);
      if (zone === null) refuse(404, 'NOT_FOUND');
      if (zone === null) throw new Error('unreachable');
      const next = {
        bays: body.bays ?? zone.bays,
        stacks: body.stacks ?? zone.stacks,
        closed:
          body.closed === undefined
            ? zone.closed
            : body.closed.map((pair) => [pair[0], pair[1]] as const),
        x: body.x === undefined ? zone.x : body.x,
        y: body.y === undefined ? zone.y : body.y,
      };
      const reshaped = zoneDefOf({ ...zone, ...next }, 0, 0);
      const trial: YardLayout = { zones: [reshaped], landmarks: [] };
      for (const standing of store.listStanding(db)) {
        if (standing.position.zone !== zone.zone) continue;
        const grounded = baySpan(standing.position.bay).every((oddBay) =>
          slotUsable(trial, zone.zone, oddBay, standing.position.stack),
        );
        if (!grounded) refuse(409, 'ZONE_HAS_CONTAINERS');
      }
      store.updateCustomZone(db, id, next);
      return store.getCustomZone(db, id);
    });
  });

  app.delete('/api/zones/:id', (request) => {
    requireOwner(request);
    const id = idParam(request);
    return transaction(db, () => {
      const zone = store.getCustomZone(db, id);
      if (zone === null) refuse(404, 'NOT_FOUND');
      if (zone === null) throw new Error('unreachable');
      const occupied = store
        .listStanding(db)
        .some((standing) => standing.position.zone === zone.zone);
      if (occupied) refuse(409, 'ZONE_HAS_CONTAINERS');
      store.softDeleteCustomZone(db, id, now());
      return { ok: true };
    });
  });

  /**
   * تصريح خروج من الساحة — the permission paper the yard issues for one
   * bill: load the containers listed and take them to موقع المقص only. The
   * paper authorizes; it moves nothing — the actual departures still happen
   * at the gate one by one. Issued under GATE_OUT: it is exit paperwork.
   */
  app.post('/api/permits', (request, reply) => {
    // Peek at the kind before the guard: an exit paper is GATE_OUT's, a
    // storage transfer is MOVE's — «نقل وليست اخراج».
    const asked = (request.body as { kind?: unknown } | null)?.kind;
    const actor = requirePerm(request, asked === 'STORAGE' ? 'MOVE' : 'GATE_OUT');
    const body = parseOrRefuse(permitSchema, request.body);
    if (body.kind === 'STORAGE') return issueStoragePermit(actor, body, reply);
    if (body.bill === '') refuse(400, 'VALIDATION', { field: 'bill' });
    return transaction(db, () => {
      // One line per container: the same box twice would double-count the
      // paper the storage directorate stamps.
      const distinct = new Set(body.items.map((item) => item.containerId));
      if (distinct.size !== body.items.length) refuse(400, 'VALIDATION');
      // Standing or departed alike: the office records the gate exit first
      // and prints this paper after — «ادخلت رقم البوليصة لحاويات التي
      // خرجت», the owner's own flow — so departure is no ground to refuse.
      const lines = body.items.map((item) => {
        const container = store.getContainer(db, item.containerId);
        if (container === null) refuse(404, 'NOT_FOUND');
        if (container === null) throw new Error('unreachable');
        // The paper is for THIS bill; a stray container of another would
        // make the stamped sheet claim what the registry denies.
        if (container.bill !== body.bill) refuse(400, 'VALIDATION');
        // The line pins the container's facts as the paper is issued, so a
        // reprint always matches the stamped original in the drawer.
        return {
          containerId: container.id,
          truck: item.truck,
          number: container.number,
          cardIn: container.cardIn,
          cardInYear: container.cardInYear,
          enteredAt: container.enteredAt,
          weight: item.weight,
          // Pinned like the rest, now that «تصحيح الفئة» can change the live
          // class: a stamped paper's «عشرين / أربعين» line must not move.
          size: container.size,
          bill: container.bill,
        };
      });
      const at = now();
      const year = ammanYear(at);
      // The paper names its yard off the containers themselves: the first
      // one with known ground decides — where it stands, or, for a box
      // already through the gate (the office's own order: exit first, paper
      // after), where it stood as it left.
      layoutNow();
      const anchor = body.items
        .map((item) => {
          const container = store.getContainer(db, item.containerId);
          if (container === null) return null;
          return container.position ?? store.lastExitPosition(db, container.id);
        })
        .find((position) => position !== null);
      const yard = anchor === undefined || anchor === null ? 2 : yardOf(anchor.zone);
      const id = store.insertPermit(db, {
        kind: 'EXIT',
        serial: store.nextPermitNumber(db, 'EXIT', year),
        serialYear: year,
        bill: body.bill,
        at,
        userId: actorId(actor),
        yard,
        items: lines,
      });
      void reply.status(201);
      return store.getPermit(db, id);
    });
  });

  /**
   * تصريح نقل حاويات إلى مديرية التخزين — «اذا قعدت اكثر من تسعين يوم
   * بننقلهم ل مكان داخل الساحة … وهي نقل وليست اخراج».
   *
   * A paper and a mark, nothing more: issuing it moves no steel — the crew
   * carries the boxes with the ordinary move, which prints its own move card
   * — and the container reads «منقولة للتخزين» for as long as a live line of
   * a live storage permit carries it. Many bills on one paper, each line
   * pinning its own.
   *
   * Only a box standing in the yard on paper can be transferred: one whose
   * exit card is written is leaving, and one already gone has nothing to
   * move. The ninety days are NOT checked here — the owner's call: the issue
   * screen warns in amber and never bars, since the directorate may order an
   * early transfer.
   */
  const issueStoragePermit = (
    actor: MeDto,
    body: z.infer<typeof permitSchema>,
    reply: FastifyReply,
  ): PermitDto | null =>
    transaction(db, () => {
      const distinct = new Set(body.items.map((item) => item.containerId));
      if (distinct.size !== body.items.length) refuse(400, 'VALIDATION');
      const containers = body.items.map((item) => {
        const container = store.getContainer(db, item.containerId);
        if (container === null) refuse(404, 'NOT_FOUND');
        if (container === null) throw new Error('unreachable');
        if (container.exitedAt !== null || container.position === null) {
          refuse(409, 'STORAGE_NOT_STANDING', { other: container.number });
        }
        return { container, weight: item.weight };
      });
      const lines = containers.map(({ container, weight }) => ({
        containerId: container.id,
        truck: '',
        number: container.number,
        cardIn: container.cardIn,
        cardInYear: container.cardInYear,
        enteredAt: container.enteredAt,
        weight,
        size: container.size,
        bill: container.bill,
      }));
      const at = now();
      const year = ammanYear(at);
      layoutNow();
      const anchor = containers.find(({ container }) => container.position !== null)?.container
        .position;
      const yard = anchor === undefined || anchor === null ? 2 : yardOf(anchor.zone);
      const id = store.insertPermit(db, {
        kind: 'STORAGE',
        serial: store.nextPermitNumber(db, 'STORAGE', year),
        serialYear: year,
        bill: '',
        at,
        userId: actorId(actor),
        yard,
        items: lines,
      });
      void reply.status(201);
      return store.getPermit(db, id);
    });

  /** `?kind=` names the book; anything else is the exit book, as before. */
  const kindParam = (raw: unknown): PermitKind => (raw === 'STORAGE' ? 'STORAGE' : 'EXIT');

  /** One permit book — exit or storage — for a period. */
  app.get('/api/permits', (request): { rows: PermitReportRow[] } => {
    requirePerm(request, 'REPORTS');
    const query = request.query as { from?: string; to?: string; kind?: string };
    const range = parseOrRefuse(rangeSchema, { from: query.from, to: query.to });
    return { rows: store.listPermits(db, kindParam(query.kind), range.from, range.to) };
  });

  /**
   * كشف المنقولة للتخزين: every container on a live storage paper issued in
   * the period, with how long it had sat when it was transferred and how long
   * it has sat by now — or by its exit card, once it has gone.
   */
  app.get('/api/reports/storage', (request): { rows: StorageReportRow[] } => {
    requirePerm(request, 'REPORTS');
    const query = request.query as { from?: string; to?: string };
    const range = parseOrRefuse(rangeSchema, { from: query.from, to: query.to });
    const at = now();
    const rows = store.listStorageTransfers(db, range.from, range.to).map(
      (row): StorageReportRow => ({
        ...row,
        dwellAtTransfer: daysBetween(row.enteredAt, row.at),
        dwellDays: daysBetween(row.enteredAt, row.exitedAt ?? at),
      }),
    );
    return { rows };
  });

  /**
   * أي من هذه الحاويات له تصريح حيّ — the warning the issue screen shows
   * before a second paper is stamped for the same box.
   */
  app.get('/api/permits/for', (request) => {
    const query = request.query as { ids?: string; kind?: string };
    const kind = kindParam(query.kind);
    // Each book warns its own issuer: an exit paper never reads as a second
    // storage paper, nor the other way round.
    requirePerm(request, kind === 'STORAGE' ? 'MOVE' : 'GATE_OUT');
    const ids = (query.ids ?? '')
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 500);
    return { rows: store.permitsOfContainers(db, ids, kind) };
  });

  /** One permit, exactly as issued — for reprinting from its register row. */
  app.get('/api/permits/:id', (request): PermitDto => {
    requirePerm(request, 'REPORTS');
    const id = idParam(request);
    const permit = store.getPermit(db, id);
    if (permit === null) refuse(404, 'NOT_FOUND');
    if (permit === null) throw new Error('unreachable');
    return permit;
  });

  /**
   * تعديل تصريح مُصدَر: strike containers off it without voiding it.
   * «اجاني مخلص قلي انا بدي اخرج 15 حاوية اليوم وكذب، قام جاب فقط 5 سيارات
   * ل 5 حاويات … اريد ان استطيع ان اعدل على التصريح بحيث فقط اضع الخمس
   * حاويات دون الحاجة لحذف التصريح.»
   *
   * The paper keeps its serial, its date and its bill; the struck lines stay
   * in the file, marked with who struck them and when. Under GATE_OUT — the
   * same hand that issues the paper corrects it the same morning — and a
   * permit cannot be emptied this way: a paper covering nothing is voided,
   * which is the owner's own act.
   */
  app.patch('/api/permits/:id', (request): PermitDto => {
    const id = idParam(request);
    // The hand that issues a paper corrects it: GATE_OUT for an exit permit,
    // MOVE for a storage one. A permit that does not exist is guarded as an
    // exit paper, so the refusal order is the one it always was.
    const actor = requirePerm(
      request,
      store.permitKind(db, id) === 'STORAGE' ? 'MOVE' : 'GATE_OUT',
    );
    const body = parseOrRefuse(
      z.object({ remove: z.array(z.number().int().positive()).min(1).max(200) }),
      request.body,
    );
    return transaction(db, () => {
      const permit = store.getPermit(db, id);
      if (permit === null) refuse(404, 'NOT_FOUND');
      if (permit === null) throw new Error('unreachable');
      const listed = new Set(permit.items.map((item) => item.containerId));
      // Striking what the paper does not carry would silently do nothing and
      // tell the clerk it worked.
      if (body.remove.some((containerId) => !listed.has(containerId))) {
        refuse(400, 'VALIDATION');
      }
      if (body.remove.length >= listed.size) refuse(409, 'PERMIT_EMPTY');
      store.dropPermitItems(db, id, body.remove, now(), actorId(actor));
      const after = store.getPermit(db, id);
      if (after === null) throw new Error('unreachable');
      return after;
    });
  });

  /**
   * Void a wrongly-issued permit. The owner's alone, like every walk-back of
   * a numbered paper — and the year's book closes over the freed serial, so
   * the live permits still read 1 … N with no hole.
   */
  app.delete('/api/permits/:id', (request) => {
    requireOwner(request);
    const id = idParam(request);
    return transaction(db, () => {
      if (store.getPermit(db, id) === null) refuse(404, 'NOT_FOUND');
      // The voided permit keeps its number, and the book carries the hole.
      store.softDeletePermit(db, id, now());
      return { ok: true };
    });
  });

  // ─── دفعات كشف الجمارك: الكشف يُقرأ حرفياً أو لا يُقرأ ─────────────────────

  /** Upload and approval belong to the gate: the owner or a GATE_IN hand. */
  const requireBatchUpload = (request: FastifyRequest): MeDto => {
    const actor = requireAuth(request);
    if (!actor.owner && !actor.permissions.includes('GATE_IN')) refuse(403, 'FORBIDDEN');
    return actor;
  };
  /** Viewing adds the report readers — the registry is a كشف like any other. */
  const requireBatchView = (request: FastifyRequest): MeDto => {
    const actor = requireAuth(request);
    const allowed =
      actor.owner ||
      actor.permissions.includes('GATE_IN') ||
      actor.permissions.includes('REPORTS');
    if (!allowed) refuse(403, 'FORBIDDEN');
    return actor;
  };

  // Real sheets measure kilobytes — the byte cap is sanity, and the row cap
  // keeps a wrong file (a whole year's ledger) from becoming one giant دفعة.
  const SHEET_BODY_LIMIT = 10 * 1024 * 1024;
  const SHEET_ROW_CAP = 2000;

  /** One reader for preview and approve — the two can never disagree. */
  const readBatchRows = (body: unknown): SheetRow[] => {
    if (!Buffer.isBuffer(body) || body.length === 0) refuse(400, 'VALIDATION');
    if (!Buffer.isBuffer(body)) throw new Error('unreachable');
    const reading = readSheetGrids(body);
    if (!reading.ok) refuse(400, reading.code);
    if (!reading.ok) throw new Error('unreachable');
    const rows = interpretGrids(reading.grids);
    if (rows.length === 0) refuse(409, 'SHEET_EMPTY');
    if (rows.length > SHEET_ROW_CAP) refuse(409, 'SHEET_TOO_BIG');
    return rows;
  };

  const batchCreateQuery = z.object({
    name: z.string().trim().min(1).max(80),
    filename: z.string().trim().max(160).default(''),
  });

  /** Read the sheet and answer what it says — nothing is stored. */
  app.post('/api/batches/preview', { bodyLimit: SHEET_BODY_LIMIT }, (request) => {
    requireBatchUpload(request);
    return { rows: readBatchRows(request.body) };
  });

  /**
   * Approve: the client sends the same bytes again and the same reader reads
   * them — the parser is deterministic, so what was reviewed is what is kept.
   * The name rides the query string because the body is the file itself.
   */
  app.post('/api/batches', { bodyLimit: SHEET_BODY_LIMIT }, (request, reply): BatchDto => {
    const actor = requireBatchUpload(request);
    const query = parseOrRefuse(batchCreateQuery, request.query);
    const rows = readBatchRows(request.body);
    return transaction(db, () => {
      const id = store.insertBatch(db, {
        name: query.name,
        filename: query.filename,
        at: now(),
        createdBy: actorId(actor),
      });
      store.insertBatchRows(db, id, rows);
      void reply.status(201);
      const batch = store.getBatch(db, id);
      if (batch === null) throw new Error('unreachable');
      return batch;
    });
  });

  /**
   * تعديل اسم الكشف — «بدي كمان القدرة على تعديل اسم الكشف». The label,
   * and only the label: whoever may file a دفعة may correct what it is
   * called. Its rows are the customs sheet's own words and stay untouched.
   */
  app.patch('/api/batches/:id', (request): BatchDto => {
    requireBatchUpload(request);
    const id = idParam(request);
    const body = parseOrRefuse(z.object({ name: z.string().trim().min(1).max(80) }), request.body);
    return transaction(db, () => {
      if (store.getBatch(db, id) === null) refuse(404, 'NOT_FOUND');
      store.renameBatch(db, id, body.name);
      const batch = store.getBatch(db, id);
      if (batch === null) throw new Error('unreachable');
      return batch;
    });
  });

  /** The gate's live question while a number is being typed. */
  app.get('/api/batches/lookup', (request): { match: BatchMatch | null } => {
    requireBatchUpload(request);
    const query = parseOrRefuse(
      z.object({ number: z.string().trim().min(1).max(20) }),
      request.query,
    );
    return { match: store.lookupOpenBatchRow(db, normalizeNumber(query.number)) };
  });

  app.get('/api/batches', (request): { batches: BatchSummaryDto[] } => {
    requireBatchView(request);
    return { batches: store.listBatches(db) };
  });

  app.get('/api/batches/:id', (request): BatchDto => {
    requireBatchView(request);
    const id = idParam(request);
    const batch = store.getBatch(db, id);
    if (batch === null) refuse(404, 'NOT_FOUND');
    if (batch === null) throw new Error('unreachable');
    return batch;
  });

  /** Striking a sheet from the registry is the owner's, like every walk-back. */
  app.delete('/api/batches/:id', (request) => {
    requireOwner(request);
    const id = idParam(request);
    return transaction(db, () => {
      if (store.getBatch(db, id) === null) refuse(404, 'NOT_FOUND');
      store.softDeleteBatch(db, id, now());
      return { ok: true };
    });
  });

  // ─── نداء إدخال شاحنة: الآلية تنادي البوابة ──────────────────────────────

  /**
   * The driver presses once; every gate hand sees it until one of them
   * answers. One pending call per machine — «كبسة ادخال الشاحنة» pressed
   * twice is the same truck, not two.
   */
  app.post('/api/gate-calls', (request, reply) => {
    const actor = requireAuth(request);
    if (actor.machine === '') refuse(403, 'FORBIDDEN');
    // «على كل حاوية»: the call may name the very task it is for, so the
    // banner at the gate reads which truck to admit and for which box. The
    // body stays optional — the bare call is still the truck that arrived
    // before any paperwork names it.
    const body = parseOrRefuse(
      z.object({ taskId: z.number().int().positive().optional() }),
      request.body ?? {},
    );
    return transaction(db, () => {
      if (body.taskId !== undefined) {
        const task = store.getTask(db, body.taskId);
        if (task === null) refuse(404, 'NOT_FOUND');
        if (task === null) throw new Error('unreachable');
        // A driver calls for his own machine's work alone, and a task
        // already finished has no truck left to admit.
        if (task.machine !== actor.machine) refuse(403, 'FORBIDDEN');
        if (task.status !== 'PENDING') refuse(409, 'TASK_CLOSED');
        const twice = store.pendingGateCallForTask(db, body.taskId);
        if (twice !== null) return twice;
      }
      const standing = body.taskId === undefined ? store.pendingGateCall(db, actor.machine) : null;
      if (standing !== null) return standing;
      const id = store.insertGateCall(db, {
        at: now(),
        byId: actorId(actor),
        machine: actor.machine,
        taskId: body.taskId ?? null,
      });
      void reply.status(201);
      const call = store.getGateCall(db, id);
      if (call === null) throw new Error('unreachable');
      return call;
    });
  });

  /** The office watches this; the driver watches his own call's answer. */
  app.get('/api/gate-calls', (request) => {
    const actor = requireAuth(request);
    if (actor.machine === '' && !canRunTasks(actor)) refuse(403, 'FORBIDDEN');
    const query = request.query as { status?: string };
    const status = query.status === 'DONE' ? ('DONE' as const) : ('PENDING' as const);
    const rows = store.listGateCalls(db, status);
    return {
      calls: actor.machine === '' ? rows : rows.filter((row) => row.machine === actor.machine),
    };
  });

  /** «دخلتها»: the clerk answers, and the banner goes out on every screen. */
  app.post('/api/gate-calls/:id/done', (request) => {
    const actor = requireAuth(request);
    if (!canRunTasks(actor)) refuse(403, 'FORBIDDEN');
    const id = idParam(request);
    return transaction(db, () => {
      const call = store.getGateCall(db, id);
      if (call === null) refuse(404, 'NOT_FOUND');
      if (call === null) throw new Error('unreachable');
      if (call.status !== 'PENDING') refuse(409, 'TASK_CLOSED');
      store.answerGateCall(db, id, now(), actorId(actor));
      return store.getGateCall(db, id);
    });
  });

  app.post('/api/logout', (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /**
   * The map: everything on the ground — the boxes awaiting their truck
   * included, because they still stand in their slots until loaded.
   */
  app.get('/api/state', (request): YardStateDto => {
    requireAuth(request);
    return { containers: store.listInYard(db) };
  });

  /**
   * A number already on the ground is refused by its own cause: a box still
   * standing, or — «بانتظار التحميل» — one whose exit card is written and that
   * waits in its slot for its truck. That one is not free to come back in
   * until its loading is confirmed, and the refusal says so.
   */
  const refuseNumberOnGround = (holder: ContainerDto, number: string): never =>
    refuse(409, holder.exitedAt === null ? 'NUMBER_IN_YARD' : 'NUMBER_AWAITING_LOAD', { number });

  /**
   * A landing the rules refuse. OCCUPIED by a box awaiting its truck says so
   * by name: that slot frees the moment the box is confirmed loaded, so the
   * remedy is that confirmation — or another slot — and not a hunt for
   * whoever "stands" there. The holder is the refusal's own `other`, matched
   * to the waiting box in the target's column: a box that came down a tier
   * in a move's projection is still in that column. The shared rules stay
   * pure and unaware of paper; the server alone reads it.
   */
  const refuseLanding = (refusal: RuleRefusal, to: Position): never => {
    if (refusal.code === 'OCCUPIED' && refusal.other !== undefined) {
      const span = baySpan(to.bay);
      const holder = store
        .listAwaitingLoad(db)
        .find(
          (box) =>
            box.number === refusal.other &&
            box.position !== null &&
            box.position.zone === to.zone &&
            box.position.stack === to.stack &&
            baySpan(box.position.bay).some((bay) => span.includes(bay)),
        );
      if (holder !== undefined) refuse(409, 'SLOT_AWAITING_LOAD', { other: holder.number });
    }
    return refuseRule(refusal);
  };

  app.post('/api/containers', (request, reply) => {
    const actor = requirePerm(request, 'GATE_IN');
    const body = parseOrRefuse(gateInSchema, request.body);
    const check = checkNumber(body.number);

    return transaction(db, () => {
      // The same number may return for a new visit, but cannot stand twice at
      // once — and a box whose exit card is written still stands until it is
      // loaded, so its number is not free to come back in before that.
      const duplicate = store.findStandingByNumber(db, check.normalized);
      if (duplicate !== null) refuseNumberOnGround(duplicate, check.normalized);

      const standing = store.listStanding(db);
      const refusal = canPlace(layoutNow(), standing, body.size, body.position);
      if (refusal !== null) refuseLanding(refusal, body.position);

      const at = now();
      // The serial counts within the Amman year of this very moment, and the
      // year rides along with it: come January the count starts at 1 again.
      const year = ammanYear(at);
      const id = store.insertContainer(db, {
        number: check.normalized,
        numberValid: check.valid,
        size: body.size,
        bill: body.bill,
        billKind: body.billKind,
        notes: body.notes,
        position: body.position,
        at,
        weight: body.weight,
        handling: body.handling,
        truckIn: body.truck,
        driverIn: body.driver,
        sealIn: body.seal,
        cardIn: store.nextCardNumber(db, 'in', year),
        cardInYear: year,
      });
      store.recordMovement(db, id, 'IN', at, null, body.position, '', actorId(actor));
      // مهام الآليات: the instant the gate receives, the chosen machine's
      // tablet is told — the WhatsApp photo, replaced.
      store.insertTask(db, {
        kind: 'IN',
        containerId: id,
        machine: body.handling,
        at,
        createdBy: actorId(actor),
        position: body.position,
      });
      void reply.status(201);
      return store.getContainer(db, id);
    });
  });

  /**
   * A container that is on the ground — the GROUND test, so a box awaiting
   * its truck passes: it may still be moved while it waits, because the
   * machine may truly shift it. Routes for which the paper matters (a second
   * exit, a تجهيز) add their own `exitedAt` test.
   */
  const standingContainer = (id: number): { dto: ContainerDto; position: Position } => {
    const dto = store.getContainer(db, id);
    if (dto === null) refuse(404, 'NOT_FOUND');
    if (dto === null) throw new Error('unreachable');
    if (dto.position === null) refuse(409, 'ALREADY_OUT');
    if (dto.position === null) throw new Error('unreachable');
    return { dto, position: dto.position };
  };

  /**
   * Gravity, written down. Whatever was resting on the container that just
   * left comes down one tier — lowest first — and each descent is its own
   * `DROP` movement carrying the number of the container that caused it, so
   * the log never claims a member of staff carried a box they never touched.
   * `bySystem`: no person's act caused it — the 24-hour loading clock.
   */
  const settleAbove = (
    descents: readonly Descent[],
    at: string,
    cause: string,
    userId: number | null,
    bySystem = false,
  ): void => {
    for (const descent of descents) {
      store.setPosition(db, descent.container.id, descent.to);
      store.recordMovement(
        db,
        descent.container.id,
        'DROP',
        at,
        descent.container.position,
        descent.to,
        cause,
        userId,
        null,
        bySystem,
      );
    }
  };

  /** The lift plan for a standing container, refusing if the stack cannot fall. */
  const liftPlan = (standing: readonly Standing[], mover: Standing): readonly Descent[] => {
    const plan = planRemoval(layoutNow(), standing, mover);
    if (!plan.ok) refuseRule(plan.refusal);
    if (!plan.ok) throw new Error('unreachable');
    return plan.descents;
  };

  /**
   * «تأكيد التحميل» — the second half of an exit. The exit card was written
   * while the box still stood in its slot; this is the lift onto the truck:
   * the box leaves the ground and whatever rested on it comes down a tier,
   * each descent its own DROP, exactly as the exit itself used to do.
   *
   * Three hands may confirm it, whichever comes first: the machine driver's
   * «تم» on the loading task (TASK), the office's «تم التحميل» (DESK), and
   * the 24-hour clock (SWEEP). Gravity is planned from the LIVE slot — the
   * box may have been shifted while it waited — and a box carried away from
   * the slot its exit card names has that departure rewritten to where it
   * truly left from, so «إلغاء الخروج» and the registers name the true slot.
   *
   * A blocked descent (a 40 lying across two 20s, one of them waiting) is
   * refused at the desk, which can act on the sentence; the driver's «تم»
   * and the clock leave the box waiting in its slot instead, and nothing is
   * broken. Runs inside the caller's transaction; answers whether it loaded.
   */
  const confirmLoading = (
    id: number,
    at: string,
    userId: number | null,
    how: 'TASK' | 'DESK' | 'SWEEP',
  ): boolean => {
    const dto = store.getContainer(db, id);
    if (dto === null) refuse(404, 'NOT_FOUND');
    if (dto === null) throw new Error('unreachable');
    const position = dto.position;
    if (dto.exitedAt === null || dto.loadedAt !== null || position === null) {
      refuse(409, 'NOT_AWAITING_LOAD');
    }
    if (position === null) throw new Error('unreachable');

    const plan = planRemoval(layoutNow(), store.listStanding(db), {
      id,
      number: dto.number,
      size: dto.size,
      position,
    });
    if (!plan.ok) {
      if (how === 'DESK') refuseRule(plan.refusal);
      return false;
    }

    const bySystem = how === 'SWEEP';
    store.markLoaded(db, id, at);
    settleAbove(plan.descents, at, dto.number, userId, bySystem);
    const departure = store.lastExitMovementId(db, id);
    const leftFrom = departure === null ? null : (store.getMovement(db, departure)?.from ?? null);
    if (departure !== null && (leftFrom === null || !samePosition(leftFrom, position))) {
      store.refromMovement(db, departure, position);
    }
    // The task whose own «تم» did this is already closed under its driver's
    // name — that is his work. Anything else still asking is answered.
    store.closePendingTasks(db, id, 'OUT', at, userId, 'AUTO_LOADED', bySystem);
    return true;
  };

  /**
   * A machine's «تم» on an exit task whose box is awaiting its truck IS the
   * loading. Anything else — an entry task, a تجهيز answered before the exit
   * was written — closes as it always did and loads nothing.
   */
  const loadOnTaskDone = (task: TaskDto, at: string, userId: number | null): void => {
    if (task.kind !== 'OUT') return;
    const box = store.getContainer(db, task.containerId);
    if (box === null || box.exitedAt === null || box.loadedAt !== null || box.position === null) {
      return;
    }
    confirmLoading(box.id, at, userId, 'TASK');
  };

  app.decorate('sweepLoading', (nowIso?: string): number => {
    const at = nowIso ?? now();
    const due = Date.parse(at) - LOADING_GRACE_MS;
    let loaded = 0;
    for (const box of store.listAwaitingLoad(db)) {
      // Compared as instants, not as text: an exit date corrected by hand
      // may carry an offset of its own.
      const exited = box.exitedAt === null ? Number.NaN : Date.parse(box.exitedAt);
      if (!(exited <= due)) continue;
      try {
        // One box, one transaction: a box that cannot come down yet stays
        // waiting and never holds the others back.
        if (transaction(db, () => confirmLoading(box.id, at, null, 'SWEEP'))) loaded += 1;
      } catch (error) {
        console.error(`[loading] ${box.number}`, error);
      }
    }
    return loaded;
  });

  app.post('/api/containers/:id/move', (request) => {
    const actor = requirePerm(request, 'MOVE');
    const id = idParam(request);
    const body = parseOrRefuse(z.object({ to: positionSchema }), request.body);

    return transaction(db, () => {
      const { dto, position } = standingContainer(id);
      const standing = store.listStanding(db);
      const mover = { id, number: dto.number, size: dto.size, position };
      // The lift AND the landing — and the landing is judged against the yard
      // as it stands AFTER the stack above has come down.
      const refusal = canMove(layoutNow(), standing, mover, body.to);
      if (refusal !== null) refuseLanding(refusal, body.to);
      const descents = liftPlan(standing, mover);

      const at = now();
      store.setPosition(db, id, body.to);
      // What the lift brings down travels ON the movement itself, so the card
      // can be reprinted months later and still say what it said that day.
      // Written only when something actually came down.
      const note =
        descents.length === 0
          ? ''
          : JSON.stringify({
              d: descents.map((descent) => ({
                n: descent.container.number,
                f: positionLabel(descent.container.position),
                t: positionLabel(descent.to),
              })),
            });
      const year = ammanYear(at);
      const movementId = store.recordMovement(
        db,
        id,
        'MOVE',
        at,
        position,
        body.to,
        note,
        actorId(actor),
        { serial: store.nextMoveCardNumber(db, year), year },
      );
      settleAbove(descents, at, dto.number, actorId(actor));
      // The card is handed back with the container: its serial is minted here,
      // so nothing on the screen could know it otherwise.
      return { container: store.getContainer(db, id), move: store.getMovement(db, movementId) };
    });
  });

  /**
   * النقل الجماعي — «بدي انقل كمية من الحاويات مره وحده»: a group and one
   * destination bay; the shared planner works out the lift order (roofs
   * first, as a crane must) and the landings (ground up, stack by stack),
   * and every container still gets a numbered MOVE of its own. All or
   * nothing: a destination that takes only part refuses by the count.
   */
  app.post('/api/containers/move-many', (request) => {
    const actor = requirePerm(request, 'MOVE');
    const body = parseOrRefuse(
      z.object({
        ids: z.array(z.number().int().min(1)).min(1).max(60),
        to: z.object({
          zone: z.string().regex(/^[A-Z]{1,2}$/),
          bay: z.number().int().min(1).max(99),
        }),
      }),
      request.body,
    );
    if (new Set(body.ids).size !== body.ids.length) refuse(400, 'VALIDATION');

    return transaction(db, () => {
      // Each id must be a standing container — refused one by one, by name.
      const before = new Map(body.ids.map((id) => [id, standingContainer(id)]));
      const standing = store.listStanding(db);
      const plan = planGroupMove(layoutNow(), standing, body.ids, {
        zone: body.to.zone as Zone,
        bay: body.to.bay,
      });
      if (!plan.ok) {
        refuse(
          409,
          plan.code,
          plan.other !== undefined && plan.other !== ''
            ? { other: plan.other }
            : plan.fit !== undefined
              ? { fit: plan.fit, total: plan.total ?? body.ids.length }
              : undefined,
        );
      }
      if (!plan.ok) throw new Error('unreachable');

      const at = now();
      const year = ammanYear(at);
      for (const step of plan.steps) {
        const from = before.get(step.id)?.position ?? null;
        store.setPosition(db, step.id, step.to);
        store.recordMovement(db, step.id, 'MOVE', at, from, step.to, '', actorId(actor), {
          serial: store.nextMoveCardNumber(db, year),
          year,
        });
      }
      return { moved: plan.steps.length };
    });
  });

  /**
   * تسجيل الخروج — the exit CARD. «بانتظار التحميل»: the office writes the
   * exit first because it needs the printed card while the box still stands
   * on the ground, so the paper is written exactly as it always was — the
   * year's serial, the truck, the driver, the OUT movement at this instant
   * from the slot it stands in — and the box KEEPS its slot. Nothing above it
   * comes down yet: it leaves the ground when its loading is confirmed.
   */
  app.post('/api/containers/:id/exit', (request) => {
    const actor = requirePerm(request, 'GATE_OUT');
    const id = idParam(request);
    const gate = parseOrRefuse(gateOutSchema, request.body);

    return transaction(db, () => {
      const { dto, position } = standingContainer(id);
      // Its card is already written; it is only waiting for its truck.
      if (dto.exitedAt !== null) refuse(409, 'ALREADY_OUT');
      // A buried container does not refuse to leave: whatever stands on it
      // will come down a tier when it is lifted. But a lift that would leave
      // a box with no landing is refused NOW, at the card, exactly as before
      // — not a day later at the truck.
      liftPlan(store.listStanding(db), { id, number: dto.number, size: dto.size, position });
      const at = now();
      const year = ammanYear(at);
      store.markExited(db, id, at, {
        truck: gate.truck,
        driver: gate.driver,
        cardOut: store.nextCardNumber(db, 'out', year),
        cardOutYear: year,
      });
      store.recordMovement(db, id, 'OUT', at, position, null, '', actorId(actor));
      // The queue follows the gate: a stale entry task dies with the visit.
      // A pending تجهيز is NOT answered by the card any more — it becomes
      // the loading task, and its driver's «تم» is what lifts the box off
      // the ground. If NO تجهيز is pending, the loading task is born right
      // here — already pending, carrying the truck and the slot the box
      // stands in, so nothing is ever missed. It goes to the machine the
      // clerk named at the gate, and only failing that to the one that
      // unloaded it: the yard's two machines take turns.
      store.closePendingTasks(db, id, 'IN', at, actorId(actor), 'AUTO_EXIT');
      const outMachine = gate.machine ?? dto.handling;
      if (!store.pendingTaskExists(db, id, 'OUT') && outMachine !== null) {
        store.insertTask(db, {
          kind: 'OUT',
          containerId: id,
          machine: outMachine,
          at,
          createdBy: actorId(actor),
          position,
          truck: gate.truck,
        });
      }
      return store.getContainer(db, id);
    });
  });

  /**
   * «تم التحميل» من المكتب — the office confirms that a box awaiting its
   * truck has been lifted onto it, for whoever may write the exit itself. A
   * box that is not waiting — still standing with no card, or already gone —
   * is refused by name; a lift that would leave a box above with no landing
   * is refused with that box named, so the clerk knows what to move first.
   */
  app.post('/api/containers/:id/loaded', (request) => {
    const actor = requirePerm(request, 'GATE_OUT');
    const id = idParam(request);
    return transaction(db, () => {
      confirmLoading(id, now(), actorId(actor), 'DESK');
      return store.getContainer(db, id);
    });
  });

  // ---- مهام الآليات — the machine task queue --------------------------------

  /**
   * تجهيز للإخراج: the clerk tells a machine to fetch a standing container
   * to the gate BEFORE the exit is recorded — the owner's chosen exit model.
   * The machine defaults to what unloaded the box; the clerk may override
   * (a broken crane hands its work to the straddle).
   */
  app.post('/api/tasks/prepare', (request, reply) => {
    const actor = requirePerm(request, 'GATE_OUT');
    const body = parseOrRefuse(prepareSchema, request.body);
    return transaction(db, () => {
      const { dto, position } = standingContainer(body.containerId);
      // A box whose card is written already has its loading task — the
      // exit's own, or the تجهيز that became it.
      if (dto.exitedAt !== null) refuse(409, 'ALREADY_OUT');
      if (store.pendingTaskExists(db, dto.id, 'OUT')) refuse(409, 'TASK_EXISTS');
      const machine = body.machine ?? dto.handling;
      if (machine === null) refuse(400, 'VALIDATION', { field: 'machine' });
      if (machine === null) throw new Error('unreachable');
      const id = store.insertTask(db, {
        kind: 'OUT',
        containerId: dto.id,
        machine,
        at: now(),
        createdBy: actorId(actor),
        position,
      });
      void reply.status(201);
      return store.getTask(db, id);
    });
  });

  /**
   * «بنخرجها دفعة وحده البوليصة كاملة»: one تجهيز for the whole bill — a
   * task per standing container, skipping any that already has one pending.
   * A box whose exit card is written is not standing here, though it waits
   * on the ground: its loading task already exists.
   */
  app.post('/api/tasks/prepare-bill', (request, reply) => {
    const actor = requirePerm(request, 'GATE_OUT');
    const body = parseOrRefuse(prepareBillSchema, request.body);
    return transaction(db, () => {
      const standing = store
        .listByBill(db, body.bill)
        .filter((container) => container.position !== null && container.exitedAt === null);
      if (standing.length === 0) refuse(404, 'NOT_FOUND');
      // All-or-nothing on the machine question: a row that names no machine
      // and gets no override would route nowhere, so the batch refuses whole.
      if (body.machine === undefined && standing.some((c) => c.handling === null)) {
        refuse(400, 'VALIDATION', { field: 'machine' });
      }
      const at = now();
      let created = 0;
      let skipped = 0;
      for (const container of standing) {
        if (store.pendingTaskExists(db, container.id, 'OUT')) {
          skipped += 1;
          continue;
        }
        const machine = body.machine ?? container.handling;
        if (machine === null) continue; // unreachable after the check above
        store.insertTask(db, {
          kind: 'OUT',
          containerId: container.id,
          machine,
          at,
          createdBy: actorId(actor),
          position: container.position,
        });
        created += 1;
      }
      void reply.status(201);
      return { created, skipped };
    });
  });

  /** «تم» — the driver's own hand, or the desk closing a task for him. */
  /**
   * «تحديد الكل ثم تم»: the desk closes many at once — a shift's finished
   * work in one press. A task already closed is skipped and counted, not
   * refused: the screen may be one poll behind the tablets. An exit task
   * among them whose box awaits its truck loads it, as a single «تم» does.
   */
  app.post('/api/tasks/done-many', (request) => {
    const actor = requireAuth(request);
    if (!canRunTasks(actor)) refuse(403, 'FORBIDDEN');
    const body = parseOrRefuse(
      z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }),
      request.body,
    );
    return transaction(db, () => {
      const at = now();
      let done = 0;
      let skipped = 0;
      for (const id of new Set(body.ids)) {
        const task = store.getTask(db, id);
        if (task === null || task.status !== 'PENDING') {
          skipped += 1;
          continue;
        }
        store.setTaskDone(db, id, at, actorId(actor));
        loadOnTaskDone(task, at, actorId(actor));
        done += 1;
      }
      return { done, skipped };
    });
  });

  /**
   * «تم» on an exit task whose box awaits its truck is the loading itself:
   * the box leaves the map and what stood on it comes down. When it cannot
   * come down yet (a 40 across two 20s), the «تم» is still the driver's, the
   * task closes under his name, and the box simply waits in its slot.
   */
  app.post('/api/tasks/:id/done', (request) => {
    const actor = requireAuth(request);
    const id = idParam(request);
    return transaction(db, () => {
      const task = store.getTask(db, id);
      if (task === null) refuse(404, 'NOT_FOUND');
      if (task === null) throw new Error('unreachable');
      if (!canRunTasks(actor) && actor.machine !== task.machine) refuse(403, 'FORBIDDEN');
      if (task.status !== 'PENDING') refuse(409, 'TASK_CLOSED');
      const at = now();
      store.setTaskDone(db, id, at, actorId(actor));
      loadOnTaskDone(task, at, actorId(actor));
      return store.getTask(db, id);
    });
  });

  /** «مستعجل»: the desk pushes a task to the head of the machine's queue. */
  app.post('/api/tasks/:id/urgent', (request) => {
    const actor = requireAuth(request);
    if (!canRunTasks(actor)) refuse(403, 'FORBIDDEN');
    const id = idParam(request);
    const body = parseOrRefuse(z.object({ urgent: z.boolean() }), request.body);
    return transaction(db, () => {
      const task = store.getTask(db, id);
      if (task === null) refuse(404, 'NOT_FOUND');
      if (task === null) throw new Error('unreachable');
      if (task.status !== 'PENDING') refuse(409, 'TASK_CLOSED');
      store.setTaskUrgent(db, id, body.urgent);
      return store.getTask(db, id);
    });
  });

  /**
   * تحويل المهمة بين الآليتين — «ممكن اودي الحاوية من الونش للعقرب»: a
   * breakdown hands the work over. Re-routing an IN task also rewrites the
   * container's المناولة (the entry card prints what actually unloaded it)
   * and says so in the log, exactly as an edit would.
   */
  app.post('/api/tasks/:id/machine', (request) => {
    const actor = requireAuth(request);
    if (!canRunTasks(actor)) refuse(403, 'FORBIDDEN');
    const id = idParam(request);
    const body = parseOrRefuse(z.object({ machine: machineSchema }), request.body);
    return transaction(db, () => {
      const task = store.getTask(db, id);
      if (task === null) refuse(404, 'NOT_FOUND');
      if (task === null) throw new Error('unreachable');
      if (task.status !== 'PENDING') refuse(409, 'TASK_CLOSED');
      store.setTaskMachine(db, id, body.machine);
      if (task.kind === 'IN' && task.machine !== body.machine) {
        const before = store.getContainer(db, task.containerId);
        store.setHandling(db, task.containerId, body.machine);
        store.recordMovement(
          db,
          task.containerId,
          'EDIT',
          now(),
          null,
          null,
          JSON.stringify({ k: ['handling'], b: { handling: before?.handling ?? '' } }),
          actorId(actor),
        );
      }
      return store.getTask(db, id);
    });
  });

  /**
   * The queue itself. A driver is FORCED onto their own machine's list —
   * the parameter is ignored; the desks and the registers see everything.
   */
  app.get('/api/tasks', (request) => {
    const actor = requireAuth(request);
    const query = request.query as { machine?: string; status?: string; limit?: string };
    let machine: (typeof HANDLING)[number] | undefined;
    if (actor.machine !== '') {
      machine = actor.machine;
    } else {
      if (!canRunTasks(actor) && !actor.permissions.includes('REPORTS')) {
        refuse(403, 'FORBIDDEN');
      }
      if (query.machine !== undefined) {
        const parsed = machineSchema.safeParse(query.machine);
        if (!parsed.success) refuse(400, 'VALIDATION', { field: 'machine' });
        machine = parsed.success ? parsed.data : undefined;
      }
    }
    if (query.status !== undefined && query.status !== 'PENDING' && query.status !== 'DONE') {
      refuse(400, 'VALIDATION', { field: 'status' });
    }
    const status = query.status === 'DONE' ? ('DONE' as const) : ('PENDING' as const);
    const limit =
      query.limit === undefined ? undefined : Math.max(1, Math.trunc(Number(query.limit)) || 1);
    return { tasks: store.listTasks(db, { machine, status, limit }) };
  });

  app.patch('/api/containers/:id', (request) => {
    const actor = requirePerm(request, 'EDIT');
    const id = idParam(request);
    const body = parseOrRefuse(editSchema, request.body);

    return transaction(db, () => {
      const existing = store.getContainer(db, id);
      if (existing === null) refuse(404, 'NOT_FOUND');
      if (existing === null) throw new Error('unreachable');

      const check = checkNumber(body.number);

      // Renaming to a number that is standing elsewhere would put one number
      // in two places on the map — a GROUND question, so a box awaiting its
      // truck counts on either side, and a clash with one is named as such.
      if (check.normalized !== existing.number && existing.position !== null) {
        const duplicate = store.findStandingByNumber(db, check.normalized);
        if (duplicate !== null && duplicate.id !== id) {
          refuseNumberOnGround(duplicate, check.normalized);
        }
      }

      // THE CLASS IS NOT A FIELD OF THIS FORM, and never was: the bay's
      // parity IS the class, so writing one here without an address would
      // make a 40 that lives at an odd bay. It is corrected on the map, by
      // «تصحيح الفئة», which names the bay and derives the class from it.
      // Keeping the refusal here is what makes the corrupt state unreachable
      // — through the form, through the wire type, and through the undo
      // button in the log.
      if (body.size !== existing.size) refuse(409, 'SIZE_LOCKED');

      // The exit paperwork only exists once there has been an exit; offering
      // it on a standing container would invent a departure that never was.
      // Judged by the PAPER: a box awaiting its truck has its card, so it is
      // edited exactly like a departed one — and its OUT is retimed with it.
      const stillStanding = existing.exitedAt === null;
      const exitFields = [body.truckOut, body.driverOut];
      if (stillStanding && (body.exitedAt !== null || exitFields.some((v) => v !== ''))) {
        refuse(409, 'EXIT_ON_STANDING');
      }
      // Once it has left, its exit paperwork is as mandatory as its entry's —
      // the driver's name excepted, which is optional in both directions.
      if (!stillStanding && (body.exitedAt === null || body.truckOut === '')) {
        refuse(409, 'EXIT_PAPERS_MISSING');
      }

      // A container cannot leave before it arrived, and neither instant may
      // be in the future — both would poison the dwell arithmetic and put the
      // row in a register period that has not happened yet.
      const entered = Date.parse(body.enteredAt);
      const exited = body.exitedAt === null ? null : Date.parse(body.exitedAt);
      const horizon = Date.now() + 60_000;
      if (entered > horizon || (exited !== null && exited > horizon)) refuse(409, 'TIME_IN_FUTURE');
      if (exited !== null && exited < entered) refuse(409, 'EXIT_BEFORE_ENTRY');

      const changed: string[] = [];
      const before: Record<string, string | number> = {};
      const diff = (key: string, next: string | number, was: string | number): void => {
        if (next === was) return;
        changed.push(key);
        before[key] = was;
      };

      diff('number', check.normalized, existing.number);
      diff('bill', body.bill, existing.bill);
      // Unmentioned means untouched — never wiped.
      const billKind = body.billKind === undefined ? existing.billKind : body.billKind;
      diff('billKind', billKind ?? '', existing.billKind ?? '');
      diff('notes', body.notes, existing.notes);
      diff('weight', body.weight, existing.weight);
      diff('handling', body.handling ?? '', existing.handling ?? '');
      diff('truckIn', body.truckIn, existing.truckIn);
      diff('driverIn', body.driverIn, existing.driverIn);
      diff('sealIn', body.sealIn, existing.sealIn);
      diff('truckOut', body.truckOut, existing.truckOut);
      diff('driverOut', body.driverOut, existing.driverOut);
      // THE GATE DATES ARE COMPARED BY THE CLOCK, NOT BY THE TEXT. The form
      // shows them to the minute, so what it hands back for a field nobody
      // touched is the same minute with the seconds shaved off — a different
      // string every time. Compared raw, EVERY edit "changed" the entry date:
      // the IN movement was retimed under the register and the year's card
      // serials re-seated, all for a note. «عند التعديل يجب ان لا يغير تاريخ
      // دخول الحاوية في السجل».
      const sameMinute = (a: string | null, b: string | null): boolean =>
        a === b || (a !== null && b !== null && toLocalStamp(a) === toLocalStamp(b));
      if (!sameMinute(body.enteredAt, existing.enteredAt)) {
        diff('enteredAt', body.enteredAt, existing.enteredAt);
      }
      if (!sameMinute(body.exitedAt, existing.exitedAt)) {
        diff('exitedAt', body.exitedAt ?? '', existing.exitedAt ?? '');
      }

      if (changed.length > 0) {
        store.updateContainer(db, id, {
          number: check.normalized,
          numberValid: check.valid,
          bill: body.bill,
          billKind,
          size: body.size,
          notes: body.notes,
          weight: body.weight,
          handling: body.handling,
          truckIn: body.truckIn,
          driverIn: body.driverIn,
          sealIn: body.sealIn,
          truckOut: body.truckOut,
          driverOut: body.driverOut,
          // Unchanged to the minute means untouched: the record keeps the
          // instant it already carries, seconds and all.
          enteredAt: changed.includes('enteredAt') ? body.enteredAt : existing.enteredAt,
          exitedAt: changed.includes('exitedAt') ? body.exitedAt : existing.exitedAt,
        });

        // A corrected gate date has to move the gate movement with it, or the
        // register (which reads movements.at) and the card (which reads
        // entered_at) would place the same container in different weeks.
        if (changed.includes('enteredAt')) store.retimeMovement(db, id, 'IN', body.enteredAt);
        if (changed.includes('exitedAt') && body.exitedAt !== null) {
          store.retimeMovement(db, id, 'OUT', body.exitedAt);
        }
        // The card serial does NOT follow the corrected date. A serial is the
        // order the paper was ISSUED in, and that paper is already in a
        // driver's hand: re-seating it would hand its number to a different
        // container — «ما بدي حدا يوخذ مكانها».

        // The note carries machine keys AND the old values, so the log can
        // both name the change in Arabic and undo it later.
        store.recordMovement(
          db,
          id,
          'EDIT',
          now(),
          null,
          null,
          JSON.stringify({ k: changed, b: before }),
          actorId(actor),
        );
      }
      return store.getContainer(db, id);
    });
  });

  /**
   * An exit taken back. A gate is worked by a person, at night, beside a
   * running engine — «قد يكون الخطأ وارد» — and until now a container marked
   * out by mistake could not be brought back at all: its record froze.
   *
   * Its own slot is only the DEFAULT. Whatever stood on it came down a tier
   * as it left, so that seat is often gone — «لا توجد حاوية مسنِدة تحتها في
   * الطابق الأدنى» was the refusal the owner kept meeting, and a yard that
   * has moved on should not make a clerk undo an hour of real work to take
   * back one wrong tap. So the clerk may name where it lands: «اريد عند
   * الغاء الخروج ان يختار مدخل البيانات المكان الذي سوف يعيده فيها». The
   * named slot is checked by exactly the same rules as any landing.
   *
   * «بانتظار التحميل»: a box whose card is written but which was never
   * loaded has not moved at all, so its exit is cancelled IN PLACE — only the
   * paper goes, and it stands on in the slot it never left. A slot named for
   * such a box is refused unless it is that very slot: carrying it elsewhere
   * is a move, with a move card of its own, not a footnote to a cancelled
   * exit. A box already loaded comes back exactly as it always did.
   */
  app.post('/api/containers/:id/unexit', (request) => {
    const actor = requirePerm(request, 'GATE_OUT');
    const id = idParam(request);
    const body = parseOrRefuse(
      z.object({ position: positionSchema.optional() }),
      request.body ?? {},
    );

    return transaction(db, () => {
      const existing = store.getContainer(db, id);
      if (existing === null) refuse(404, 'NOT_FOUND');
      if (existing === null) throw new Error('unreachable');
      if (existing.exitedAt === null) refuse(409, 'NOT_EXITED');

      const waitingAt = existing.position;
      let wasAt: Position;
      if (waitingAt !== null) {
        if (body.position !== undefined && !samePosition(body.position, waitingAt)) {
          refuse(400, 'VALIDATION', { field: 'position' });
        }
        wasAt = waitingAt;
      } else {
        const named = body.position ?? store.lastExitPosition(db, id);
        if (named === null) refuse(409, 'BAD_SLOT');
        if (named === null) throw new Error('unreachable');
        // The slot must fit the class the record now carries — the bay's
        // parity IS the class, here as everywhere else on this ground.
        if (sizeOfBay(named.bay) !== existing.size) refuse(409, 'RETURN_SIZE_CHANGED');
        const refusal = canPlace(layoutNow(), store.listStanding(db), existing.size, named);
        if (refusal !== null) refuseLanding(refusal, named);
        wasAt = named;
      }

      store.cancelExit(db, id, wasAt);
      const returnedAt = now();
      store.recordMovement(db, id, 'RETURN', returnedAt, null, wasAt, '', actorId(actor));
      // An exit-born task that nobody finished is void with the exit itself.
      store.closePendingTasks(db, id, null, returnedAt, actorId(actor), 'AUTO_RETURN');
      // The voided exit card leaves a hole in the year, and the hole stays.
      // Its number was printed once and belongs to nobody else.
      return store.getContainer(db, id);
    });
  });

  /** Undo a deletion: the record returns, standing where it stood if it can. */
  app.post('/api/containers/:id/restore', (request) => {
    // The owner's alone. Striking out a record is an employee's business;
    // reaching into the log and undoing what is written there is not.
    const actor = requireOwner(request);
    const id = idParam(request);

    return transaction(db, () => {
      const existing = store.getContainerAny(db, id);
      if (existing === null) refuse(404, 'NOT_FOUND');
      if (existing === null) throw new Error('unreachable');
      if (!existing.deleted) refuse(409, 'NOT_DELETED');

      // A box struck while it awaited its truck comes back awaiting it: its
      // card is untouched by the strike, and so is the clock that clears it.
      const wasAt = store.lastDeletePosition(db, id);
      if (wasAt !== null) {
        if (sizeOfBay(wasAt.bay) !== existing.size) refuse(409, 'RETURN_SIZE_CHANGED');
        const refusal = canPlace(layoutNow(), store.listStanding(db), existing.size, wasAt);
        if (refusal !== null) refuseLanding(refusal, wasAt);
      }
      store.restoreContainer(db, id, wasAt);

      // It keeps the serial it always had — nothing could have taken it, since
      // the count climbs PAST a struck-out record rather than into its seat.
      //
      // Except in a book kept under the old rule, where closing a hole moved a
      // live card onto a number a struck-out record still held. Those records
      // exist and cannot be wished away, so a restored one whose number is
      // already on somebody else's card is given a fresh number instead. Only
      // this record moves; every other card stays where it was printed.
      for (const kind of ['in', 'out'] as const) {
        const year = kind === 'in' ? existing.cardInYear : existing.cardOutYear;
        if (year === null || !store.serialClashes(db, id, kind)) continue;
        store.setCardSerial(db, id, kind, store.nextCardNumber(db, kind, year));
      }

      store.recordMovement(db, id, 'RESTORE', now(), null, wasAt, '', actorId(actor));
      return store.getContainer(db, id);
    });
  });

  /** A record that was a mistake. Soft: hidden everywhere, never destroyed. */
  app.delete('/api/containers/:id', (request) => {
    const actor = requirePerm(request, 'DELETE');
    const id = idParam(request);

    return transaction(db, () => {
      const existing = store.getContainer(db, id);
      if (existing === null) refuse(404, 'NOT_FOUND');
      if (existing === null) throw new Error('unreachable');

      // Striking the record empties its slot, so the same gravity applies —
      // without this, deleting a buried container left the one above it
      // standing on air. A box awaiting its truck holds ground like any.
      const position = existing.position;
      const descents =
        position === null
          ? []
          : liftPlan(store.listStanding(db), {
              id,
              number: existing.number,
              size: existing.size,
              position,
            });

      const at = now();
      store.softDelete(db, id, at);
      // The mistake itself goes on the record — audits hide nothing.
      store.recordMovement(db, id, 'DELETE', at, existing.position, null, '', actorId(actor));
      // A struck record asks nothing of any machine; restore does NOT
      // reopen — the clerk sends a fresh تجهيز if one is still wanted.
      store.closePendingTasks(db, id, null, at, actorId(actor), 'AUTO_DELETE');
      settleAbove(descents, at, existing.number, actorId(actor));
      // The gap STAYS. «لو كان عندي 1 2 3 وحذفت 3، الي بدي اجي اضيفها خلص
      // لازم تيجي 4، مو توخذ محل ال 3» — the owner's reversal of his own
      // earlier call. A card printed once is never printed again, so no
      // other card moves and the year simply carries a hole where this
      // record was. `resealed` is kept on the wire and is now always zero.
      return { ok: true, resealed: 0 };
    });
  });

  const rangeSchema = z.object({
    from: z.string().datetime({ offset: true }).or(z.string().datetime()),
    to: z.string().datetime({ offset: true }).or(z.string().datetime()),
  });

  /** كشف حركة الدخول أو الخروج: every gate movement in the range. */
  app.get('/api/reports/gate', (request): { rows: GateReportRow[] } => {
    requirePerm(request, 'REPORTS');
    const query = request.query as { type?: string; from?: string; to?: string };
    if (query.type !== 'IN' && query.type !== 'OUT') refuse(400, 'VALIDATION');
    const range = parseOrRefuse(rangeSchema, { from: query.from, to: query.to });
    const type = query.type === 'IN' ? 'IN' : 'OUT';

    const rows = store.listGateMovements(db, type, range.from, range.to).map(
      (row): GateReportRow => ({
        containerId: row.containerId,
        at: row.at,
        card: row.card,
        cardYear: row.cardYear,
        truck: row.truck,
        driver: row.driver,
        number: row.number,
        weight: row.weight,
        size: row.size,
        bill: row.bill,
        position: row.position,
        seal: row.seal,
        notes: row.notes,
        user: row.user,
        // Calendar days, not elapsed 24-hour blocks: a box that came in last
        // night and left this morning stayed a day, and the yard bills a day.
        // A voided stub is no stay at all.
        dwellDays: type === 'OUT' && row.voided !== true ? daysBetween(row.enteredAt, row.at) : null,
        ...(row.voided === true ? { voided: true } : {}),
      }),
    );
    return { rows };
  });

  /**
   * كشف الحاويات بالساحة: a snapshot of everything standing right now, oldest
   * first — the sheet that answers «مين قاعد طول عمره».
   */
  app.get('/api/reports/standing', (request): { rows: StandingReportRow[] } => {
    requirePerm(request, 'REPORTS');
    const at = now();
    const rows = store.listStandingContainers(db).map(
      (container): StandingReportRow => ({
        containerId: container.id,
        number: container.number,
        size: container.size,
        bill: container.bill,
        position: container.position,
        seal: container.sealIn,
        cardIn: container.cardIn,
        cardInYear: container.cardInYear,
        enteredAt: container.enteredAt,
        weight: container.weight,
        dwellDays: daysBetween(container.enteredAt, at),
        user: container.user,
        notes: container.notes,
      }),
    );
    return { rows };
  });

  /** سجل العمليات: كل شي صار، بما فيه الحذف والسجلات المحذوفة. */
  app.get('/api/reports/log', (request): { rows: LogReportRow[] } => {
    requirePerm(request, 'REPORTS');
    const query = request.query as { from?: string; to?: string };
    const range = parseOrRefuse(rangeSchema, { from: query.from, to: query.to });
    return { rows: store.listOperationsLog(db, range.from, range.to) };
  });

  /**
   * كشف سيارة: كل اللي حملته سيارة وحدة، دخول وخروج — أو، بالناقل، كل ما
   * حملته سيارات ناقل واحد: «اريد كشف سيارات بناءا على الناقل». The carrier's
   * plates are matched by normalized text, so «60-84785» typed at the gate
   * still answers for the truck registered as 84785 under code 60.
   */
  app.get(
    '/api/reports/truck',
    (request): { rows: Array<GateReportRow & { statement: 'IN' | 'OUT' }> } => {
      requirePerm(request, 'REPORTS');
      const query = request.query as {
        truck?: string;
        carrier?: string;
        from?: string;
        to?: string;
      };
      const range = parseOrRefuse(rangeSchema, { from: query.from, to: query.to });

      let source: Array<ReturnType<typeof store.listTruckMovements>[number]>;
      if (query.carrier !== undefined) {
        const carrierId = Number(query.carrier);
        if (!Number.isInteger(carrierId) || carrierId < 1) refuse(400, 'VALIDATION');
        if (store.getCarrier(db, carrierId) === null) refuse(404, 'NOT_FOUND');
        const fleet = store.listTrucks(db).filter((truck) => truck.carrierId === carrierId);
        source = store
          .listGateMovementsBoth(db, range.from, range.to)
          .filter((row) => fleet.some((truck) => plateMatches(truck, row.truck)));
      } else {
        const truck = (query.truck ?? '').trim();
        if (truck.length > 30) refuse(400, 'VALIDATION');
        // No plate and no carrier picked: the register opens on EVERYTHING —
        // every gate movement of the period, both directions — and the reader
        // narrows it with the search box or the filters above.
        source =
          truck === ''
            ? store.listGateMovementsBoth(db, range.from, range.to)
            : store.listTruckMovements(db, truck, range.from, range.to);
      }

      const rows = source.map((row) => ({
        statement: row.type,
        containerId: row.containerId,
        at: row.at,
        card: row.card,
        cardYear: row.cardYear,
        truck: row.truck,
        driver: row.driver,
        number: row.number,
        weight: row.weight,
        size: row.size,
        bill: row.bill,
        position: row.position,
        seal: row.seal,
        notes: row.notes,
        user: row.user,
        dwellDays: null,
      }));
      return { rows };
    },
  );

  /**
   * كشف البوليصة: every container travelling under one bill of lading —
   * the standing ones first with their exact slots, then the departed with
   * their exit dates. No date range: a bill is a group, not a period.
   */
  app.get('/api/reports/bill', (request): { rows: ContainerDto[] } => {
    requirePerm(request, 'REPORTS');
    const query = request.query as { number?: string };
    const bill = (query.number ?? '').trim();
    if (bill.length > 40) refuse(400, 'VALIDATION');
    // No bill typed: the register opens on every container record there is,
    // and the reader narrows it by typing a bill or searching the sheet.
    return { rows: bill === '' ? store.listBillRegister(db) : store.listByBill(db, bill) };
  });

  /**
   * النسخة الاحتياطية بكبسة: a clean snapshot of the whole database, written
   * beside the live file AND handed back as a download — two copies from one
   * tap. VACUUM INTO folds the WAL in, so the snapshot is complete and
   * self-contained. Every signed-in account may take one; putting one BACK
   * is the owner's alone.
   */
  // ------------------------------------------------------------- photos ----

  /** صور الحاوية: whoever may see the yard may see them; adding is EDIT work. */
  app.get('/api/containers/:id/photos', (request) => {
    requireAuth(request);
    const id = idParam(request);
    return { photos: store.listPhotos(db, id) };
  });

  app.post('/api/containers/:id/photos', (request, reply) => {
    // Attaching is gate work as much as office work: the clerk receiving
    // the box photographs its condition, the office adds the WhatsApp ones.
    // Striking a photo out stays EDIT work alone.
    const actor = requireAuth(request);
    if (
      !actor.owner &&
      !actor.permissions.includes('EDIT') &&
      !actor.permissions.includes('GATE_IN')
    )
      refuse(403, 'FORBIDDEN');
    const id = idParam(request);
    const bytes = request.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) refuse(400, 'VALIDATION');
    if (!Buffer.isBuffer(bytes)) throw new Error('unreachable');
    const mime = request.headers['content-type'];
    const isImage = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
    if (!isImage) refuse(400, 'VALIDATION');
    if (!isImage) throw new Error('unreachable');
    return transaction(db, () => {
      if (store.getContainer(db, id) === null) refuse(404, 'NOT_FOUND');
      // Thirty is far beyond any real condition report; the cap only stops
      // a runaway upload loop from swallowing the database.
      if (store.listPhotos(db, id).length >= 30) refuse(409, 'PHOTO_LIMIT');
      const photoId = store.insertPhoto(db, {
        containerId: id,
        mime,
        bytes,
        at: now(),
        userId: actorId(actor),
      });
      void reply.status(201);
      return { id: photoId };
    });
  });

  app.get('/api/photos/:id', (request, reply) => {
    requireAuth(request);
    const id = idParam(request);
    const photo = store.getPhoto(db, id);
    if (photo === null) refuse(404, 'NOT_FOUND');
    if (photo === null) throw new Error('unreachable');
    // A photo's bytes never change under its id, so the browser may keep
    // them for good — thumbnails stop re-fetching on every card open.
    void reply.header('cache-control', 'private, max-age=31536000, immutable');
    void reply.type(photo.mime);
    return Buffer.from(photo.bytes);
  });

  app.delete('/api/photos/:id', (request) => {
    requirePerm(request, 'EDIT');
    const id = idParam(request);
    if (!store.softDeletePhoto(db, id, now())) refuse(404, 'NOT_FOUND');
    return { ok: true };
  });

  // -------------------------------------------------------------- wages ----

  /**
   * محاسبة السائقين: كل نقلة بوابة لها سائق مسمّى بند يُدفع عنه — دخول
   * الحاوية نقلة وخروجها نقلة أخرى ولو تكررت السيارة. المبلغ رقم يُكتب
   * يدوياً بلا عملة، والاستلام ختم باسم من أكّده ووقته.
   */
  const wageKeySchema = z.object({
    containerId: z.number().int().positive(),
    direction: z.enum(['IN', 'OUT']),
  });

  app.get('/api/drivers', (request): { rows: DriverHaulRow[] } => {
    requirePerm(request, 'ACCOUNTING');
    const query = request.query as { from?: string; to?: string };
    const range = parseOrRefuse(rangeSchema, { from: query.from, to: query.to });
    return { rows: store.listHauls(db, range.from, range.to) };
  });

  app.put('/api/wages', (request) => {
    const actor = requirePerm(request, 'ACCOUNTING');
    const body = parseOrRefuse(
      wageKeySchema.extend({ amount: z.number().min(0).max(1_000_000) }),
      request.body,
    );
    return transaction(db, () => {
      const container = store.getContainer(db, body.containerId);
      if (container === null) refuse(404, 'NOT_FOUND');
      if (container === null) throw new Error('unreachable');
      // A wage belongs to a haul that happened, and a haul is identified by
      // its driver OR by its plate: the gate may leave the name blank, and
      // that haul is still owed to whoever drove that truck. Only a haul
      // with neither name nor plate has nobody to pay.
      const driver = body.direction === 'IN' ? container.driverIn : container.driverOut;
      const truck = body.direction === 'IN' ? container.truckIn : container.truckOut;
      if (driver === '' && truck === '') refuse(400, 'VALIDATION');
      const wage = store.getWage(db, body.containerId, body.direction);
      // A settled haul's figure is locked; lift the receipt first.
      if (wage !== null && wage.paidAt !== null) refuse(409, 'WAGE_PAID');
      store.setWage(db, { ...body, at: now(), userId: actorId(actor) });
      return { ok: true };
    });
  });

  /**
   * Erasing the box erases the figure. Without this the screen cleared and
   * the book did not, so the amount came back on the next read — «تبقى
   * القيمة موجودة». A settled figure is locked, exactly as it is for editing.
   */
  app.post('/api/wages/clear', (request) => {
    requirePerm(request, 'ACCOUNTING');
    const body = parseOrRefuse(wageKeySchema, request.body);
    return transaction(db, () => {
      const wage = store.getWage(db, body.containerId, body.direction);
      if (wage === null) refuse(404, 'NOT_FOUND');
      if (wage === null) throw new Error('unreachable');
      if (wage.paidAt !== null) refuse(409, 'WAGE_PAID');
      store.clearWage(db, body.containerId, body.direction, now());
      return { ok: true };
    });
  });

  /**
   * A whole account settled in one stroke — «وقت يجي يحاسب يكون سهل
   * محاسبته». ONE transaction, so a driver is never half-stamped: every haul
   * named must already carry a figure, and any already settled is left
   * exactly as it stands rather than re-stamped with today's date.
   */
  app.post('/api/wages/pay-many', (request) => {
    const actor = requirePerm(request, 'ACCOUNTING');
    const body = parseOrRefuse(
      z.object({ hauls: z.array(wageKeySchema).min(1).max(500) }),
      request.body,
    );
    return transaction(db, () => {
      const at = now();
      let stamped = 0;
      for (const haul of body.hauls) {
        const wage = store.getWage(db, haul.containerId, haul.direction);
        if (wage === null) refuse(409, 'WAGE_MISSING');
        if (wage === null) throw new Error('unreachable');
        if (wage.paidAt !== null) continue;
        store.setWagePaid(db, { ...haul, paid: true, at, userId: actorId(actor) });
        stamped += 1;
      }
      return { ok: true, stamped };
    });
  });

  app.post('/api/wages/pay', (request) => {
    const actor = requirePerm(request, 'ACCOUNTING');
    const body = parseOrRefuse(wageKeySchema.extend({ paid: z.boolean() }), request.body);
    return transaction(db, () => {
      if (store.getWage(db, body.containerId, body.direction) === null)
        refuse(409, 'WAGE_MISSING');
      store.setWagePaid(db, { ...body, at: now(), userId: actorId(actor) });
      return { ok: true };
    });
  });

  /**
   * أجر على سجل محذوف — «أضيف طريقة لإلغاء أجر على سجل محذوف من كشف
   * الحساب». A figure written or paid for a haul whose record was struck
   * afterwards has no haul to hold it: the statement lists live records
   * only, so it would sit invisible for ever. Listed here and voided on
   * confirmation — paid or not, because there is nothing to settle it
   * against; recovering money already handed over is the owner's affair.
   * A LIVE record keeps its own clear/pay flows and is refused here.
   */
  app.get('/api/wages/orphans', (request): { rows: OrphanWageRow[] } => {
    requirePerm(request, 'ACCOUNTING');
    return { rows: store.listOrphanWages(db) };
  });

  app.post('/api/wages/void', (request) => {
    requirePerm(request, 'ACCOUNTING');
    const body = parseOrRefuse(wageKeySchema, request.body);
    return transaction(db, () => {
      if (store.getContainer(db, body.containerId) !== null) refuse(409, 'NOT_DELETED');
      if (store.getWage(db, body.containerId, body.direction) === null) refuse(404, 'NOT_FOUND');
      store.clearWage(db, body.containerId, body.direction, now());
      return { ok: true };
    });
  });

  // --------------------------------------------- correcting the last move ----

  /**
   * «بالنسبة لتعديل النقل نعم تعديل» — a move recorded onto the wrong slot
   * is CORRECTED, not doubled: the record and its card learn the true slot
   * and no second move is born. Only the LAST placement corrects, the box
   * must carry nothing, and the true slot must take it — a correction moves
   * paper, never steel.
   */
  app.post('/api/movements/:id/correct', (request) => {
    const actor = requirePerm(request, 'MOVE');
    const id = idParam(request);
    const body = parseOrRefuse(z.object({ to: positionSchema }), request.body);
    return transaction(db, () => {
      const movement = store.getMovement(db, id);
      if (movement === null || movement.type !== 'MOVE') refuse(404, 'NOT_FOUND');
      const containerId = store.movementContainerId(db, id);
      if (containerId === null) refuse(404, 'NOT_FOUND');
      if (containerId === null) throw new Error('unreachable');
      const { dto, position } = standingContainer(containerId);
      if (store.latestPlacementId(db, containerId) !== id) refuse(409, 'NOT_LAST_MOVE');
      if (samePosition(position, body.to)) refuse(409, 'SAME_SLOT');
      const standing = store.listStanding(db);
      // The record shows others resting on it? Rewriting the ground under
      // them is refused outright — nothing physically moved.
      const mover = { id: containerId, number: dto.number, size: dto.size, position };
      // A burial reports a burial. `liftPlan` plans a REMOVAL and refuses
      // BLOCKED_DESCENT first, so a correction that moves no steel could come
      // back talking about a container that cannot find a landing.
      if (restingOn(standing, mover).length > 0) refuse(409, 'MOVE_BURIED');
      const refusal = canPlace(layoutNow(), standing, dto.size, body.to, containerId);
      if (refusal !== null) refuseLanding(refusal, body.to);
      store.setPosition(db, containerId, body.to);
      store.retargetMovement(db, id, body.to);
      store.recordMovement(
        db,
        containerId,
        'EDIT',
        now(),
        null,
        null,
        JSON.stringify({ k: ['moveTo'], b: [positionLabel(position)] }),
        actorId(actor),
      );
      const container = store.getContainer(db, containerId);
      const corrected = store.getMovement(db, id);
      if (container === null || corrected === null) refuse(404, 'NOT_FOUND');
      if (container === null || corrected === null) throw new Error('unreachable');
      return { container, move: corrected };
    });
  });

  /**
   * تصحيح فئة الحاوية — «ممكن الشخص خربط ف بطر انو يعدل بدل ما يحذفها من
   * السجل كامللل». The owner's reversal of his own earlier bar, and the
   * geometry decides its shape rather than a dropdown:
   *
   * The bay's parity IS the class. So a class written wrong is an ADDRESS
   * written wrong — the box is standing on ground the book has misdescribed —
   * and it is corrected by naming the bay it truly occupies. The class is
   * never in the body: it is `sizeOfBay(to.bay)`, derived exactly as the gate
   * derives it. Nothing moves: same zone, same stack, same tier, bay ±1. No
   * MOVE, no move card, no serial is touched — a serial is a function of the
   * gate date, not of the class.
   *
   * Refuses if anything is standing ON it: changing what this box IS changes
   * what they stand on, and no descent happened to justify a DROP. That is
   * the owner's own choice — «يرفض الآن» — over correcting a whole column.
   */
  app.post('/api/containers/:id/reclass', (request) => {
    const actor = requirePerm(request, 'MOVE');
    requirePerm(request, 'EDIT');
    const id = idParam(request);
    const body = parseOrRefuse(z.object({ to: positionSchema.optional() }), request.body);

    return transaction(db, () => {
      const existing = store.getContainer(db, id);
      if (existing === null) refuse(404, 'NOT_FOUND');
      if (existing === null) throw new Error('unreachable');

      /** The bay may only step one place sideways; everything else holds. */
      const adjacent = (from: Position, to: Position): boolean =>
        to.zone === from.zone &&
        to.stack === from.stack &&
        to.tier === from.tier &&
        Math.abs(to.bay - from.bay) === 1;

      const at = now();

      if (existing.position !== null) {
        const from = existing.position;
        if (body.to === undefined) refuse(400, 'VALIDATION', { field: 'to' });
        if (body.to === undefined) throw new Error('unreachable');
        if (!adjacent(from, body.to)) refuse(409, 'NOT_ADJACENT_BAY');

        const standing = store.listStanding(db);
        const mover = { id, number: existing.number, size: existing.size, position: from };
        const above = restingOn(standing, mover);
        const first = above[0];
        if (first !== undefined) refuse(409, 'RECLASS_BURIED', { other: first.number });

        const size = sizeOfBay(body.to.bay);
        const refusal = canPlace(layoutNow(), standing, size, body.to, id);
        if (refusal !== null) refuseLanding(refusal, body.to);

        store.setSize(db, id, size);
        store.setPosition(db, id, body.to);
        // The movement that says where it IS becomes true. That one row only:
        // the journey never happened differently, only its description.
        const placement = store.latestPlacementId(db, id);
        if (placement !== null) store.retargetMovement(db, placement, body.to);
        store.recordMovement(
          db,
          id,
          'EDIT',
          at,
          null,
          null,
          JSON.stringify({ k: ['size', 'slot'], b: { size: existing.size, slot: positionLabel(from) } }),
          actorId(actor),
        );
      } else {
        // Departed: no ground is being claimed, so occupancy and support are
        // not consulted. The remembered exit slot still has to move with the
        // class, or «إلغاء الخروج» reads back a slot whose parity contradicts
        // the record and refuses forever.
        const wasAt = store.lastExitPosition(db, id);
        if (wasAt === null) {
          if (body.to !== undefined) refuse(409, 'NOT_ADJACENT_BAY');
          const size = existing.size === 20 ? 40 : 20;
          store.setSize(db, id, size);
          store.recordMovement(
            db,
            id,
            'EDIT',
            at,
            null,
            null,
            JSON.stringify({ k: ['size'], b: { size: existing.size } }),
            actorId(actor),
          );
        } else {
          if (body.to === undefined) refuse(400, 'VALIDATION', { field: 'to' });
          if (body.to === undefined) throw new Error('unreachable');
          if (!adjacent(wasAt, body.to)) refuse(409, 'NOT_ADJACENT_BAY');
          const layout = layoutNow();
          for (const oddBay of baySpan(body.to.bay)) {
            if (!slotUsable(layout, body.to.zone, oddBay, body.to.stack)) refuse(409, 'BAD_SLOT');
          }
          store.setSize(db, id, sizeOfBay(body.to.bay));
          const departure = store.lastExitMovementId(db, id);
          if (departure !== null) store.refromMovement(db, departure, body.to);
          store.recordMovement(
            db,
            id,
            'EDIT',
            at,
            null,
            null,
            JSON.stringify({
              k: ['size', 'exitFrom'],
              b: { size: existing.size, exitFrom: positionLabel(wasAt) },
            }),
            actorId(actor),
          );
        }
      }

      const container = store.getContainer(db, id);
      if (container === null) refuse(404, 'NOT_FOUND');
      if (container === null) throw new Error('unreachable');
      return { container };
    });
  });

  app.post('/api/backup', (request, reply) => {
    // «اعطي جميع الموظفين القدرة على عمل نسخة احتياطية ولكن استرجاع النسخة
    // بيد المالك»: any signed-in account may TAKE a copy — more copies,
    // safer yard. Restoring one stays the owner's alone (ownerTools).
    requireAuth(request);
    if (databaseFile(db) === '') refuse(409, 'NOT_SETUP');
    const target = snapshot(db, 'yard');

    const bytes = readFileSync(target);
    void reply
      .type('application/octet-stream')
      .header(
        'content-disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(target))}`,
      );
    return bytes;
  });

  /**
   * The report as a real PDF: the client sends the same sheet it shows, the
   * server prints it through the system's own browser engine. Needs
   * Edge/Chrome installed where the server runs.
   */
  app.post('/api/reports/pdf', async (request, reply) => {
    requireAuth(request);
    const body = parseOrRefuse(
      z.object({
        title: z.string().trim().min(1).max(100),
        html: z.string().min(1).max(2_000_000),
        landscape: z.boolean().default(true),
      }),
      request.body,
    );

    const { chromium } = await import('playwright-core');
    const browser = await launchSystemBrowser(chromium);
    try {
      const page = await browser.newPage();
      await page.setContent(body.html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        landscape: body.landscape,
        printBackground: true,
        // A register that runs to several pages has to say which page you are
        // holding; the sheet's own title rides along so a loose page is still
        // identifiable on a desk.
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate:
          // The footer is a SEPARATE document that inherits nothing from the
          // page — not its stylesheet and not any web font it loaded. Its
          // Arabic can only come from a font installed on the machine, which
          // is why deploy/cloud/cloud-setup.sh installs one.
          `<div style="width:100%;font-family:'Noto Naskh Arabic','Noto Sans Arabic','Segoe UI',Tahoma,sans-serif;font-size:8px;` +
          `color:#64748b;padding:0 9mm;display:flex;justify-content:space-between;direction:rtl">` +
          `<span>${escapeHtml(body.title)}</span>` +
          `<span>صفحة <span class="pageNumber"></span> من <span class="totalPages"></span></span>` +
          `</div>`,
        margin: { top: '9mm', bottom: '13mm', left: '9mm', right: '9mm' },
      });
      void reply
        .type('application/pdf')
        .header(
          'content-disposition',
          // The title arrives carrying bidi isolates so its plate reads from
          // the left in the footer; a FILE NAME must not carry them.
          `attachment; filename*=UTF-8''${encodeURIComponent(plainCode(body.title))}.pdf`,
        );
      return pdf;
    } finally {
      await browser.close();
    }
  });

  /**
   * الطباعة الكلية للبطاقات — للمالك وحده: the DATA of every card of the
   * range, by kind, ordered as the bound book reads (serial within year).
   * Facts only cross the wire; the Arabic card is written client-side,
   * where Arabic lives.
   */
  app.get('/api/reports/cards', (request): { rows: CardSheetRow[] } => {
    requireOwner(request);
    const query = request.query as { kind?: string; from?: string; to?: string };
    if (query.kind !== 'in' && query.kind !== 'out' && query.kind !== 'move') {
      refuse(400, 'VALIDATION');
    }
    const range = parseOrRefuse(rangeSchema, { from: query.from, to: query.to });
    const rows =
      query.kind === 'move'
        ? store.bulkMoveCards(db, range.from, range.to)
        : store.bulkGateCards(db, query.kind === 'in' ? 'IN' : 'OUT', range.from, range.to);
    return { rows };
  });

  /**
   * The bulk file itself: hundreds of cards, one PDF, upright. Its own route
   * because the register PDF's guard and ceiling do not fit it — this one is
   * the OWNER's alone, and a whole year of cards (photos ridden along as
   * data URIs) is far past the default 1MiB body.
   */
  app.post(
    '/api/reports/cards-pdf',
    { bodyLimit: 64 * 1024 * 1024 },
    async (request, reply) => {
      requireOwner(request);
      const body = parseOrRefuse(
        z.object({
          title: z.string().trim().min(1).max(100),
          html: z.string().min(1).max(60_000_000),
        }),
        request.body,
      );

      const { chromium } = await import('playwright-core');
      const browser = await launchSystemBrowser(chromium);
      try {
        const page = await browser.newPage();
        // A book of hundreds of pages takes longer than a sheet — the
        // default 30s would cut the year's register off mid-render.
        page.setDefaultTimeout(120_000);
        await page.setContent(body.html, { waitUntil: 'load', timeout: 120_000 });
        const pdf = await page.pdf({
          format: 'A4',
          landscape: false,
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: '<div></div>',
          footerTemplate:
            `<div style="width:100%;font-family:'Noto Naskh Arabic','Noto Sans Arabic','Segoe UI',Tahoma,sans-serif;font-size:8px;` +
            `color:#64748b;padding:0 9mm;display:flex;justify-content:space-between;direction:rtl">` +
            `<span>${escapeHtml(body.title)}</span>` +
            `<span>صفحة <span class="pageNumber"></span> من <span class="totalPages"></span></span>` +
            `</div>`,
          margin: { top: '10mm', bottom: '13mm', left: '10mm', right: '10mm' },
        });
        void reply
          .type('application/pdf')
          .header(
            'content-disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(plainCode(body.title))}.pdf`,
          );
        return pdf;
      } finally {
        await browser.close();
      }
    },
  );

  /**
   * كشف التقرير اليومي: دخول وخروج وواقف، يوم بيوم.
   *
   * Only days that actually carry a movement get a row. The sheet used to
   * emit one line per calendar day in the range whether the yard worked that
   * day or not, which read as the register inventing days it had never seen.
   */
  /**
   * دمج أسماء السائقين المكررة — the owner folds stray spellings of one
   * driver into the canonical one, and the accounting stops splitting his
   * hauls across three lines. A spelling repair for the whole book.
   */
  app.get('/api/drivers/names', (request) => {
    requireOwner(request);
    return { rows: store.driverNameCounts(db) };
  });

  app.post('/api/drivers/merge', (request) => {
    requireOwner(request);
    const body = parseOrRefuse(
      z.object({
        keep: z.string().trim().min(1).max(60),
        drop: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
      }),
      request.body,
    );
    // Keeping a name and dropping it at once is a slip, not an order.
    const drop = body.drop.filter((name) => name !== body.keep);
    if (drop.length === 0) refuse(400, 'VALIDATION', { field: 'driver' });
    return transaction(db, () => store.mergeDriverNames(db, body.keep, drop));
  });

  /** كشف إنتاجية الآليات: من أنجز كم مهمة، وبأي سرعة، في الفترة. */
  app.get('/api/reports/machines', (request): { rows: MachineReportRow[] } => {
    requirePerm(request, 'REPORTS');
    const query = request.query as { from?: string; to?: string };
    const range = parseOrRefuse(rangeSchema, { from: query.from, to: query.to });
    return { rows: store.machineProductivity(db, range.from, range.to) };
  });

  app.get('/api/reports/daily', (request): { rows: DailyReportRow[] } => {
    requirePerm(request, 'REPORTS');
    const query = request.query as { from?: string; to?: string };
    const range = parseOrRefuse(rangeSchema, { from: query.from, to: query.to });

    // The running total needs history from the beginning of time; the range
    // only decides which days get a row.
    const instants = store.listMovementInstants(db, range.to);
    const fromMs = new Date(range.from).getTime();
    const days = new Map<string, { inCount: number; outCount: number; standing: number }>();
    let running = 0;
    for (const instant of instants) {
      running += instant.type === 'IN' ? 1 : -1;
      if (new Date(instant.at).getTime() < fromMs) continue;

      const day = ammanDay(instant.at);
      const entry = days.get(day) ?? { inCount: 0, outCount: 0, standing: 0 };
      if (instant.type === 'IN') entry.inCount += 1;
      else entry.outCount += 1;
      // The last movement of the day leaves the day's closing total behind.
      entry.standing = running;
      days.set(day, entry);
    }

    const rows: DailyReportRow[] = [...days.entries()]
      .map(([date, entry]) => ({ date, ...entry }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { rows };
  });

  app.get('/api/containers', (request) => {
    requireAuth(request);
    const query = parseOrRefuse(
      z.object({ q: z.string().trim().min(1).max(120) }),
      request.query,
    );
    return { results: store.searchContainers(db, query.q) };
  });

  app.get('/api/containers/:id', (request) => {
    requireAuth(request);
    const id = idParam(request);
    const container = store.getContainer(db, id);
    if (container === null) refuse(404, 'NOT_FOUND');
    if (container === null) throw new Error('unreachable');
    return {
      container,
      movements: store.listMovements(db, id),
      // «منقولة إلى مديرية التخزين» — the live storage paper carrying it.
      storage: store.storageMarkOf(db, id),
    };
  });

  // The owner's training tools, for the period the staff are learning on the
  // live yard. One line and one file — both go together when they are done.
  registerOwnerTools(app, db, { requireOwner, refuse });

  return app;
}
