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
  ContainerDto,
  DailyReportRow,
  ErrorCode,
  GateReportRow,
  LogReportRow,
  MeDto,
  Permission,
  Position,
  StandingReportRow,
  YardStateDto,
} from '../shared/types';
import { HANDLING, OWNER_ID, PERMISSIONS, TIERS, ZONES } from '../shared/types';
import { ammanDay, ammanYear, daysBetween, toLocalStamp } from '../shared/dates';
import { checkNumber } from '../shared/iso6346';
import { positionLabel } from '../shared/address';
import type { Descent, Refusal as RuleRefusal, Standing } from '../shared/rules';
import { canMove, canPlace, planRemoval } from '../shared/rules';
import { ASEZA } from '../shared/asezaLayout';
import {
  SESSION_COOKIE,
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

/** The official five-part slot. The yard digit derives from the zone. */
const positionSchema = z.object({
  zone: z.enum(ZONES),
  bay: z.number().int().min(1).max(60),
  stack: z.number().int().min(1).max(10),
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
});

/**
 * The exit no longer asks for a seal, on the owner's instruction. A container
 * carries ONE seal — the one recorded at the gate it came in through — and
 * that is the one every card and every register names from here on.
 */
const gateOutSchema = z.object({
  truck: z.string().trim().min(1).max(30),
  driver: z.string().trim().max(60).default(''),
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

const userSchema = z.object({
  name: z.string().trim().min(1).max(40),
  pin: pinSchema,
  permissions: permissionSchema,
});

/** An edit may leave the PIN alone; sending one replaces it. */
const userPatchSchema = z.object({
  name: z.string().trim().min(1).max(40),
  permissions: permissionSchema,
  pin: pinSchema.optional(),
});

function parseOrRefuse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Refusal(400, { code: 'VALIDATION' });
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

  const attempts = new Map<string, { count: number; windowStart: number }>();

  const now = (): string => new Date().toISOString();

  /** Who the cookie says is working: the owner, an employee, or nobody. */
  const actorOf = (request: FastifyRequest): MeDto | null => {
    const token = request.cookies[SESSION_COOKIE];
    if (token === undefined) return null;
    const id = verifySession(db, token, Date.now());
    if (id === null) return null;
    if (id === OWNER_ID) {
      return { id: OWNER_ID, name: store.OWNER_NAME, owner: true, permissions: PERMISSIONS };
    }
    // An employee removed mid-session loses the session with the account.
    const user = store.getUser(db, id);
    if (user === null) return null;
    return { id: user.id, name: user.name, owner: false, permissions: user.permissions };
  };

  const isAuthorized = (request: FastifyRequest): boolean => actorOf(request) !== null;

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

  const idParam = (request: FastifyRequest): number => {
    const params = request.params as { id?: string };
    const id = Number(params.id);
    if (!Number.isInteger(id) || id < 1) refuse(400, 'VALIDATION');
    return id;
  };

  const sendSession = (reply: FastifyReply, userId: number): void => {
    reply.setCookie(SESSION_COOKIE, issueSession(db, userId, Date.now()), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: 14 * 24 * 60 * 60,
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
    void reply.status(500).send({ code: 'VALIDATION' } satisfies ApiError);
  });

  /**
   * What the client needs before it can draw anything — including the staff
   * names, so the sign-in screen can offer them as buttons. Names are all it
   * gives away, and the whole site sits behind the sign-in either way.
   */
  const build = buildStamp();

  app.get('/api/boot', (request) => {
    return {
      firstRun: !hasPassword(db),
      authorized: isAuthorized(request),
      staff: store.listUsers(db).map((user) => ({ id: user.id, name: user.name })),
      build,
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

  app.post('/api/logout', (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/state', (request): YardStateDto => {
    requireAuth(request);
    return { containers: store.listInYard(db) };
  });

  app.post('/api/containers', (request, reply) => {
    const actor = requirePerm(request, 'GATE_IN');
    const body = parseOrRefuse(gateInSchema, request.body);
    const check = checkNumber(body.number);

    return transaction(db, () => {
      // The same number may return for a new visit, but cannot stand twice at once.
      const duplicate = store.findStandingByNumber(db, check.normalized);
      if (duplicate !== null) refuse(409, 'NUMBER_IN_YARD', { number: check.normalized });

      const standing = store.listStanding(db);
      const refusal = canPlace(ASEZA, standing, body.size, body.position);
      if (refusal !== null) refuseRule(refusal);

      const at = now();
      // The serial counts within the Amman year of this very moment, and the
      // year rides along with it: come January the count starts at 1 again.
      const year = ammanYear(at);
      const id = store.insertContainer(db, {
        number: check.normalized,
        numberValid: check.valid,
        size: body.size,
        bill: body.bill,
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
      void reply.status(201);
      return store.getContainer(db, id);
    });
  });

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
   */
  const settleAbove = (
    descents: readonly Descent[],
    at: string,
    cause: string,
    userId: number | null,
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
      );
    }
  };

  /** The lift plan for a standing container, refusing if the stack cannot fall. */
  const liftPlan = (standing: readonly Standing[], mover: Standing): readonly Descent[] => {
    const plan = planRemoval(ASEZA, standing, mover);
    if (!plan.ok) refuseRule(plan.refusal);
    if (!plan.ok) throw new Error('unreachable');
    return plan.descents;
  };

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
      const refusal = canMove(ASEZA, standing, mover, body.to);
      if (refusal !== null) refuseRule(refusal);
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

  app.post('/api/containers/:id/exit', (request) => {
    const actor = requirePerm(request, 'GATE_OUT');
    const id = idParam(request);
    const gate = parseOrRefuse(gateOutSchema, request.body);

    return transaction(db, () => {
      const { dto, position } = standingContainer(id);
      // A buried container no longer refuses to leave: whatever stands on it
      // comes down a tier as it goes, exactly as the yard restacks.
      const standing = store.listStanding(db);
      const descents = liftPlan(standing, { id, number: dto.number, size: dto.size, position });
      const at = now();
      const year = ammanYear(at);
      store.markExited(db, id, at, {
        truck: gate.truck,
        driver: gate.driver,
        cardOut: store.nextCardNumber(db, 'out', year),
        cardOutYear: year,
      });
      store.recordMovement(db, id, 'OUT', at, position, null, '', actorId(actor));
      settleAbove(descents, at, dto.number, actorId(actor));
      return store.getContainer(db, id);
    });
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
      // in two places on the map.
      if (check.normalized !== existing.number && existing.position !== null) {
        const duplicate = store.findStandingByNumber(db, check.normalized);
        if (duplicate !== null && duplicate.id !== id) {
          refuse(409, 'NUMBER_IN_YARD', { number: check.normalized });
        }
      }

      // THE CLASS IS FIXED for the life of the record, standing or departed.
      // A 40 occupies two slots and a 20 one, so a class corrected after the
      // fact falsifies the ground itself and every count taken off it. The
      // owner's own bar: «لا يوجد تعديل على فئة الحاوية … الا عند حذفها ثم
      // ادخالها مره اخرى» — which is also the truthful record of what
      // happened, since a 20 that turns out to be a 40 was never that 20.
      if (body.size !== existing.size) refuse(409, 'SIZE_LOCKED');

      // The exit paperwork only exists once there has been an exit; offering
      // it on a standing container would invent a departure that never was.
      const stillStanding = existing.exitedAt === null;
      const exitFields = [body.truckOut, body.driverOut];
      if (stillStanding && (body.exitedAt !== null || exitFields.some((v) => v !== ''))) {
        refuse(409, 'VALIDATION');
      }
      // Once it has left, its exit paperwork is as mandatory as its entry's —
      // the driver's name excepted, which is optional in both directions.
      if (!stillStanding && (body.exitedAt === null || body.truckOut === '')) {
        refuse(409, 'VALIDATION');
      }

      // A container cannot leave before it arrived, and neither instant may
      // be in the future — both would poison the dwell arithmetic and put the
      // row in a register period that has not happened yet.
      const entered = Date.parse(body.enteredAt);
      const exited = body.exitedAt === null ? null : Date.parse(body.exitedAt);
      const horizon = Date.now() + 60_000;
      if (entered > horizon || (exited !== null && exited > horizon)) refuse(409, 'VALIDATION');
      if (exited !== null && exited < entered) refuse(409, 'VALIDATION');

      const changed: string[] = [];
      const before: Record<string, string | number> = {};
      const diff = (key: string, next: string | number, was: string | number): void => {
        if (next === was) return;
        changed.push(key);
        before[key] = was;
      };

      diff('number', check.normalized, existing.number);
      diff('size', body.size, existing.size);
      diff('bill', body.bill, existing.bill);
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
        // A gate date decides where the card sits in the year's count, so a
        // corrected date re-seats it — and everything it passed on the way.
        if (changed.includes('enteredAt') || changed.includes('exitedAt')) {
          store.renumberCards(db);
        }

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
   * It returns to ITS OWN slot or not at all. Whatever stood on it came down
   * a tier as it left, so that slot may be taken now; the refusal names who
   * is standing there rather than shuffling the yard on its own authority.
   */
  app.post('/api/containers/:id/unexit', (request) => {
    const actor = requirePerm(request, 'GATE_OUT');
    const id = idParam(request);

    return transaction(db, () => {
      const existing = store.getContainer(db, id);
      if (existing === null) refuse(404, 'NOT_FOUND');
      if (existing === null) throw new Error('unreachable');
      if (existing.exitedAt === null) refuse(409, 'NOT_EXITED');

      const wasAt = store.lastExitPosition(db, id);
      if (wasAt === null) refuse(409, 'BAD_SLOT');
      if (wasAt === null) throw new Error('unreachable');
      const refusal = canPlace(ASEZA, store.listStanding(db), existing.size, wasAt);
      if (refusal !== null) refuseRule(refusal);

      store.cancelExit(db, id, wasAt);
      store.recordMovement(db, id, 'RETURN', now(), null, wasAt, '', actorId(actor));
      // The exit card is void, so its number goes back into the year's count
      // and the ledger closes over the hole — the same rule as everywhere.
      store.renumberCards(db);
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

      const wasAt = store.lastDeletePosition(db, id);
      if (wasAt !== null) {
        const refusal = canPlace(ASEZA, store.listStanding(db), existing.size, wasAt);
        if (refusal !== null) refuseRule(refusal);
      }
      store.restoreContainer(db, id, wasAt);

      // Its serial went back into circulation the moment it was struck out,
      // so by now it may be printed on somebody else's card. The record
      // coming back takes its seat by its gate date and the year is counted
      // through again: two cards of one year may never carry one number, and
      // no number may be missing between the first and the last.
      store.renumberCards(db);

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
      // standing on air.
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
      settleAbove(descents, at, existing.number, actorId(actor));
      // And the year closes over the gap the struck-out record left, so the
      // register never carries a missing number. Every card issued after it
      // moves down one — which is the price of a register with no holes, and
      // the owner's own call.
      const resealed = store.renumberCards(db);
      return { ok: true, resealed };
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
        dwellDays: type === 'OUT' ? daysBetween(row.enteredAt, row.at) : null,
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
        enteredAt: container.enteredAt,
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

  /** كشف سيارة: كل اللي حملته سيارة وحدة، دخول وخروج. */
  app.get(
    '/api/reports/truck',
    (request): { rows: Array<GateReportRow & { statement: 'IN' | 'OUT' }> } => {
      requirePerm(request, 'REPORTS');
      const query = request.query as { truck?: string; from?: string; to?: string };
      const truck = (query.truck ?? '').trim();
      if (truck === '' || truck.length > 30) refuse(400, 'VALIDATION');
      const range = parseOrRefuse(rangeSchema, { from: query.from, to: query.to });

      const rows = store.listTruckMovements(db, truck, range.from, range.to).map((row) => ({
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
    if (bill === '' || bill.length > 40) refuse(400, 'VALIDATION');
    return { rows: store.listByBill(db, bill) };
  });

  /**
   * النسخة الاحتياطية بكبسة: a clean snapshot of the whole database, written
   * beside the live file AND handed back as a download — two copies from one
   * tap. VACUUM INTO folds the WAL in, so the snapshot is complete and
   * self-contained. The owner's button alone.
   */
  app.post('/api/backup', (request, reply) => {
    requireOwner(request);
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
          `<div style="width:100%;font-family:'Segoe UI',Tahoma,sans-serif;font-size:8px;` +
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
          `attachment; filename*=UTF-8''${encodeURIComponent(body.title)}.pdf`,
        );
      return pdf;
    } finally {
      await browser.close();
    }
  });

  /**
   * كشف التقرير اليومي: دخول وخروج وواقف، يوم بيوم.
   *
   * Only days that actually carry a movement get a row. The sheet used to
   * emit one line per calendar day in the range whether the yard worked that
   * day or not, which read as the register inventing days it had never seen.
   */
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
    return { container, movements: store.listMovements(db, id) };
  });

  // The owner's training tools, for the period the staff are learning on the
  // live yard. One line and one file — both go together when they are done.
  registerOwnerTools(app, db, { requireOwner, refuse });

  return app;
}
