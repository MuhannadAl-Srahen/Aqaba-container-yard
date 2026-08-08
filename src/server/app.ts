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
  Position,
  YardConfig,
  YardStateDto,
} from '../shared/types';
import { MAX_BLOCKS, MAX_BLOCK_NAME, MAX_ZONE_COLS, MAX_ZONE_ROWS } from '../shared/types';
import { checkNumber } from '../shared/iso6346';
import { canLift, canPlace, strandedByLayout } from '../shared/rules';
import { sameSlot, slotLabel } from '../shared/address';
import { blockTakes, defaultLayout, overlappingPairs } from '../shared/geometry';
import {
  SESSION_COOKIE,
  hasPassword,
  issueSession,
  setPassword,
  verifyPassword,
  verifySession,
} from './auth';
import { transaction } from './db';
import * as store from './store';
import { buildSeedPlan } from './seedData';

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

const positionSchema = z.object({
  block: z.number().int().min(1),
  row: z.number().int().min(1),
  col: z.number().int().min(1),
  tier: z.union([z.literal(1), z.literal(2)]),
});

const zoneConfigSchema = z.object({
  rows: z.number().int().min(1).max(MAX_ZONE_ROWS),
  cols: z.number().int().min(1).max(MAX_ZONE_COLS),
});

/** The simple first-run shape: two halves, laid out by defaultLayout. */
const setupYardSchema = z.object({
  twenty: zoneConfigSchema,
  forty: zoneConfigSchema,
});

const blockSchema = z.object({
  /** Present for an existing block; absent for one the editor just added. */
  id: z.number().int().min(1).optional(),
  name: z.string().trim().min(1).max(MAX_BLOCK_NAME),
  /** 0 = مختلط: the block takes either container size. */
  size: z.union([z.literal(20), z.literal(40), z.literal(0)]),
  rows: z.number().int().min(1).max(MAX_ZONE_ROWS),
  cols: z.number().int().min(1).max(MAX_ZONE_COLS),
  x: z.number().finite().min(-50000).max(50000),
  y: z.number().finite().min(-50000).max(50000),
  // Any whole degree: the owner turns blocks freely with the mouse.
  angle: z.number().int().min(0).max(359),
});

const layoutSchema = z.object({
  blocks: z.array(blockSchema).min(1).max(MAX_BLOCKS),
});

const gateInSchema = z.object({
  number: z.string().trim().min(1).max(20),
  size: z.union([z.literal(20), z.literal(40)]),
  customer: z.string().trim().min(1).max(120),
  cargo: z.enum(['EMPTY', 'LADEN']),
  notes: z.string().trim().max(2000),
  position: positionSchema,
  /** The truck at the gate — the owner made it mandatory paperwork. */
  truck: z.string().trim().min(1).max(30),
  driver: z.string().trim().max(60).default(''),
  weight: z.string().trim().max(20).default(''),
});

const gateOutSchema = z.object({
  truck: z.string().trim().min(1).max(30),
  driver: z.string().trim().max(60).default(''),
});

const editSchema = z.object({
  number: z.string().trim().min(1).max(20),
  customer: z.string().trim().min(1).max(120),
  cargo: z.enum(['EMPTY', 'LADEN']),
  size: z.union([z.literal(20), z.literal(40)]),
  notes: z.string().trim().max(2000),
});

const statusSchema = z.object({
  status: z.enum(['NORMAL', 'DAMAGED', 'HOLD', 'REPAIR', 'INSPECT']),
});

const locationStateSchema = z.enum(['NORMAL', 'MAINTENANCE', 'RESERVED', 'CLOSED']);

function parseOrRefuse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Refusal(400, { code: 'VALIDATION' });
  return result.data as z.output<S>;
}

/** In-memory login throttle: enough to blunt a guessing loop on a public URL. */
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 20;

/** The machine's own browser engine, for printing PDFs server-side. */
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

  const isAuthorized = (request: FastifyRequest): boolean => {
    const token = request.cookies[SESSION_COOKIE];
    return token !== undefined && verifySession(db, token, Date.now());
  };

  const requireAuth = (request: FastifyRequest): void => {
    if (!isAuthorized(request)) refuse(401, 'UNAUTHORIZED');
  };

  const requireYard = (): ReturnType<typeof store.getYard> & object => {
    const yard = store.getYard(db);
    if (yard === null) refuse(409, 'NOT_SETUP');
    // The refusal above throws; this narrows for the type checker.
    if (yard === null) throw new Error('unreachable');
    return yard;
  };

  const sendSession = (reply: FastifyReply): void => {
    reply.setCookie(SESSION_COOKIE, issueSession(db, Date.now()), {
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
      const code: ErrorCode = error.message.includes('blocks.name') ? 'NAME_TAKEN' : 'SLOT_TAKEN';
      void reply.status(409).send({ code } satisfies ApiError);
      return;
    }
    void reply.status(500).send({ code: 'VALIDATION' } satisfies ApiError);
  });

  /**
   * DEVELOPMENT ONLY: wipe containers, movements and card counters so the
   * owner can test from zero. Disabled in production builds; slated for an
   * admin-only life later.
   */
  app.post('/api/dev/reset', (request) => {
    if (process.env['NODE_ENV'] === 'production') refuse(404, 'NOT_FOUND');
    requireAuth(request);
    transaction(db, () => {
      store.devReset(db);
    });
    return { ok: true };
  });

  /**
   * DEVELOPMENT ONLY: wipe like the reset, then fill the CURRENT yard with a
   * realistic month of demo work — for showing the app, never for records.
   * The layout, slot states and password stay exactly as they are.
   */
  app.post('/api/dev/seed', (request) => {
    if (process.env['NODE_ENV'] === 'production') refuse(404, 'NOT_FOUND');
    requireAuth(request);
    const yard = requireYard();
    const body = parseOrRefuse(
      z.object({ seed: z.number().int().min(0).optional() }),
      request.body ?? {},
    );
    const plan = buildSeedPlan(body.seed ?? Date.now() % 2_147_483_647, new Date(), yard);
    transaction(db, () => {
      store.devSeed(db, plan);
    });
    return { ok: true, containers: plan.containers.length };
  });

  /** What the client needs before it can draw anything. */
  app.get('/api/boot', (request) => {
    return {
      firstRun: !hasPassword(db),
      authorized: isAuthorized(request),
      yardConfigured: store.getYard(db) !== null,
    };
  });

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
    sendSession(reply);
    return { ok: true };
  });

  app.post('/api/login', (request, reply) => {
    const body = parseOrRefuse(z.object({ password: z.string().max(200) }), request.body);

    const key = request.ip;
    const entry = attempts.get(key);
    const nowMs = Date.now();
    if (entry !== undefined && nowMs - entry.windowStart < ATTEMPT_WINDOW_MS) {
      if (entry.count >= ATTEMPT_LIMIT) refuse(429, 'BAD_PASSWORD');
    } else {
      attempts.set(key, { count: 0, windowStart: nowMs });
    }

    if (!verifyPassword(db, body.password)) {
      const current = attempts.get(key) ?? { count: 0, windowStart: nowMs };
      attempts.set(key, { count: current.count + 1, windowStart: current.windowStart });
      refuse(401, 'BAD_PASSWORD');
    }

    attempts.delete(key);
    sendSession(reply);
    return { ok: true };
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
      slotStates: store.listSlotStates(db),
    };
  });

  /** A whole area's operational state — set from the map's slot sheet. */
  app.put('/api/blocks/:id/state', (request) => {
    requireAuth(request);
    const yard = requireYard();
    const id = idParam(request);
    const body = parseOrRefuse(z.object({ state: locationStateSchema }), request.body);

    if (!yard.blocks.some((block) => block.id === id)) refuse(404, 'NOT_FOUND');
    transaction(db, () => {
      store.setBlockState(db, id, body.state);
    });
    return store.getYard(db);
  });

  /** One slot's state (both tiers). Occupied is fine: standing boxes drain. */
  app.put('/api/slots/state', (request) => {
    requireAuth(request);
    const yard = requireYard();
    const body = parseOrRefuse(
      z.object({
        block: z.number().int().min(1),
        row: z.number().int().min(1),
        col: z.number().int().min(1),
        state: locationStateSchema,
      }),
      request.body,
    );

    const block = yard.blocks.find((candidate) => candidate.id === body.block);
    if (block === undefined) refuse(404, 'NOT_FOUND');
    if (block === undefined) throw new Error('unreachable');
    if (body.row > block.rows || body.col > block.cols) refuse(409, 'OUT_OF_BOUNDS');

    transaction(db, () => {
      store.setSlotState(db, { block: body.block, row: body.row, col: body.col }, body.state);
    });
    return { slotStates: store.listSlotStates(db) };
  });

  /**
   * The whole layout in one atomic save: blocks move, turn, grow, get
   * renamed, appear or disappear together. Growth and movement are free; a
   * change may never strand a standing container nor stack two areas on the
   * same ground.
   */
  app.put('/api/yard', (request) => {
    requireAuth(request);
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

      // New blocks get placeholder ids for the checks; nothing stands in
      // them. The layout wire carries no `state` — each block keeps its
      // stored one (new blocks start NORMAL).
      const stateOf = new Map(current.blocks.map((block) => [block.id, block.state]));
      const proposed: YardConfig = {
        blocks: body.blocks.map((block, index) => ({
          ...block,
          id: block.id ?? -(index + 1),
          state: (block.id !== undefined ? stateOf.get(block.id) : undefined) ?? 'NORMAL',
        })),
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
            .map((s) => `${s.number} @ ${slotLabel(nameOf, s.position)}`)
            .join('، '),
        });
      }

      const at = now();
      for (const id of liveIds) {
        if (!keptIds.has(id)) store.softDeleteBlock(db, id, at);
      }
      for (const block of body.blocks) {
        if (block.id !== undefined) {
          store.updateBlock(db, { ...block, id: block.id });
        } else {
          store.insertBlock(db, { ...block, state: 'NORMAL' });
        }
      }
      return store.getYard(db);
    });
  });

  app.post('/api/containers', (request, reply) => {
    requireAuth(request);
    const yard = requireYard();
    const body = parseOrRefuse(gateInSchema, request.body);
    const check = checkNumber(body.number);

    return transaction(db, () => {
      // The same number may return for a new visit, but cannot stand twice at once.
      const duplicate = store.findStandingByNumber(db, check.normalized);
      if (duplicate !== null) refuse(409, 'NUMBER_IN_YARD', { number: check.normalized });

      const standing = store.listStanding(db);
      const refusal = canPlace(yard, standing, store.listSlotStates(db), body.size, body.position);
      if (refusal !== null) {
        refuse(409, refusal.code, 'by' in refusal ? { by: refusal.by } : undefined);
      }

      const at = now();
      const id = store.insertContainer(db, {
        number: check.normalized,
        numberValid: check.valid,
        size: body.size,
        customer: body.customer,
        cargo: body.cargo,
        notes: body.notes,
        position: body.position,
        at,
        weight: body.weight,
        truckIn: body.truck,
        driverIn: body.driver,
        cardIn: store.nextCardNumber(db, 'in'),
      });
      store.recordMovement(db, id, 'IN', at, null, body.position, '');
      void reply.status(201);
      return store.getContainer(db, id);
    });
  });

  const idParam = (request: FastifyRequest): number => {
    const params = request.params as { id?: string };
    const id = Number(params.id);
    if (!Number.isInteger(id) || id < 1) refuse(400, 'VALIDATION');
    return id;
  };

  const standingContainer = (id: number): { dto: ContainerDto; position: Position } => {
    const dto = store.getContainer(db, id);
    if (dto === null) refuse(404, 'NOT_FOUND');
    if (dto === null) throw new Error('unreachable');
    if (dto.position === null) refuse(409, 'ALREADY_OUT');
    if (dto.position === null) throw new Error('unreachable');
    return { dto, position: dto.position };
  };

  app.post('/api/containers/:id/move', (request) => {
    requireAuth(request);
    const yard = requireYard();
    const id = idParam(request);
    const body = parseOrRefuse(z.object({ to: positionSchema }), request.body);

    return transaction(db, () => {
      const { dto, position } = standingContainer(id);
      if (sameSlot(position, body.to) && position.tier === body.to.tier) {
        refuse(409, 'SAME_SLOT');
      }

      const standing = store.listStanding(db);
      const self = standing.find((s) => s.id === id);
      if (self === undefined) refuse(404, 'NOT_FOUND');
      if (self === undefined) throw new Error('unreachable');

      const lift = canLift(standing, self);
      if (lift !== null) refuse(409, lift.code, 'by' in lift ? { by: lift.by } : undefined);

      const place = canPlace(yard, standing, store.listSlotStates(db), dto.size, body.to, id);
      if (place !== null) refuse(409, place.code, 'by' in place ? { by: place.by } : undefined);

      const at = now();
      store.setPosition(db, id, body.to);
      store.recordMovement(db, id, 'MOVE', at, position, body.to, '');
      return store.getContainer(db, id);
    });
  });

  app.post('/api/containers/:id/exit', (request) => {
    requireAuth(request);
    requireYard();
    const id = idParam(request);
    const gate = parseOrRefuse(gateOutSchema, request.body);

    return transaction(db, () => {
      const { position } = standingContainer(id);
      const standing = store.listStanding(db);
      const self = standing.find((s) => s.id === id);
      if (self === undefined) refuse(404, 'NOT_FOUND');
      if (self === undefined) throw new Error('unreachable');

      const lift = canLift(standing, self);
      if (lift !== null) refuse(409, lift.code, 'by' in lift ? { by: lift.by } : undefined);

      const at = now();
      store.markExited(db, id, at, {
        truck: gate.truck,
        driver: gate.driver,
        cardOut: store.nextCardNumber(db, 'out'),
      });
      store.recordMovement(db, id, 'OUT', at, position, null, '');
      return store.getContainer(db, id);
    });
  });

  app.patch('/api/containers/:id', (request) => {
    requireAuth(request);
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

      // A size flip while standing must fit the block the container is
      // standing in — a 40 cannot claim a 20 slot by paperwork alone.
      if (body.size !== existing.size && existing.position !== null) {
        const yard = requireYard();
        const block = yard.blocks.find((b) => b.id === existing.position?.block);
        if (block === undefined || !blockTakes(block.size, body.size)) refuse(409, 'WRONG_ZONE');
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
      if (body.cargo !== existing.cargo) {
        changed.push('cargo');
        before['cargo'] = existing.cargo;
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
          cargo: body.cargo,
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
        );
      }
      return store.getContainer(db, id);
    });
  });

  /**
   * The container's condition, set from its card. A change is an EDIT
   * movement carrying the old value, so the log names it and can revert it.
   */
  app.post('/api/containers/:id/status', (request) => {
    requireAuth(request);
    const id = idParam(request);
    const body = parseOrRefuse(statusSchema, request.body);

    return transaction(db, () => {
      const existing = store.getContainer(db, id);
      if (existing === null) refuse(404, 'NOT_FOUND');
      if (existing === null) throw new Error('unreachable');

      if (body.status !== existing.status) {
        store.setContainerStatus(db, id, body.status);
        store.recordMovement(
          db,
          id,
          'EDIT',
          now(),
          null,
          null,
          JSON.stringify({ k: ['status'], b: { status: existing.status } }),
        );
      }
      return store.getContainer(db, id);
    });
  });

  /** Undo a deletion: the record returns, standing where it stood if it can. */
  app.post('/api/containers/:id/restore', (request) => {
    requireAuth(request);
    const yard = requireYard();
    const id = idParam(request);

    return transaction(db, () => {
      const existing = store.getContainerAny(db, id);
      if (existing === null) refuse(404, 'NOT_FOUND');
      if (existing === null) throw new Error('unreachable');
      if (!existing.deleted) refuse(409, 'NOT_DELETED');

      const wasAt = store.lastDeletePosition(db, id);
      if (wasAt !== null) {
        const refusal = canPlace(
          yard,
          store.listStanding(db),
          store.listSlotStates(db),
          existing.size,
          wasAt,
        );
        if (refusal !== null) {
          refuse(409, refusal.code, 'by' in refusal ? { by: refusal.by } : undefined);
        }
      }
      store.restoreContainer(db, id, wasAt);
      store.recordMovement(db, id, 'RESTORE', now(), null, wasAt, '');
      return store.getContainer(db, id);
    });
  });

  /** A record that was a mistake. Soft: hidden everywhere, never destroyed. */
  app.delete('/api/containers/:id', (request) => {
    requireAuth(request);
    const id = idParam(request);

    return transaction(db, () => {
      const existing = store.getContainer(db, id);
      if (existing === null) refuse(404, 'NOT_FOUND');
      if (existing === null) throw new Error('unreachable');

      if (existing.position !== null) {
        const standing = store.listStanding(db);
        const self = standing.find((s) => s.id === id);
        if (self !== undefined) {
          const lift = canLift(standing, self);
          if (lift !== null) refuse(409, lift.code, 'by' in lift ? { by: lift.by } : undefined);
        }
      }

      const at = now();
      store.softDelete(db, id, at);
      // The mistake itself goes on the record — audits hide nothing.
      store.recordMovement(db, id, 'DELETE', at, existing.position, null, '');
      return { ok: true };
    });
  });

  const rangeSchema = z.object({
    from: z.string().datetime({ offset: true }).or(z.string().datetime()),
    to: z.string().datetime({ offset: true }).or(z.string().datetime()),
  });

  /** Amman-calendar date of an instant, for grouping the registers by day. */
  const ammanDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Amman',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  /** كشف حركة الدخول أو الخروج: every gate movement in the range. */
  app.get('/api/reports/gate', (request): { rows: GateReportRow[] } => {
    requireAuth(request);
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
        dwellDays:
          type === 'OUT'
            ? Math.max(
                0,
                Math.floor(
                  (new Date(row.at).getTime() - new Date(row.enteredAt).getTime()) / 86_400_000,
                ),
              )
            : null,
      }),
    );
    return { rows };
  });

  /** سجل العمليات: كل شي صار، بما فيه الحذف والسجلات المحذوفة. */
  app.get('/api/reports/log', (request): { rows: LogReportRow[] } => {
    requireAuth(request);
    const query = request.query as { from?: string; to?: string };
    const range = parseOrRefuse(rangeSchema, { from: query.from, to: query.to });
    return { rows: store.listOperationsLog(db, range.from, range.to) };
  });

  /** كشف سيارة: كل اللي حملته سيارة وحدة، دخول وخروج. */
  app.get(
    '/api/reports/truck',
    (request): { rows: Array<GateReportRow & { statement: 'IN' | 'OUT' }> } => {
      requireAuth(request);
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
        margin: { top: '9mm', bottom: '9mm', left: '9mm', right: '9mm' },
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

  /** كشف التقرير اليومي: دخول وخروج وواقف، يوم بيوم. */
  app.get('/api/reports/daily', (request): { rows: DailyReportRow[] } => {
    requireAuth(request);
    const query = request.query as { from?: string; to?: string };
    const range = parseOrRefuse(rangeSchema, { from: query.from, to: query.to });

    // The running total needs history from the beginning of time; the range
    // only decides which days get a row.
    const instants = store.listMovementInstants(db, range.to);
    const fromMs = new Date(range.from).getTime();
    const byDay = new Map<string, { inCount: number; outCount: number }>();
    let standingBefore = 0;
    const standingByDay = new Map<string, number>();
    let running = 0;
    for (const instant of instants) {
      const day = ammanDate.format(new Date(instant.at));
      running += instant.type === 'IN' ? 1 : -1;
      standingByDay.set(day, running);
      if (new Date(instant.at).getTime() < fromMs) {
        standingBefore = running;
        continue;
      }
      const entry = byDay.get(day) ?? { inCount: 0, outCount: 0 };
      if (instant.type === 'IN') entry.inCount += 1;
      else entry.outCount += 1;
      byDay.set(day, entry);
    }

    // Every day of the range appears, movement or none, like the paper sheet.
    const rows: DailyReportRow[] = [];
    let standing = standingBefore;
    for (let t = fromMs; t < new Date(range.to).getTime(); t += 86_400_000) {
      const day = ammanDate.format(new Date(t));
      if (rows.some((r) => r.date === day)) continue;
      const entry = byDay.get(day) ?? { inCount: 0, outCount: 0 };
      standing = standingByDay.get(day) ?? standing;
      rows.push({ date: day, inCount: entry.inCount, outCount: entry.outCount, standing });
    }
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
