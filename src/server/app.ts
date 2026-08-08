import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import type { DatabaseSync } from 'node:sqlite';
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
  YardConfig,
  YardStateDto,
} from '../shared/types';
import {
  MAX_BLOCKS,
  MAX_BLOCK_NAME,
  MAX_LOCATIONS,
  MAX_PLACES_PER_TIER,
  MAX_TIERS,
  OWNER_ID,
  PERMISSIONS,
} from '../shared/types';
import { ammanDay, daysBetween } from '../shared/dates';
import { checkNumber } from '../shared/iso6346';
import type { RuleRefusal } from '../shared/rules';
import { canPlace, overfilledByLayout, strandedByLayout } from '../shared/rules';
import { positionLabel, samePosition } from '../shared/address';
import { blockTakes, defaultLayout, overlappingPairs } from '../shared/geometry';
import {
  SESSION_COOKIE,
  hasPassword,
  issueSession,
  setPassword,
  verifyPassword,
  verifySecret,
  verifySession,
} from './auth';
import { transaction } from './db';
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

/** A rule refusal with whatever numbers its Arabic sentence interpolates. */
const refuseRule = (refusal: RuleRefusal): never =>
  refuse(
    409,
    refusal.code,
    refusal.code === 'LOCATION_FULL' ? { free: refusal.free, need: refusal.need } : undefined,
  );

const positionSchema = z.object({
  block: z.number().int().min(1),
  row: z.number().int().min(1),
});

const columnShapeSchema = z.object({
  rows: z.number().int().min(1).max(MAX_LOCATIONS),
  placesPerTier: z.number().int().min(1).max(MAX_PLACES_PER_TIER),
  tiers: z.number().int().min(1).max(MAX_TIERS),
});

/** The simple first-run shape: two columns, laid out by defaultLayout. */
const setupYardSchema = z.object({
  twenty: columnShapeSchema,
  forty: columnShapeSchema,
});

const blockSchema = z
  .object({
    /** Present for an existing block; absent for one the editor just added. */
    id: z.number().int().min(1).optional(),
    name: z.string().trim().min(1).max(MAX_BLOCK_NAME),
    /** 0 = مختلط: the column takes either container size. */
    size: z.union([z.literal(20), z.literal(40), z.literal(0)]),
    rows: z.number().int().min(1).max(MAX_LOCATIONS),
    /** Twenty-foot places per tier — a 40 fills two of them. */
    placesPerTier: z.number().int().min(1).max(MAX_PLACES_PER_TIER),
    tiers: z.number().int().min(1).max(MAX_TIERS),
    x: z.number().finite().min(-50000).max(50000),
    y: z.number().finite().min(-50000).max(50000),
    // Any whole degree: the owner turns columns freely with the mouse.
    angle: z.number().int().min(0).max(359),
  })
  // A 40-only column is counted in whole 40s by the editor, so an odd number
  // of places would round-trip as a half container the owner never typed.
  .refine((block) => block.size !== 40 || block.placesPerTier % 2 === 0);

const layoutSchema = z.object({
  blocks: z.array(blockSchema).min(1).max(MAX_BLOCKS),
});

const gateInSchema = z.object({
  number: z.string().trim().min(1).max(20),
  size: z.union([z.literal(20), z.literal(40)]),
  customer: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000),
  position: positionSchema,
  /** The truck and the seal — the owner made both mandatory paperwork. */
  truck: z.string().trim().min(1).max(30),
  seal: z.string().trim().min(1).max(30),
  driver: z.string().trim().max(60).default(''),
  weight: z.string().trim().max(20).default(''),
});

const gateOutSchema = z.object({
  truck: z.string().trim().min(1).max(30),
  /** The seal on the door as it leaves — a different one means it was opened. */
  seal: z.string().trim().min(1).max(30),
  driver: z.string().trim().max(60).default(''),
});

const editSchema = z.object({
  number: z.string().trim().min(1).max(20),
  customer: z.string().trim().min(1).max(120),
  size: z.union([z.literal(20), z.literal(40)]),
  notes: z.string().trim().max(2000),
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
  const app = Fastify({ logger: false });
  void app.register(cookie);

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

  const requireYard = (): ReturnType<typeof store.getYard> & object => {
    const yard = store.getYard(db);
    if (yard === null) refuse(409, 'NOT_SETUP');
    // The refusal above throws; this narrows for the type checker.
    if (yard === null) throw new Error('unreachable');
    return yard;
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

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Refusal) {
      void reply.status(error.status).send(error.body);
      return;
    }
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
  app.get('/api/boot', (request) => {
    return {
      firstRun: !hasPassword(db),
      authorized: isAuthorized(request),
      yardConfigured: store.getYard(db) !== null,
      staff: store.listUsers(db).map((user) => ({ id: user.id, name: user.name })),
    };
  });

  /** Who is signed in and what the screen may offer them. */
  app.get('/api/me', (request): MeDto => requireAuth(request));

  /** First run only: password + yard shape in one step, then signed in. */
  app.post('/api/setup', (request, reply) => {
    if (hasPassword(db)) refuse(409, 'ALREADY_SETUP');
    const body = parseOrRefuse(
      z.object({ password: z.string().min(6).max(200), yard: setupYardSchema }),
      request.body,
    );

    transaction(db, () => {
      setPassword(db, body.password);
      for (const block of defaultLayout(body.yard.twenty, body.yard.forty)) {
        store.insertBlock(db, block);
      }
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
    const yard = requireYard();
    return {
      yard,
      containers: store.listInYard(db),
      customers: store.listCustomers(db),
      blockNames: store.listBlockNames(db),
    };
  });

  /**
   * The whole layout in one atomic save: columns move, turn, grow, get
   * renamed, appear or disappear together. Growth and movement are free; a
   * change may never strand a standing container, overfill a location, nor
   * stack two columns on the same ground.
   */
  app.put('/api/yard', (request) => {
    requireOwner(request);
    const current = requireYard();
    const body = parseOrRefuse(layoutSchema, request.body);

    return transaction(db, () => {
      const liveIds = new Set(current.blocks.map((block) => block.id));
      const seenIds = new Set<number>();
      const seenNames = new Set<string>();
      for (const block of body.blocks) {
        if (block.id !== undefined) {
          if (!liveIds.has(block.id) || seenIds.has(block.id)) refuse(404, 'NOT_FOUND');
          seenIds.add(block.id);
        }
        if (seenNames.has(block.name)) refuse(409, 'NAME_TAKEN', { name: block.name });
        seenNames.add(block.name);
      }

      // New blocks get placeholder ids for the checks; nothing stands in them.
      const proposed: YardConfig = {
        blocks: body.blocks.map((block, index) => ({ ...block, id: block.id ?? -(index + 1) })),
      };

      const overlaps = overlappingPairs(proposed.blocks);
      const firstOverlap = overlaps[0];
      if (firstOverlap !== undefined) {
        refuse(409, 'BLOCK_OVERLAP', {
          names: `${firstOverlap[0].name} × ${firstOverlap[1].name}`,
        });
      }

      const standing = store.listStanding(db);
      const names = store.listBlockNames(db);
      const nameOf = (id: number): string => names[String(id)] ?? '؟';

      // A block that disappears must be empty.
      const keptIds = new Set(proposed.blocks.map((block) => block.id));
      const emptied = standing.find((s) => !keptIds.has(s.position.block));
      if (emptied !== undefined) {
        refuse(409, 'BLOCK_NOT_EMPTY', { name: nameOf(emptied.position.block) });
      }

      const stranded = strandedByLayout(proposed, standing, store.standingSizes(db));
      if (stranded.length > 0) {
        refuse(409, 'SHRINK_OCCUPIED', {
          containers: stranded
            .map((s) => `${s.number} @ ${positionLabel(nameOf, s.position)}`)
            .join('، '),
        });
      }

      // Cutting places or tiers may leave a location holding more than the
      // new shape allows — a different fault from stranding, and a different
      // fix: raise the number back, or empty the location first.
      const overfilled = overfilledByLayout(proposed, standing);
      if (overfilled.length > 0) {
        refuse(409, 'CAPACITY_OCCUPIED', {
          locations: overfilled.map((position) => positionLabel(nameOf, position)).join('، '),
        });
      }

      const at = now();
      for (const id of liveIds) {
        if (!keptIds.has(id)) store.softDeleteBlock(db, id, at);
      }
      for (const block of body.blocks) {
        if (block.id !== undefined) store.updateBlock(db, { ...block, id: block.id });
        else store.insertBlock(db, block);
      }
      return store.getYard(db);
    });
  });

  app.post('/api/containers', (request, reply) => {
    const actor = requirePerm(request, 'GATE_IN');
    const yard = requireYard();
    const body = parseOrRefuse(gateInSchema, request.body);
    const check = checkNumber(body.number);

    return transaction(db, () => {
      // The same number may return for a new visit, but cannot stand twice at once.
      const duplicate = store.findStandingByNumber(db, check.normalized);
      if (duplicate !== null) refuse(409, 'NUMBER_IN_YARD', { number: check.normalized });

      const standing = store.listStanding(db);
      const refusal = canPlace(yard, standing, body.size, body.position);
      if (refusal !== null) refuseRule(refusal);

      const at = now();
      const id = store.insertContainer(db, {
        number: check.normalized,
        numberValid: check.valid,
        size: body.size,
        customer: body.customer,
        notes: body.notes,
        position: body.position,
        at,
        weight: body.weight,
        truckIn: body.truck,
        driverIn: body.driver,
        sealIn: body.seal,
        cardIn: store.nextCardNumber(db, 'in'),
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

  app.post('/api/containers/:id/move', (request) => {
    const actor = requirePerm(request, 'MOVE');
    const yard = requireYard();
    const id = idParam(request);
    const body = parseOrRefuse(z.object({ to: positionSchema }), request.body);

    return transaction(db, () => {
      const { dto, position } = standingContainer(id);
      if (samePosition(position, body.to)) refuse(409, 'SAME_SLOT');

      const place = canPlace(yard, store.listStanding(db), dto.size, body.to, id);
      if (place !== null) refuseRule(place);

      const at = now();
      store.setPosition(db, id, body.to);
      store.recordMovement(db, id, 'MOVE', at, position, body.to, '', actorId(actor));
      return store.getContainer(db, id);
    });
  });

  app.post('/api/containers/:id/exit', (request) => {
    const actor = requirePerm(request, 'GATE_OUT');
    requireYard();
    const id = idParam(request);
    const gate = parseOrRefuse(gateOutSchema, request.body);

    return transaction(db, () => {
      const { position } = standingContainer(id);
      const at = now();
      store.markExited(db, id, at, {
        truck: gate.truck,
        driver: gate.driver,
        sealOut: gate.seal,
        cardOut: store.nextCardNumber(db, 'out'),
      });
      store.recordMovement(db, id, 'OUT', at, position, null, '', actorId(actor));
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

      // A size flip while standing must fit the column the container stands
      // in, and its location must still have room: a 20 growing into a 40
      // claims a second place, and paperwork alone cannot create one.
      if (body.size !== existing.size && existing.position !== null) {
        const yard = requireYard();
        const at = existing.position;
        const block = yard.blocks.find((b) => b.id === at.block);
        if (block === undefined || !blockTakes(block.size, body.size)) refuse(409, 'WRONG_ZONE');
        const grow = canPlace(yard, store.listStanding(db), body.size, at, id);
        if (grow !== null) refuseRule(grow);
      }

      const changed: string[] = [];
      const before: Record<string, string | number> = {};
      if (check.normalized !== existing.number) {
        changed.push('number');
        before['number'] = existing.number;
      }
      if (body.customer !== existing.customer) {
        changed.push('customer');
        before['customer'] = existing.customer;
      }
      if (body.size !== existing.size) {
        changed.push('size');
        before['size'] = existing.size;
      }
      if (body.notes !== existing.notes) {
        changed.push('notes');
        before['notes'] = existing.notes;
      }

      if (changed.length > 0) {
        store.updateContainer(db, id, {
          number: check.normalized,
          numberValid: check.valid,
          customer: body.customer,
          size: body.size,
          notes: body.notes,
        });
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

  /** Undo a deletion: the record returns, standing where it stood if it can. */
  app.post('/api/containers/:id/restore', (request) => {
    const actor = requirePerm(request, 'DELETE');
    const yard = requireYard();
    const id = idParam(request);

    return transaction(db, () => {
      const existing = store.getContainerAny(db, id);
      if (existing === null) refuse(404, 'NOT_FOUND');
      if (existing === null) throw new Error('unreachable');
      if (!existing.deleted) refuse(409, 'NOT_DELETED');

      const wasAt = store.lastDeletePosition(db, id);
      if (wasAt !== null) {
        const refusal = canPlace(yard, store.listStanding(db), existing.size, wasAt);
        if (refusal !== null) refuseRule(refusal);
      }
      store.restoreContainer(db, id, wasAt);
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

      const at = now();
      store.softDelete(db, id, at);
      // The mistake itself goes on the record — audits hide nothing.
      store.recordMovement(db, id, 'DELETE', at, existing.position, null, '', actorId(actor));
      return { ok: true };
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
        truck: row.truck,
        driver: row.driver,
        number: row.number,
        weight: row.weight,
        size: row.size,
        customer: row.customer,
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
        customer: container.customer,
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
        truck: row.truck,
        driver: row.driver,
        number: row.number,
        weight: row.weight,
        size: row.size,
        customer: row.customer,
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

  return app;
}
