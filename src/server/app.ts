import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

import type { ApiError, ContainerDto, ErrorCode, Position, YardStateDto } from '../shared/types';
import { MAX_ZONE_COLS, MAX_ZONE_ROWS } from '../shared/types';
import { checkNumber } from '../shared/iso6346';
import { canLift, canPlace, strandedByResize } from '../shared/rules';
import { sameSlot, slotLabel } from '../shared/address';
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
  zone: z.union([z.literal(20), z.literal(40)]),
  row: z.number().int().min(1),
  col: z.number().int().min(1),
  tier: z.union([z.literal(1), z.literal(2)]),
});

const zoneConfigSchema = z.object({
  rows: z.number().int().min(1).max(MAX_ZONE_ROWS),
  cols: z.number().int().min(1).max(MAX_ZONE_COLS),
});

const yardConfigSchema = z.object({
  twenty: zoneConfigSchema,
  forty: zoneConfigSchema,
});

const gateInSchema = z.object({
  number: z.string().trim().min(1).max(20),
  size: z.union([z.literal(20), z.literal(40)]),
  customer: z.string().trim().min(1).max(120),
  cargo: z.enum(['EMPTY', 'LADEN']),
  notes: z.string().trim().max(2000),
  position: positionSchema,
});

const editSchema = z.object({
  number: z.string().trim().min(1).max(20),
  customer: z.string().trim().min(1).max(120),
  cargo: z.enum(['EMPTY', 'LADEN']),
  notes: z.string().trim().max(2000),
});

function parseOrRefuse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Refusal(400, { code: 'VALIDATION' });
  return result.data;
}

/** In-memory login throttle: enough to blunt a guessing loop on a public URL. */
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 20;

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
      void reply.status(409).send({ code: 'SLOT_TAKEN' } satisfies ApiError);
      return;
    }
    void reply.status(500).send({ code: 'VALIDATION' } satisfies ApiError);
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
      z.object({ password: z.string().min(6).max(200), yard: yardConfigSchema }),
      request.body,
    );

    transaction(db, () => {
      setPassword(db, body.password);
      store.saveYard(db, body.yard);
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
    };
  });

  /** Resize, guarded: growth is free, a shrink must strand nobody. */
  app.put('/api/yard', (request) => {
    requireAuth(request);
    requireYard();
    const proposed = parseOrRefuse(yardConfigSchema, request.body);

    return transaction(db, () => {
      const stranded = strandedByResize(proposed, store.listStanding(db));
      if (stranded.length > 0) {
        refuse(409, 'SHRINK_OCCUPIED', {
          containers: stranded.map((s) => `${s.number} @ ${slotLabel(s.position)}`).join('، '),
        });
      }
      store.saveYard(db, proposed);
      return { ok: true };
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
      const refusal = canPlace(yard, standing, body.size, body.position);
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

      const place = canPlace(yard, standing, dto.size, body.to, id);
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

    return transaction(db, () => {
      const { position } = standingContainer(id);
      const standing = store.listStanding(db);
      const self = standing.find((s) => s.id === id);
      if (self === undefined) refuse(404, 'NOT_FOUND');
      if (self === undefined) throw new Error('unreachable');

      const lift = canLift(standing, self);
      if (lift !== null) refuse(409, lift.code, 'by' in lift ? { by: lift.by } : undefined);

      const at = now();
      store.markExited(db, id, at);
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

      const changed: string[] = [];
      if (check.normalized !== existing.number) changed.push('number');
      if (body.customer !== existing.customer) changed.push('customer');
      if (body.cargo !== existing.cargo) changed.push('cargo');
      if (body.notes !== existing.notes) changed.push('notes');

      if (changed.length > 0) {
        store.updateContainer(db, id, {
          number: check.normalized,
          numberValid: check.valid,
          customer: body.customer,
          cargo: body.cargo,
          notes: body.notes,
        });
        // The note carries machine keys; the client renders them in Arabic.
        store.recordMovement(db, id, 'EDIT', now(), null, null, changed.join(','));
      }
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

      store.softDelete(db, id, now());
      return { ok: true };
    });
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
